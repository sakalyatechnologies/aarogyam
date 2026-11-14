//! Outside labs and the people there: seen with `labs.read`, kept with `labs.write`.

use aarogyam_dal::labs::{self as dal, ContactRow, ContactValues, VendorRow, VendorValues};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{LabContactId, LabVendorId};
use aarogyam_domain::lab::{ContactChannel, LabKind, check_turnaround_days, check_work_types};
use aarogyam_domain::patient::Email;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use sakalya_types::{CallingCode, PhoneE164};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// A person at a lab.
#[derive(Debug, Clone)]
pub struct ContactView {
    /// Identifier.
    pub id: LabContactId,
    /// The lab.
    pub vendor_id: LabVendorId,
    /// Name.
    pub name: String,
    /// What they do there.
    pub role: Option<String>,
    /// Phone, E.164.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    pub whatsapp: bool,
    /// How they like to be reached.
    pub preferred_channel: ContactChannel,
}

impl From<ContactRow> for ContactView {
    fn from(row: ContactRow) -> Self {
        Self {
            id: LabContactId::from_uuid(row.id),
            vendor_id: LabVendorId::from_uuid(row.vendor_id),
            name: row.name,
            role: row.role,
            phone: row.phone_e164,
            email: row.email,
            whatsapp: row.whatsapp,
            preferred_channel: ContactChannel::parse(&row.preferred_channel)
                .unwrap_or(ContactChannel::Email),
        }
    }
}

/// A lab with its contacts.
#[derive(Debug, Clone)]
pub struct VendorView {
    /// Identifier.
    pub id: LabVendorId,
    /// Name.
    pub name: String,
    /// What kind of lab.
    pub kind: LabKind,
    /// Phone, E.164.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Address.
    pub address: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// The city it is in.
    pub city: Option<String>,
    /// The kinds of work it does.
    pub work_types: Vec<String>,
    /// How many days it usually takes.
    pub turnaround_days: Option<i16>,
    /// The people there, by name.
    pub contacts: Vec<ContactView>,
    /// When it was added.
    pub created_at: OffsetDateTime,
}

impl From<VendorRow> for VendorView {
    fn from(row: VendorRow) -> Self {
        Self {
            id: LabVendorId::from_uuid(row.id),
            name: row.name,
            kind: LabKind::parse(&row.kind).unwrap_or(LabKind::Other),
            phone: row.phone_e164,
            email: row.email,
            address: row.address,
            note: row.note,
            city: row.city,
            work_types: row.work_types,
            turnaround_days: row.turnaround_days,
            contacts: row.contacts.0.into_iter().map(ContactView::from).collect(),
            created_at: row.created_at,
        }
    }
}

/// Trims optional text; empty means none.
pub(crate) fn trimmed(
    text: Option<&str>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(t) if t.chars().count() > max => Err(AppError::invalid(
            field,
            format!("must be at most {max} characters"),
        )),
        Some(t) => Ok(Some(t.to_owned())),
    }
}

/// A field of a change: left out keeps the current value; an empty string clears it.
fn merged(
    input: Option<&str>,
    current: Option<&str>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    trimmed(input.or(current), field, max)
}

fn phone(text: Option<String>) -> Result<Option<String>, AppError> {
    text.map(|t| {
        PhoneE164::parse_with_default(&t, CallingCode::INDIA)
            .map(|p| p.as_e164().to_owned())
            .map_err(|_| AppError::invalid("phone", "must be a phone number"))
    })
    .transpose()
}

fn email(text: Option<String>) -> Result<Option<String>, AppError> {
    text.map(|t| {
        Email::parse(&t)
            .map(|e| e.as_str().to_owned())
            .map_err(|e| AppError::invalid("email", e))
    })
    .transpose()
}

/// A lab's values. On a change, fields left out stay as they are and an empty string clears.
#[derive(Debug, Clone, Default)]
pub struct VendorInput {
    /// Name; required for a new lab.
    pub name: Option<String>,
    /// Kind; a new lab is a dental lab unless said.
    pub kind: Option<LabKind>,
    /// Phone.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Address, up to 500 characters.
    pub address: Option<String>,
    /// A note, up to 500 characters.
    pub note: Option<String>,
    /// The city, up to 80 characters.
    pub city: Option<String>,
    /// The kinds of work it does, replacing the list: up to 20 different ones of up to 40
    /// characters; an empty list clears.
    pub work_types: Option<Vec<String>>,
    /// Its usual turnaround in days, 1 to 90; `Some(0)` clears.
    pub turnaround_days: Option<i32>,
}

struct VendorFields {
    name: String,
    kind: LabKind,
    phone: Option<String>,
    email: Option<String>,
    address: Option<String>,
    note: Option<String>,
    city: Option<String>,
    work_types: Vec<String>,
    turnaround_days: Option<i16>,
}

impl VendorFields {
    fn merge(current: Option<&VendorView>, input: &VendorInput) -> Result<Self, AppError> {
        let name = merged(
            input.name.as_deref(),
            current.map(|c| c.name.as_str()),
            "name",
            120,
        )?
        .ok_or(AppError::invalid("name", "is required"))?;
        Ok(Self {
            name,
            kind: input
                .kind
                .or(current.map(|c| c.kind))
                .unwrap_or(LabKind::DentalLab),
            phone: phone(merged(
                input.phone.as_deref(),
                current.and_then(|c| c.phone.as_deref()),
                "phone",
                30,
            )?)?,
            email: email(merged(
                input.email.as_deref(),
                current.and_then(|c| c.email.as_deref()),
                "email",
                254,
            )?)?,
            address: merged(
                input.address.as_deref(),
                current.and_then(|c| c.address.as_deref()),
                "address",
                500,
            )?,
            note: merged(
                input.note.as_deref(),
                current.and_then(|c| c.note.as_deref()),
                "note",
                500,
            )?,
            city: merged(
                input.city.as_deref(),
                current.and_then(|c| c.city.as_deref()),
                "city",
                80,
            )?,
            work_types: match &input.work_types {
                Some(types) => {
                    check_work_types(types).map_err(|e| AppError::invalid("work_types", e))?
                }
                None => current.map(|c| c.work_types.clone()).unwrap_or_default(),
            },
            turnaround_days: match input.turnaround_days {
                Some(0) => None,
                Some(days) => Some(
                    check_turnaround_days(days)
                        .map_err(|e| AppError::invalid("turnaround_days", e))?,
                ),
                None => current.and_then(|c| c.turnaround_days),
            },
        })
    }

    fn values(&self) -> VendorValues<'_> {
        VendorValues {
            name: &self.name,
            kind: self.kind.as_str(),
            phone_e164: self.phone.as_deref(),
            email: self.email.as_deref(),
            address: self.address.as_deref(),
            note: self.note.as_deref(),
            city: self.city.as_deref(),
            work_types: &self.work_types,
            turnaround_days: self.turnaround_days,
        }
    }
}

fn name_taken(error: AppError) -> AppError {
    match error {
        AppError::Db(db) => AppError::on_constraint(db, "lab_vendors_name", "a lab has this name"),
        other => other,
    }
}

async fn one_vendor(
    tx: &mut sakalya_db::ScopedTx,
    id: LabVendorId,
) -> Result<VendorView, AppError> {
    dal::vendors(tx.conn(), Some(id.uuid()))
        .await?
        .into_iter()
        .next()
        .map(VendorView::from)
        .ok_or(AppError::NotFound("lab"))
}

/// The clinic's labs with their contacts, by name; or one lab (`Some(id)`).
///
/// # Errors
/// [`AppError::Denied`] without `labs.read`; [`AppError::NotFound`] for an unknown lab.
pub async fn vendors(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Option<LabVendorId>,
) -> Result<Vec<VendorView>, AppError> {
    actor.require(Permission::LabsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::vendors(tx.conn(), id.map(LabVendorId::uuid)).await?;
        if id.is_some() && rows.is_empty() {
            return Err(AppError::NotFound("lab"));
        }
        Ok(rows.into_iter().map(VendorView::from).collect())
    })
    .await
}

/// Adds a lab.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::Invalid`] for bad values;
/// [`AppError::Conflict`] for a taken name.
pub async fn create_vendor(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: VendorInput,
) -> Result<VendorView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let fields = VendorFields::merge(None, &input)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let id = LabVendorId::new_v7();
        dal::insert_vendor(tx.conn(), id.uuid(), &fields.values()).await?;
        one_vendor(tx, id).await
    })
    .await
    .map_err(name_taken)
}

/// Changes a lab.
///
/// # Errors
/// As [`create_vendor`], and [`AppError::NotFound`] for an unknown lab.
pub async fn update_vendor(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabVendorId,
    input: VendorInput,
) -> Result<VendorView, AppError> {
    actor.require(Permission::LabsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = one_vendor(tx, id).await?;
        let fields = VendorFields::merge(Some(&current), &input)?;
        if !dal::update_vendor(tx.conn(), id.uuid(), &fields.values()).await? {
            return Err(AppError::NotFound("lab"));
        }
        one_vendor(tx, id).await
    })
    .await
    .map_err(name_taken)
}

/// Removes a lab and its contacts from the lists. Its orders and payments stay.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::NotFound`] for an unknown lab.
pub async fn delete_vendor(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabVendorId,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    actor.require(Permission::LabsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::delete_vendor(tx.conn(), id.uuid(), now).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("lab"))
        }
    })
    .await
}

/// A contact's values. On a change, fields left out stay as they are and an empty string
/// clears.
#[derive(Debug, Clone, Default)]
pub struct ContactInput {
    /// Name; required for a new contact.
    pub name: Option<String>,
    /// What they do there.
    pub role: Option<String>,
    /// Phone.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    pub whatsapp: Option<bool>,
    /// How they like to be reached.
    pub preferred_channel: Option<ContactChannel>,
}

struct ContactFields {
    name: String,
    role: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    whatsapp: bool,
    channel: ContactChannel,
}

impl ContactFields {
    fn merge(current: Option<&ContactView>, input: &ContactInput) -> Result<Self, AppError> {
        let name = merged(
            input.name.as_deref(),
            current.map(|c| c.name.as_str()),
            "name",
            120,
        )?
        .ok_or(AppError::invalid("name", "is required"))?;
        let fields = Self {
            name,
            role: merged(
                input.role.as_deref(),
                current.and_then(|c| c.role.as_deref()),
                "role",
                80,
            )?,
            phone: phone(merged(
                input.phone.as_deref(),
                current.and_then(|c| c.phone.as_deref()),
                "phone",
                30,
            )?)?,
            email: email(merged(
                input.email.as_deref(),
                current.and_then(|c| c.email.as_deref()),
                "email",
                254,
            )?)?,
            whatsapp: input
                .whatsapp
                .or(current.map(|c| c.whatsapp))
                .unwrap_or(false),
            channel: ContactChannel::Email,
        };
        let mut fields = fields;
        fields.channel = input
            .preferred_channel
            .or(current.map(|c| c.preferred_channel))
            .unwrap_or(if fields.email.is_some() {
                ContactChannel::Email
            } else if fields.whatsapp {
                ContactChannel::Whatsapp
            } else {
                ContactChannel::Phone
            });
        if fields.whatsapp && fields.phone.is_none() {
            return Err(AppError::invalid("whatsapp", "needs a phone number"));
        }
        let reachable = match fields.channel {
            ContactChannel::Email => fields.email.is_some(),
            ContactChannel::Whatsapp => fields.whatsapp,
            ContactChannel::Phone => fields.phone.is_some(),
        };
        if !reachable {
            return Err(AppError::invalid(
                "preferred_channel",
                "needs the matching email, phone or WhatsApp",
            ));
        }
        Ok(fields)
    }

    fn values(&self) -> ContactValues<'_> {
        ContactValues {
            name: &self.name,
            role: self.role.as_deref(),
            phone_e164: self.phone.as_deref(),
            email: self.email.as_deref(),
            whatsapp: self.whatsapp,
            preferred_channel: self.channel.as_str(),
        }
    }
}

/// Adds a contact to a lab.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::Invalid`] for bad values;
/// [`AppError::NotFound`] for an unknown lab.
pub async fn create_contact(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    vendor_id: LabVendorId,
    input: ContactInput,
) -> Result<ContactView, AppError> {
    actor.require(Permission::LabsWrite)?;
    let fields = ContactFields::merge(None, &input)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let id = LabContactId::new_v7();
        dal::insert_contact(tx.conn(), id.uuid(), vendor_id.uuid(), &fields.values())
            .await?
            .map(ContactView::from)
            .ok_or(AppError::NotFound("lab"))
    })
    .await
}

/// Changes a contact.
///
/// # Errors
/// As [`create_contact`], and [`AppError::NotFound`] for an unknown contact.
pub async fn update_contact(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabContactId,
    input: ContactInput,
) -> Result<ContactView, AppError> {
    actor.require(Permission::LabsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::contact(tx.conn(), id.uuid())
            .await?
            .map(ContactView::from)
            .ok_or(AppError::NotFound("lab contact"))?;
        let fields = ContactFields::merge(Some(&current), &input)?;
        dal::update_contact(tx.conn(), id.uuid(), &fields.values())
            .await?
            .map(ContactView::from)
            .ok_or(AppError::NotFound("lab contact"))
    })
    .await
}

/// Removes a contact. Orders that named them keep the name.
///
/// # Errors
/// [`AppError::Denied`] without `labs.write`; [`AppError::NotFound`] for an unknown contact.
pub async fn delete_contact(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabContactId,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    actor.require(Permission::LabsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::delete_contact(tx.conn(), id.uuid(), now).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("lab contact"))
        }
    })
    .await
}
