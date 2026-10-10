//! Links to a patient's records: a member picks what the patient may see (the current chart,
//! X-rays, issued bills) and how long the link works. The patient opens it on the clinic's host
//! with the PIN, as for prescriptions; the PIN is limited the same way. Creating a link, opening
//! it and downloading an X-ray through it are all written to the access record.

use aarogyam_dal::billing::{self as billing_dal, InvoiceFilter};
use aarogyam_dal::record_shares as dal;
use aarogyam_dal::{access, chart, prescriptions as links};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{AttachmentId, ClinicId, PatientId, ShareLinkId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::share::{
    Expiry, LinkState, MAX_PIN_ATTEMPTS, Pin, RecordType, ShareError, check_record_types,
};
use sakalya_db::{Db, ScopedTx};
use serde_json::Value;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::AppError;
use crate::files::{Files, LinkRefusal, StorageKey};
use crate::scope::{PATIENT, public_scope, staff_scope};
use crate::share::{NewLink, new_pin, pin_hash};
use crate::tokens::{hash_token, new_token};
use crate::visits::require_patient;

pub use aarogyam_dal::record_shares::{RecordLinkRow, XrayRow};

/// How long an X-ray's download link works, within the link's own lifetime.
const FILE_LINK_LIFETIME: Duration = Duration::minutes(10);

fn invalid(error: ShareError) -> AppError {
    AppError::invalid(error.field(), error)
}

/// What the member needs to hold to put a kind of record in a link.
const fn needed(kind: RecordType) -> Permission {
    match kind {
        RecordType::Chart | RecordType::Xrays => Permission::ClinicalRead,
        RecordType::Bills => Permission::BillingRead,
    }
}

const fn resource(kind: RecordType) -> &'static str {
    match kind {
        RecordType::Chart => "chart",
        RecordType::Xrays => "attachment",
        RecordType::Bills => "invoice",
    }
}

/// A new link to records: the token for the URL and the PIN to tell the patient, shown once.
#[derive(Debug, Clone)]
pub struct NewRecordLink {
    /// The link, token and PIN as for any share link.
    pub link: NewLink,
    /// What it shows.
    pub record_types: Vec<RecordType>,
}

/// Makes a link to some of a patient's records. The member must be allowed to read each kind
/// they include.
///
/// # Errors
/// [`AppError::Denied`] without `patients.read`, or without the permission for a kind (chart and
/// X-rays `clinical.read`, bills `billing.read`); [`AppError::Invalid`] for bad types or
/// lifetime; [`AppError::NotFound`] for a patient out of reach.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    record_types: &[String],
    expires_in: &str,
    now: OffsetDateTime,
) -> Result<NewRecordLink, AppError> {
    actor.require(Permission::PatientsRead)?;
    let kinds = check_record_types(record_types).map_err(invalid)?;
    let expiry = Expiry::parse(expires_in).map_err(invalid)?;
    for kind in &kinds {
        actor.require(needed(*kind))?;
    }
    let (token, token_hash) = new_token()?;
    let pin = new_pin()?;
    let id = ShareLinkId::new_v7();
    let expires_at = now + expiry.duration();
    let names: Vec<String> = kinds.iter().map(|k| k.as_str().to_owned()).collect();
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::PatientsRead)).await?;
        dal::insert(
            tx.conn(),
            &dal::NewRecordLink {
                id: id.uuid(),
                token_hash: &token_hash,
                pin_hash: &pin_hash(&token, &pin),
                patient_id: patient.id,
                record_types: &names,
                expires_at,
            },
        )
        .await?;
        let request_text = request_id.map(|id| id.to_string());
        for kind in &kinds {
            access::record(
                tx.conn(),
                &access::DocumentAccess {
                    actor_user_id: Some(actor.user_id.uuid()),
                    actor_kind: crate::scope::actor_kind(actor).as_str(),
                    patient_id: patient.id,
                    share_link_id: Some(id.uuid()),
                    resource: resource(*kind),
                    // The link stands for the records it opens: no single document.
                    resource_id: id.uuid(),
                    action: "share",
                    purpose: actor.access_purpose(),
                    request_id: request_text.as_deref(),
                },
            )
            .await?;
        }
        Ok::<_, AppError>(())
    })
    .await?;
    Ok(NewRecordLink {
        link: NewLink {
            id,
            token,
            pin,
            expires_at,
        },
        record_types: kinds,
    })
}

/// A patient's links to records, newest first. Never the token or PIN.
///
/// # Errors
/// [`AppError::Denied`] without `patients.read`; [`AppError::NotFound`] for a patient out of
/// reach.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<RecordLinkRow>, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::PatientsRead)).await?;
        Ok(dal::list(tx.conn(), patient.id).await?)
    })
    .await
}

/// One tooth finding on the chart.
#[derive(Debug, Clone)]
pub struct ChartLine {
    /// FDI tooth number.
    pub tooth: Option<i16>,
    /// The surface, such as `O`.
    pub surface: Option<String>,
    /// The finding, such as `caries`.
    pub finding: Option<String>,
    /// The note.
    pub note: Option<String>,
    /// When the finding was made.
    pub effective_at: OffsetDateTime,
}

/// A bill the patient may see.
#[derive(Debug, Clone)]
pub struct BillLine {
    /// The bill.
    pub id: Uuid,
    /// Its number.
    pub number: Option<String>,
    /// When it was issued.
    pub issued_at: Option<OffsetDateTime>,
    /// Its total, in paise.
    pub total_paise: i64,
    /// Paid so far, in paise.
    pub paid_paise: i64,
}

/// An X-ray with the signed token for its content route.
#[derive(Debug, Clone)]
pub struct XrayLink {
    /// The X-ray's details.
    pub xray: XrayRow,
    /// The token for `GET /shared/{token}/records/xrays/{id}`.
    pub sig: String,
    /// When the token stops working.
    pub sig_expires_at: OffsetDateTime,
}

/// What an opened link shows: only the kinds it was made for.
#[derive(Debug, Clone)]
pub struct Records {
    /// The patient's name.
    pub patient_name: String,
    /// The kinds the link shows.
    pub record_types: Vec<RecordType>,
    /// The current chart, when included.
    pub chart: Option<Vec<ChartLine>>,
    /// X-rays, when included.
    pub xrays: Option<Vec<XrayLink>>,
    /// Issued bills, when included.
    pub bills: Option<Vec<BillLine>>,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
}

/// What opening a link to records did.
#[derive(Debug, Clone)]
pub enum OpenOutcome {
    /// The PIN was right.
    Opened(Box<Records>),
    /// The PIN was wrong; this many tries are left.
    WrongPin(i32),
    /// Too many wrong PINs.
    Locked,
    /// Past its expiry, or revoked.
    Expired,
}

fn text(data: &Value, key: &str) -> Option<String> {
    data.get(key).and_then(Value::as_str).map(str::to_owned)
}

async fn contents(
    tx: &mut ScopedTx,
    files: &Files,
    clinic: ClinicId,
    link: &links::ShareLinkRow,
    kinds: &[RecordType],
    entries: &mut Vec<(&'static str, Uuid)>,
    now: OffsetDateTime,
) -> Result<
    (
        Option<Vec<ChartLine>>,
        Option<Vec<XrayLink>>,
        Option<Vec<BillLine>>,
    ),
    AppError,
> {
    let (mut chart_out, mut xrays_out, mut bills_out) = (None, None, None);
    for kind in kinds {
        match kind {
            RecordType::Chart => {
                let rows = chart::current(tx.conn(), link.patient_id).await?;
                entries.push(("chart", link.id));
                chart_out = Some(
                    rows.into_iter()
                        .map(|row| ChartLine {
                            tooth: row.tooth,
                            surface: text(&row.data, "surface"),
                            finding: text(&row.data, "finding"),
                            note: text(&row.data, "note"),
                            effective_at: row.effective_at,
                        })
                        .collect(),
                );
            }
            RecordType::Xrays => {
                let expires = (now + FILE_LINK_LIFETIME).min(link.expires_at);
                let rows = dal::xrays(tx.conn(), link.patient_id).await?;
                entries.extend(rows.iter().map(|row| ("attachment", row.id)));
                xrays_out = Some(
                    rows.into_iter()
                        .map(|xray| XrayLink {
                            sig: files.signer().sign_share_file(
                                clinic,
                                ShareLinkId::from_uuid(link.id),
                                AttachmentId::from_uuid(xray.id),
                                expires,
                            ),
                            sig_expires_at: expires,
                            xray,
                        })
                        .collect(),
                );
            }
            RecordType::Bills => {
                let rows = billing_dal::invoices(
                    tx.conn(),
                    &InvoiceFilter {
                        patient_id: Some(link.patient_id),
                        status: Some("issued"),
                        limit: 200,
                        ..InvoiceFilter::default()
                    },
                )
                .await?;
                entries.extend(rows.iter().map(|row| ("invoice", row.id)));
                bills_out = Some(
                    rows.into_iter()
                        .map(|row| BillLine {
                            id: row.id,
                            number: row.number,
                            issued_at: row.issued_at,
                            total_paise: row.total_paise,
                            paid_paise: row.paid_paise,
                        })
                        .collect(),
                );
            }
        }
    }
    Ok((chart_out, xrays_out, bills_out))
}

fn kinds_of(link: &links::ShareLinkRow) -> Vec<RecordType> {
    link.record_types
        .iter()
        .flatten()
        .filter_map(|name| RecordType::parse(name))
        .collect()
}

/// Opens a link to records with the PIN. A wrong PIN counts and the fifth locks the link; a
/// right one returns the records and writes the access record.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token or a link that is not to records.
pub async fn open(
    db: &Db,
    files: &Files,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    pin: &str,
    now: OffsetDateTime,
) -> Result<OpenOutcome, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let link = links::share_link(tx.conn(), &hash_token(token))
            .await?
            .filter(|link| link.resource == "records")
            .ok_or(AppError::NotFound("link"))?;
        match LinkState::of(
            now,
            link.expires_at,
            link.revoked_at.is_some(),
            link.locked_at.is_some(),
        ) {
            LinkState::Locked => return Ok(OpenOutcome::Locked),
            LinkState::Expired => return Ok(OpenOutcome::Expired),
            LinkState::Usable => {}
        }
        let right =
            Pin::parse(pin).is_some_and(|pin| pin_hash(token, pin.as_str()) == link.pin_hash);
        if !right {
            let attempts = link.failed_attempts + 1;
            let locked = attempts >= MAX_PIN_ATTEMPTS;
            links::share_link_failed(tx.conn(), link.id, attempts, locked.then_some(now)).await?;
            return Ok(if locked {
                OpenOutcome::Locked
            } else {
                OpenOutcome::WrongPin(MAX_PIN_ATTEMPTS - attempts)
            });
        }
        links::share_link_opened(tx.conn(), link.id, now).await?;
        let kinds = kinds_of(&link);
        let mut entries = Vec::new();
        let (chart, xrays, bills) =
            contents(tx, files, clinic_id, &link, &kinds, &mut entries, now).await?;
        let patient_name = aarogyam_dal::patients::get(tx.conn(), link.patient_id, None)
            .await?
            .map(|patient| patient.full_name)
            .ok_or(AppError::NotFound("patient"))?;
        let request_text = request_id.map(|id| id.to_string());
        for (resource, resource_id) in entries {
            access::record(
                tx.conn(),
                &access::DocumentAccess {
                    actor_user_id: None,
                    actor_kind: PATIENT.as_str(),
                    patient_id: link.patient_id,
                    share_link_id: Some(link.id),
                    resource,
                    resource_id,
                    action: "view",
                    purpose: "patient_self",
                    request_id: request_text.as_deref(),
                },
            )
            .await?;
        }
        Ok(OpenOutcome::Opened(Box::new(Records {
            patient_name,
            record_types: kinds,
            chart,
            xrays,
            bills,
            expires_at: link.expires_at,
        })))
    })
    .await
}

/// An X-ray's bytes.
#[derive(Debug, Clone)]
pub struct Xray {
    /// The media type.
    pub mime_type: String,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// Why an X-ray download did not work.
#[derive(Debug)]
pub enum XrayRefusal {
    /// The signed token or the link has expired.
    Expired,
    /// Not a valid link, token or X-ray of this clinic.
    NotFound,
    /// Something failed.
    Failed(AppError),
}

/// Serves an X-ray through the link's signed token. The link must still be usable, include
/// X-rays, and belong to the same patient as the file. Writes the access record.
///
/// # Errors
/// [`XrayRefusal`] when the token or link is wrong or expired, or the file is not the patient's.
#[expect(
    clippy::too_many_arguments,
    reason = "the public request and its two proofs"
)]
pub async fn xray(
    db: &Db,
    files: &Files,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    link_token: &str,
    attachment: AttachmentId,
    sig: &str,
    now: OffsetDateTime,
) -> Result<Xray, XrayRefusal> {
    let mime_type = db
        .scoped(&public_scope(clinic_id, request_id), async |tx| {
            let link = links::share_link(tx.conn(), &hash_token(link_token))
                .await?
                .filter(|link| {
                    link.resource == "records" && kinds_of(link).contains(&RecordType::Xrays)
                })
                .ok_or(XrayRefusal::NotFound)?;
            files
                .signer()
                .verify_share_file(
                    clinic_id,
                    ShareLinkId::from_uuid(link.id),
                    attachment,
                    sig,
                    now,
                )
                .map_err(|refusal| match refusal {
                    LinkRefusal::Expired => XrayRefusal::Expired,
                    LinkRefusal::Invalid => XrayRefusal::NotFound,
                })?;
            if LinkState::of(
                now,
                link.expires_at,
                link.revoked_at.is_some(),
                link.locked_at.is_some(),
            ) != LinkState::Usable
            {
                return Err(XrayRefusal::Expired);
            }
            let mime = dal::xray_mime(tx.conn(), link.patient_id, attachment.uuid())
                .await?
                .ok_or(XrayRefusal::NotFound)?;
            let request_text = request_id.map(|id| id.to_string());
            access::record(
                tx.conn(),
                &access::DocumentAccess {
                    actor_user_id: None,
                    actor_kind: PATIENT.as_str(),
                    patient_id: link.patient_id,
                    share_link_id: Some(link.id),
                    resource: "attachment",
                    resource_id: attachment.uuid(),
                    action: "download",
                    purpose: "patient_self",
                    request_id: request_text.as_deref(),
                },
            )
            .await?;
            Ok::<_, XrayRefusal>(mime)
        })
        .await?;
    let bytes = files
        .storage()
        .get(StorageKey::new(clinic_id, attachment))
        .await
        .map_err(|_| XrayRefusal::Failed(AppError::Internal("could not read the file")))?;
    Ok(Xray { mime_type, bytes })
}

impl From<AppError> for XrayRefusal {
    fn from(error: AppError) -> Self {
        Self::Failed(error)
    }
}

impl From<sakalya_db::DbError> for XrayRefusal {
    fn from(error: sakalya_db::DbError) -> Self {
        Self::Failed(error.into())
    }
}
