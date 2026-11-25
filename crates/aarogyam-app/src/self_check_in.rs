//! Patients checking themselves in by scanning the clinic's QR code. A scan makes an arrival
//! request, never a patient: the front desk accepts it (registering or matching the patient and
//! issuing a token, in one transaction with the walk-in path) or dismisses it. The public side
//! never says whether a phone or name already exists, and a request's payload (personal and
//! health data) is cleared the moment it is handled. See
//! `docs/plans/patient-self-check-in-design.md`, section 14.

use aarogyam_dal::{notices, self_check_ins as dal};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::clinical_text;
use aarogyam_domain::consent::{DEFAULT_NOTICE_VERSION, Method, Purpose};
use aarogyam_domain::ids::{PatientId, PractitionerId};
use aarogyam_domain::patient::{Email, PersonName, Sex};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::self_check_in::{
    Arrival, CLINIC_PER_HOUR, MAX_PENDING, PHONE_PER_HOUR, PatientAddress, catalogue,
};
use aws_lc_rs::constant_time::verify_slices_are_equal;
use aws_lc_rs::rand;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sakalya_db::Db;
use sakalya_types::PhoneE164;
use serde_json::{Value, json};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::intake::{DeskConsent, Intake, MAX_ALLERGIES};
use crate::patients::{
    EditPatient, PatientView, PhoneLookupResult, RegisterPatient, edit_in, lookup_phone_in,
    parse_birth_date, parse_phone,
};
use crate::queue::MAX_REASON_CHARS;
use crate::scope::{public_scope, staff_scope};
use crate::walk_ins::{NewWalkIn, WalkInPatient, WalkInView, register_in};
use aarogyam_domain::access::ClinicPlace;

/// Most reasons one request may name.
const MAX_REASONS: usize = 8;

// ---------------------------------------------------------------------------------------------
// The clinic's QR settings (staff)
// ---------------------------------------------------------------------------------------------

/// The clinic's QR settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QrSettings {
    /// Whether scanning the QR code works.
    pub enabled: bool,
    /// The key in the QR code's address; none until the clinic makes a QR code.
    pub key: Option<String>,
}

fn read(stored: &Value) -> QrSettings {
    QrSettings {
        enabled: stored
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        key: stored
            .get("key")
            .and_then(Value::as_str)
            .filter(|key| !key.is_empty())
            .map(str::to_owned),
    }
}

fn store(settings: &QrSettings) -> Value {
    json!({ "enabled": settings.enabled, "key": settings.key })
}

fn new_key() -> Result<String, AppError> {
    let mut bytes = [0_u8; 16];
    rand::fill(&mut bytes).map_err(|_| AppError::Internal("random number generator failed"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Whether `given` is the clinic's key and the QR is switched on.
fn key_matches(settings: &QrSettings, given: &str) -> bool {
    settings.enabled
        && settings.key.as_deref().is_some_and(|key| {
            !given.is_empty() && verify_slices_are_equal(key.as_bytes(), given.as_bytes()).is_ok()
        })
}

/// The QR settings. Needs `settings.manage`.
///
/// # Errors
/// [`AppError::Denied`] without the permission; [`AppError::Db`] on database failures.
pub async fn get_settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<QrSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(read(&dal::settings(tx.conn()).await?))
    })
    .await
}

/// Switches the QR on or off; switching on makes a key when there is none. Needs
/// `settings.manage`.
///
/// # Errors
/// As [`get_settings`].
pub async fn set_enabled(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    enabled: bool,
) -> Result<QrSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let mut settings = read(&dal::settings(tx.conn()).await?);
        settings.enabled = enabled;
        if enabled && settings.key.is_none() {
            settings.key = Some(new_key()?);
        }
        save(tx, &settings).await?;
        Ok(settings)
    })
    .await
}

/// Replaces the key (a "New QR"), which voids every printed QR code. Needs `settings.manage`.
///
/// # Errors
/// As [`get_settings`].
pub async fn rotate_key(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<QrSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let mut settings = read(&dal::settings(tx.conn()).await?);
        settings.key = Some(new_key()?);
        save(tx, &settings).await?;
        Ok(settings)
    })
    .await
}

async fn save(tx: &mut sakalya_db::ScopedTx, settings: &QrSettings) -> Result<(), AppError> {
    if dal::set_settings(tx.conn(), &store(settings)).await? {
        Ok(())
    } else {
        Err(AppError::NotFound("clinic"))
    }
}

// ---------------------------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------------------------

/// What the public check-in page starts from.
#[derive(Debug, Clone)]
pub struct ArrivePage {
    /// The clinic's name.
    pub clinic_name: String,
    /// The notice version the patient agrees to.
    pub notice_version: String,
    /// The clinic's published notice text, when it has published one.
    pub notice_text: Option<String>,
}

/// The clinic's name and notice, for a QR key that is right and switched on.
///
/// # Errors
/// [`AppError::NotFound`] for a wrong or missing key, or when the QR is off;
/// [`AppError::Db`] on database failures.
pub async fn page(
    db: &Db,
    clinic: &ClinicPlace,
    request_id: Option<Uuid>,
    key: &str,
) -> Result<ArrivePage, AppError> {
    db.scoped(&public_scope(clinic.id, request_id), async |tx| {
        if !key_matches(&read(&dal::settings(tx.conn()).await?), key) {
            return Err(AppError::NotFound("check-in"));
        }
        let name = aarogyam_dal::clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?
            .name;
        let notices = notices::list(tx.conn()).await?;
        let current = notices.into_iter().next();
        Ok(ArrivePage {
            clinic_name: name,
            notice_version: current
                .as_ref()
                .map_or_else(|| DEFAULT_NOTICE_VERSION.to_owned(), |n| n.label.clone()),
            notice_text: current.map(|n| n.body),
        })
    })
    .await
}

/// A patient's arrival, as received from the public page.
#[derive(Debug, Clone, Default)]
pub struct NewArrival {
    /// First name.
    pub first_name: String,
    /// Last name, when given.
    pub last_name: Option<String>,
    /// Phone; +91 is assumed without a country code.
    pub phone: String,
    /// Reason codes from the clinic's list.
    pub reasons: Vec<String>,
    /// A line in the patient's words.
    pub reason_text: Option<String>,
    /// The patient agrees to the clinic keeping their health record. Must be true.
    pub consent_care: bool,
    /// The person filling the form is the patient.
    pub for_self: bool,
    /// The person filling it, when not the patient.
    pub contact_name: Option<String>,
    /// What that person is to the patient.
    pub relation: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// `female`, `male` or `other`.
    pub sex: Option<String>,
    /// Age in years.
    pub age_years: Option<u16>,
    /// Date of birth.
    pub date_of_birth: Option<Date>,
    /// Address, already validated.
    pub address: Option<PatientAddress>,
    /// Health flag codes.
    pub health: Vec<String>,
    /// Allergies in the patient's words.
    pub allergies_text: Option<String>,
    /// Appointment reminders ticked.
    pub reminders: bool,
}

fn optional(
    text: Option<&str>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    match text.map(str::trim).filter(|t| !t.is_empty()) {
        None => Ok(None),
        Some(text) => clinical_text(text, 1, max)
            .map(Some)
            .map_err(|error| AppError::invalid(field, error)),
    }
}

/// Checks a request against the clinic's lists and the domain's types, without the database.
#[expect(
    clippy::too_many_lines,
    reason = "one list of field checks, each short"
)]
fn check(
    input: &NewArrival,
    today: Date,
    notice: (Option<Uuid>, String),
) -> Result<(Arrival, PhoneE164), AppError> {
    let lists = catalogue();
    if !input.consent_care {
        return Err(AppError::invalid(
            "consent_care",
            "must be agreed to check in",
        ));
    }
    let first = PersonName::parse(&input.first_name)
        .map_err(|_| AppError::invalid("first_name", "must be 1 to 100 characters of text"))?;
    let last = match input
        .last_name
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        Some(text) => Some(
            PersonName::parse(text)
                .map_err(|_| AppError::invalid("last_name", "must be plain text"))?,
        ),
        None => None,
    };
    let full = match &last {
        Some(last) => format!("{} {}", first.as_str(), last.as_str()),
        None => first.as_str().to_owned(),
    };
    PersonName::parse(&full).map_err(|_| AppError::invalid("first_name", "is too long"))?;
    let phone = parse_phone(&input.phone)?.ok_or(AppError::invalid("phone", "is required"))?;
    if input.reasons.len() > MAX_REASONS {
        return Err(AppError::invalid("reasons", "too many"));
    }
    let mut reasons: Vec<String> = Vec::new();
    for code in &input.reasons {
        if !lists.has_reason(code) {
            return Err(AppError::invalid("reasons", "unknown value"));
        }
        if !reasons.contains(code) {
            reasons.push(code.clone());
        }
    }
    let reason_text = optional(input.reason_text.as_deref(), "reason_text", 200)?;
    if reasons.is_empty() && reason_text.is_none() {
        return Err(AppError::invalid("reasons", "choose at least one"));
    }
    let (contact_name, relation) = if input.for_self {
        (None, None)
    } else {
        let name = input
            .contact_name
            .as_deref()
            .map(PersonName::parse)
            .transpose()
            .map_err(|_| AppError::invalid("contact_name", "must be plain text"))?
            .ok_or(AppError::invalid("contact_name", "is required"))?;
        let relation = input
            .relation
            .as_deref()
            .filter(|code| lists.has_relation(code))
            .ok_or(AppError::invalid("relation", "choose one"))?;
        (Some(name.as_str().to_owned()), Some(relation.to_owned()))
    };
    let email = match input
        .email
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        Some(text) => Some(
            Email::parse(text)
                .map_err(AppError::patient)?
                .as_str()
                .to_owned(),
        ),
        None => None,
    };
    let sex = match input
        .sex
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        Some(text) => Some(
            Sex::parse(text)
                .map_err(AppError::patient)?
                .as_str()
                .to_owned(),
        ),
        None => None,
    };
    parse_birth_date(input.date_of_birth, input.age_years, today)?;
    let mut health: Vec<String> = Vec::new();
    for code in &input.health {
        if lists.health_flag(code).is_none() {
            return Err(AppError::invalid("health", "unknown value"));
        }
        if !health.contains(code) {
            health.push(code.clone());
        }
    }
    let allergies_text = optional(input.allergies_text.as_deref(), "allergies_text", 500)?;
    let address = input.address.clone().filter(|a| !a.is_empty());
    let arrival = Arrival {
        first_name: first.as_str().to_owned(),
        last_name: last.map(|l| l.as_str().to_owned()),
        phone: phone.as_e164().to_owned(),
        reasons,
        reason_text,
        for_self: input.for_self,
        contact_name,
        relation,
        email,
        sex,
        age_years: input.age_years,
        date_of_birth: input.date_of_birth.map(|d| d.to_string()),
        address,
        health,
        allergies_text,
        reminders: input.reminders,
        notice_id: notice.0,
        notice_version: notice.1,
    };
    Ok((arrival, phone))
}

/// Saves a patient's arrival request. Nothing is created in the patient list, and the answer is
/// the same whether or not the clinic knows the phone or name.
///
/// # Errors
/// [`AppError::NotFound`] for a wrong or missing key, or when the QR is off;
/// [`AppError::Invalid`] for bad input; [`AppError::ArrivalListFull`] when the clinic has
/// [`MAX_PENDING`] requests waiting; [`AppError::ArrivalBusy`] over the hourly caps for the
/// clinic or the phone.
pub async fn submit(
    db: &Db,
    clinic: &ClinicPlace,
    request_id: Option<Uuid>,
    key: &str,
    input: NewArrival,
    now: OffsetDateTime,
) -> Result<Uuid, AppError> {
    let today = clinic_today(&clinic.timezone, now);
    db.scoped(&public_scope(clinic.id, request_id), async |tx| {
        if !key_matches(&read(&dal::settings(tx.conn()).await?), key) {
            return Err(AppError::NotFound("check-in"));
        }
        let current = notices::current(tx.conn()).await?;
        let notice = match current {
            Some((id, label)) => (Some(id), label),
            None => (None, DEFAULT_NOTICE_VERSION.to_owned()),
        };
        let (arrival, phone) = check(&input, today, notice)?;
        dal::lock_list(tx.conn()).await?;
        let counts = dal::counts(tx.conn(), phone.as_e164(), now).await?;
        if counts.pending >= MAX_PENDING {
            return Err(AppError::ArrivalListFull);
        }
        if counts.clinic_last_hour >= CLINIC_PER_HOUR || counts.phone_last_hour >= PHONE_PER_HOUR {
            return Err(AppError::ArrivalBusy);
        }
        let payload =
            serde_json::to_value(&arrival).map_err(|_| AppError::Internal("arrival not saved"))?;
        Ok(dal::insert(tx.conn(), None, &payload, phone.as_e164()).await?)
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// The front desk
// ---------------------------------------------------------------------------------------------

/// A request waiting for the desk.
#[derive(Debug, Clone)]
pub struct PendingArrival {
    /// Identifier.
    pub id: Uuid,
    /// When the patient sent it.
    pub created_at: OffsetDateTime,
    /// What the patient typed.
    pub arrival: Arrival,
    /// The reasons in words, for the card.
    pub reason_labels: Vec<String>,
    /// The health flags in words.
    pub health_labels: Vec<String>,
    /// Patients already registered with the phone, and their relatives.
    pub matches: PhoneLookupResult,
}

fn to_arrival(payload: Value) -> Result<Arrival, AppError> {
    serde_json::from_value(payload).map_err(|_| AppError::Internal("unreadable arrival"))
}

/// The requests waiting for the desk, oldest first, each with the patients that share its phone.
/// Needs `patients.read`.
///
/// # Errors
/// [`AppError::Denied`] without the permission; [`AppError::Db`] on database failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Vec<PendingArrival>, AppError> {
    actor.require(Permission::PatientsRead)?;
    let today = clinic_today(&actor.timezone, now);
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let rows = dal::list_pending(tx.conn()).await?;
        let lists = catalogue();
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let arrival = to_arrival(row.payload)?;
            let matches = match PhoneE164::parse(&arrival.phone) {
                Ok(phone) => lookup_phone_in(tx, actor, &phone, today).await?,
                Err(_) => PhoneLookupResult {
                    matches: Vec::new(),
                    family_group: Vec::new(),
                },
            };
            out.push(PendingArrival {
                id: row.id,
                created_at: row.created_at,
                reason_labels: arrival
                    .reasons
                    .iter()
                    .filter_map(|code| lists.reason_label(code).map(str::to_owned))
                    .collect(),
                health_labels: arrival
                    .health
                    .iter()
                    .filter_map(|code| lists.health_flag(code).map(|c| c.label.clone()))
                    .collect(),
                arrival,
                matches,
            });
        }
        Ok(out)
    })
    .await
}

/// What the desk decides when it accepts.
#[derive(Debug, Clone, Copy)]
pub struct Accept {
    /// A patient already registered, picked from the matches; a new patient when none.
    pub patient_id: Option<PatientId>,
    /// Issue a queue token.
    pub check_in: bool,
    /// The doctor, "Any" when none.
    pub practitioner_id: Option<PractitionerId>,
}

fn allergy_list(text: Option<&str>) -> Vec<String> {
    text.map(|text| {
        text.split([',', ';', '\n'])
            .map(|part| part.trim().chars().take(200).collect::<String>())
            .filter(|part| !part.is_empty())
            .take(MAX_ALLERGIES)
            .collect()
    })
    .unwrap_or_default()
}

/// Accepts a request: registers the patient (or takes the one picked, filling only their blank
/// details), records the allergies, health flags and consents the patient gave, issues a token
/// and marks the request handled with its payload cleared, all in one transaction. A second
/// accept of the same request gets [`AppError::ArrivalHandled`]. Needs `patients.write`,
/// `appointments.write` and `intake.write`.
///
/// # Errors
/// [`AppError::Denied`] without the permissions; [`AppError::NotFound`] for no such request or
/// patient in this clinic; [`AppError::ArrivalHandled`] when it was already handled;
/// [`AppError::Db`] on database failures.
#[expect(clippy::too_many_lines, reason = "one transaction, step by step")]
pub async fn accept(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
    input: Accept,
    now: OffsetDateTime,
) -> Result<WalkInView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    actor.require(Permission::AppointmentsWrite)?;
    actor.require(Permission::IntakeWrite)?;
    let today = clinic_today(&actor.timezone, now);
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let row = dal::get_for_update(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("arrival"))?
            .ok_or(AppError::ArrivalHandled)?;
        let arrival = to_arrival(row.payload)?;
        let lists = catalogue();
        let full_name = match &arrival.last_name {
            Some(last) => format!("{} {last}", arrival.first_name),
            None => arrival.first_name.clone(),
        };
        let date_of_birth = arrival
            .date_of_birth
            .as_deref()
            .map(|text| Date::parse(text, &time::format_description::well_known::Iso8601::DATE))
            .transpose()
            .map_err(|_| AppError::Internal("unreadable date of birth"))?;
        let patient = match input.patient_id {
            Some(existing) => WalkInPatient::Existing(existing),
            None => WalkInPatient::New(RegisterPatient {
                full_name,
                sex: arrival.sex.clone(),
                date_of_birth,
                age_years: arrival.age_years,
                phone: Some(arrival.phone.clone()),
                email: arrival.email.clone(),
                preferred_language: None,
                address: arrival.address.clone(),
            }),
        };
        let mut consents = vec![DeskConsent {
            purpose: Purpose::Care,
            method: Method::App,
        }];
        if arrival.reminders {
            consents.push(DeskConsent {
                purpose: Purpose::Reminders,
                method: Method::App,
            });
        }
        let reason = reason_line(&arrival, lists);
        let walk_in = NewWalkIn {
            patient,
            practitioner_id: input.practitioner_id,
            branch_id: None,
            intake: Intake {
                allergies: allergy_list(arrival.allergies_text.as_deref()),
                no_known_allergies: false,
                conditions: arrival
                    .health
                    .iter()
                    .filter_map(|code| lists.health_flag(code).and_then(|c| c.condition.clone()))
                    .collect(),
                consents,
                notice_id: arrival.notice_id,
                notice_version: Some(arrival.notice_version.clone()),
                consent_note: Some(consent_note(&arrival, today)),
            },
            reason,
            family_of: None,
            check_in: input.check_in,
        };
        let mut view = register_in(tx, actor, &walk_in, now).await?;
        let patient_id = view.patient.id.uuid();
        if !view.registered {
            let (allergy_alert, consent_pending) =
                (view.patient.allergy_alert, view.patient.consent_pending);
            if let Some(edited) =
                fill_blanks(tx, actor, &view.patient, &arrival, date_of_birth, today).await?
            {
                view.patient = PatientView {
                    allergy_alert,
                    consent_pending,
                    ..edited
                };
            }
        }
        if let (Some(name), Some(relation)) = (&arrival.contact_name, &arrival.relation) {
            let words = lists
                .relations
                .iter()
                .find(|c| &c.code == relation)
                .map_or(relation.as_str(), |c| c.label.as_str());
            dal::append_patient_note(
                tx.conn(),
                patient_id,
                &format!("Registered by {name}, {}", words.to_lowercase()),
            )
            .await?;
        }
        dal::mark_handled(
            tx.conn(),
            id,
            "accepted",
            Some(patient_id),
            view.token.as_ref().map(|t| t.row.id),
            actor.membership_id.uuid(),
        )
        .await?;
        Ok(view)
    })
    .await
}

/// The note kept with the consents: who agreed on the form. A child's consent is the
/// guardian's.
fn consent_note(arrival: &Arrival, today: Date) -> String {
    let date_of_birth = arrival.date_of_birth.as_deref().and_then(|text| {
        Date::parse(text, &time::format_description::well_known::Iso8601::DATE).ok()
    });
    let age = parse_birth_date(date_of_birth, arrival.age_years, today)
        .ok()
        .flatten()
        .map(|born| born.age_on(today));
    let guardian = !arrival.for_self || age.is_some_and(|age| age < 18);
    format!(
        "given on the check-in form by {}",
        if guardian { "guardian" } else { "self" }
    )
}

/// The token's reason: the chosen reasons in words, then the patient's own line, cut to fit.
fn reason_line(
    arrival: &Arrival,
    lists: &aarogyam_domain::self_check_in::Catalogue,
) -> Option<String> {
    let mut parts: Vec<String> = arrival
        .reasons
        .iter()
        .filter_map(|code| lists.reason_label(code).map(str::to_owned))
        .collect();
    if let Some(text) = &arrival.reason_text {
        parts.push(text.clone());
    }
    let line = parts.join(", ");
    (!line.is_empty()).then(|| line.chars().take(MAX_REASON_CHARS).collect())
}

/// Fills only the blank details of an existing patient from the request: never overwrites.
/// Returns the edited patient, or `None` when nothing was blank.
async fn fill_blanks(
    tx: &mut sakalya_db::ScopedTx,
    actor: &ClinicActor,
    current: &PatientView,
    arrival: &Arrival,
    date_of_birth: Option<Date>,
    today: Date,
) -> Result<Option<PatientView>, AppError> {
    let mut edit = EditPatient::default();
    let mut any = false;
    if current.email.is_none()
        && let Some(email) = &arrival.email
    {
        edit.email = Some(email.clone());
        any = true;
    }
    if current.sex == "unknown"
        && let Some(sex) = &arrival.sex
    {
        edit.sex = Some(sex.clone());
        any = true;
    }
    if current.date_of_birth.is_none() {
        if let Some(date) = date_of_birth {
            edit.date_of_birth = Some(Some(date));
            any = true;
        } else if let Some(age) = arrival.age_years {
            edit.age_years = Some(age);
            any = true;
        }
    }
    if let Some(given) = &arrival.address {
        let have = current.address.clone().unwrap_or_default();
        let fill =
            |have: &Option<String>, given: &Option<String>| have.clone().or_else(|| given.clone());
        let merged = PatientAddress {
            line1: fill(&have.line1, &given.line1),
            locality: fill(&have.locality, &given.locality),
            city: fill(&have.city, &given.city),
            district: fill(&have.district, &given.district),
            state: fill(&have.state, &given.state),
            pincode: fill(&have.pincode, &given.pincode),
        };
        if merged != have {
            edit.address = Some(merged);
            any = true;
        }
    }
    if !any {
        return Ok(None);
    }
    Ok(Some(
        edit_in(tx, actor, current.id, &edit, None, today).await?,
    ))
}

/// Dismisses a request (spam or a duplicate): its payload is cleared at once. Needs
/// `patients.write`.
///
/// # Errors
/// [`AppError::Denied`] without the permission; [`AppError::NotFound`] for no such request in
/// this clinic; [`AppError::ArrivalHandled`] when it was already handled.
pub async fn dismiss(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        dal::get_for_update(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("arrival"))?
            .ok_or(AppError::ArrivalHandled)?;
        dal::mark_handled(
            tx.conn(),
            id,
            "dismissed",
            None,
            None,
            actor.membership_id.uuid(),
        )
        .await?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arrival() -> NewArrival {
        NewArrival {
            first_name: "Asha".into(),
            phone: "98765 43210".into(),
            reasons: vec!["tooth_pain".into()],
            consent_care: true,
            for_self: true,
            ..NewArrival::default()
        }
    }

    fn today() -> Date {
        Date::from_calendar_date(2026, time::Month::November, 24).unwrap_or(Date::MIN)
    }

    fn run(input: &NewArrival) -> Result<(Arrival, PhoneE164), AppError> {
        check(input, today(), (None, "v1".into()))
    }

    #[test]
    fn the_minimum_is_name_phone_a_reason_and_consent() {
        assert!(run(&arrival()).is_ok());
        let mut no_consent = arrival();
        no_consent.consent_care = false;
        assert!(matches!(
            run(&no_consent),
            Err(AppError::Invalid {
                field: "consent_care",
                ..
            })
        ));
        let mut no_reason = arrival();
        no_reason.reasons.clear();
        assert!(matches!(
            run(&no_reason),
            Err(AppError::Invalid {
                field: "reasons",
                ..
            })
        ));
        no_reason.reason_text = Some("sore gums".into());
        assert!(run(&no_reason).is_ok());
    }

    #[test]
    fn family_needs_a_contact_and_a_relation() {
        let mut family = arrival();
        family.for_self = false;
        assert!(run(&family).is_err());
        family.contact_name = Some("Ravi".into());
        family.relation = Some("parent".into());
        assert!(run(&family).is_ok());
        family.relation = Some("landlord".into());
        assert!(run(&family).is_err());
    }

    #[test]
    fn unknown_codes_and_both_birth_fields_are_refused() {
        let mut bad = arrival();
        bad.health = vec!["gout".into()];
        assert!(run(&bad).is_err());
        let mut both = arrival();
        both.age_years = Some(30);
        both.date_of_birth = Some(today());
        assert!(run(&both).is_err());
    }

    #[test]
    fn the_key_works_only_when_switched_on() {
        let on = QrSettings {
            enabled: true,
            key: Some("abc".into()),
        };
        assert!(key_matches(&on, "abc"));
        assert!(!key_matches(&on, "abd"));
        assert!(!key_matches(&on, ""));
        assert!(!key_matches(
            &QrSettings {
                enabled: false,
                ..on
            },
            "abc"
        ));
        assert!(!key_matches(
            &QrSettings {
                enabled: true,
                key: None
            },
            ""
        ));
    }

    #[test]
    fn allergies_split_on_commas() {
        assert_eq!(
            allergy_list(Some("Penicillin, dust ; latex\n")),
            vec!["Penicillin", "dust", "latex"]
        );
        assert_eq!(allergy_list(None), Vec::<String>::new());
    }
}
