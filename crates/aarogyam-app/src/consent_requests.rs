//! "Send consent to sign": staff ask a patient to agree to the clinic's notice from their own
//! phone. The request goes out as a care message (the one that asks for consent can't wait for
//! consent) through the `messages` queue with a one-time link; the public page on the clinic's
//! host shows the notice and signs. Signing records the consents (method `app`, recorded under
//! the member who asked) and closes the request. Seven days, once.

use aarogyam_dal::consent_requests::{self as dal, NewRequest};
use aarogyam_dal::consents::{self, NoticeChoice};
use aarogyam_dal::{clinic, patients, staff};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::consent::{Method, Purpose};
use aarogyam_domain::ids::{ClinicId, PatientId};
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use serde_json::json;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_offset;
use crate::error::AppError;
use crate::messaging::{PatientEmail, enqueue_patient_email};
use crate::notices;
use crate::scope::{public_scope, staff_scope};
use crate::tokens::{hash_token, new_token};

/// How long a consent link works.
pub const LIFETIME: Duration = Duration::days(7);

/// A request as received from staff.
#[derive(Debug, Clone)]
pub struct NewConsentRequest {
    /// The purposes to ask about; `care` when empty. Each once.
    pub purposes: Vec<Purpose>,
    /// The published notice to show; the clinic's current notice when absent.
    pub notice_id: Option<Uuid>,
}

/// A request made.
#[derive(Debug, Clone)]
pub struct Requested {
    /// Identifier.
    pub id: Uuid,
    /// The purposes asked about.
    pub purposes: Vec<Purpose>,
    /// The notice's label.
    pub notice_version: String,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
}

fn purposes_of(input: &[Purpose]) -> Result<Vec<Purpose>, AppError> {
    let mut purposes: Vec<Purpose> = if input.is_empty() {
        vec![Purpose::Care]
    } else {
        input.to_vec()
    };
    purposes.sort_by_key(|p| p.as_str());
    purposes.dedup();
    if purposes.len() != input.len().max(1) {
        return Err(AppError::invalid("purposes", "name each purpose once"));
    }
    Ok(purposes)
}

/// Asks a patient to read the clinic's notice and sign, by email through the message queue.
/// Needs `patients.write`; the patient must have an email address.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach;
/// [`AppError::Invalid`] for repeated purposes or an unknown notice; [`AppError::Conflict`]
/// when the patient has no email address or the clinic has no portal address yet.
pub async fn request(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: NewConsentRequest,
    now: OffsetDateTime,
) -> Result<Requested, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let purposes = purposes_of(&input.purposes)?;
    let names: Vec<String> = purposes.iter().map(|p| p.as_str().to_owned()).collect();
    let (token, token_hash) = new_token()?;
    let expires_at = now + LIFETIME;
    let id = Uuid::now_v7();
    let reach = actor.reach(Permission::PatientsWrite).member();
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let patient = patients::get(tx.conn(), patient_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        if patient.email.is_none() {
            return Err(AppError::Conflict(
                "the patient has no email address to send the link to",
            ));
        }
        let (label, notice_id) = notices::resolve(tx, input.notice_id, None).await?;
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let host = staff::portal_host(tx.conn())
            .await?
            .ok_or(AppError::Conflict("the clinic has no portal address yet"))?;
        dal::insert(
            tx.conn(),
            &NewRequest {
                id,
                patient_id: patient_id.uuid(),
                token_hash: &token_hash,
                purposes: &names,
                notice_id,
                notice_version: &label,
                requested_by: actor.membership_id.uuid(),
                expires_at,
            },
        )
        .await?;
        let expires_on = expires_at
            .to_offset(clinic_offset(&profile.timezone))
            .date();
        // Ids and non-patient values only; the address is read when the message is sent.
        enqueue_patient_email(
            tx,
            &PatientEmail {
                kind: MessageKind::ConsentRequested,
                patient_id,
                payload: json!({
                    "clinic_name": profile.name,
                    "portal_host": host,
                    "expires_on": expires_on.to_string(),
                }),
                secret: Some(&token),
                appointment_id: None,
            },
        )
        .await?;
        Ok::<_, AppError>(Requested {
            id,
            purposes,
            notice_version: label,
            expires_at,
        })
    })
    .await
}

/// Where a consent link stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkState {
    /// Waiting for the patient.
    Pending,
    /// The patient signed.
    Signed,
    /// Past its expiry.
    Expired,
}

impl LinkState {
    /// The word the API uses.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Signed => "signed",
            Self::Expired => "expired",
        }
    }

    fn of(
        signed_at: Option<OffsetDateTime>,
        expires_at: OffsetDateTime,
        now: OffsetDateTime,
    ) -> Self {
        if signed_at.is_some() {
            Self::Signed
        } else if now > expires_at {
            Self::Expired
        } else {
            Self::Pending
        }
    }
}

/// What anyone holding the link may read: the clinic's name, what is asked and the notice.
/// Nothing about the patient.
#[derive(Debug, Clone)]
pub struct Preview {
    /// The clinic's name.
    pub clinic_name: String,
    /// Where the link stands.
    pub state: LinkState,
    /// The purposes asked about.
    pub purposes: Vec<Purpose>,
    /// The notice's label.
    pub notice_version: String,
    /// The notice's text, when the clinic has published one.
    pub notice_body: Option<String>,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
}

fn parse_purposes(stored: &[String]) -> Result<Vec<Purpose>, AppError> {
    stored
        .iter()
        .map(|p| Purpose::parse(p).map_err(|_| AppError::Internal("unknown purpose")))
        .collect()
}

/// Reads a consent link by its token on the clinic's host.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token.
pub async fn preview(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    now: OffsetDateTime,
) -> Result<Preview, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let row = dal::by_token(tx.conn(), &hash_token(token))
            .await?
            .ok_or(AppError::NotFound("link"))?;
        let (clinic_name, _) = aarogyam_dal::prescriptions::clinic_name(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        Ok(Preview {
            clinic_name,
            state: LinkState::of(row.signed_at, row.expires_at, now),
            purposes: parse_purposes(&row.purposes)?,
            notice_version: row.notice_version,
            notice_body: row.notice_body,
            expires_at: row.expires_at,
        })
    })
    .await
}

/// What signing did.
#[derive(Debug, Clone)]
pub enum SignOutcome {
    /// Consent was recorded for these purposes (ones already in force were left as they are).
    Signed(Vec<Purpose>),
    /// The patient already signed this link.
    AlreadySigned,
    /// The link is past its expiry.
    Expired,
}

/// The patient signs: records consent for `chosen` purposes (all that were asked when `None`)
/// against the notice the link showed, and closes the link. Once only.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token; [`AppError::Invalid`] for a purpose that wasn't
/// asked about or none at all.
pub async fn sign(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    chosen: Option<Vec<Purpose>>,
    now: OffsetDateTime,
) -> Result<SignOutcome, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let row = dal::lock_by_token(tx.conn(), &hash_token(token))
            .await?
            .ok_or(AppError::NotFound("link"))?;
        match LinkState::of(row.signed_at, row.expires_at, now) {
            LinkState::Signed => return Ok(SignOutcome::AlreadySigned),
            LinkState::Expired => return Ok(SignOutcome::Expired),
            LinkState::Pending => {}
        }
        let asked = parse_purposes(&row.purposes)?;
        let chosen = match chosen {
            None => asked,
            Some(chosen) => {
                if chosen.is_empty() || chosen.iter().any(|p| !asked.contains(p)) {
                    return Err(AppError::invalid(
                        "purposes",
                        "name at least one purpose, only ones the clinic asked about",
                    ));
                }
                chosen
            }
        };
        let purposes: Vec<String> = chosen.iter().map(|p| p.as_str().to_owned()).collect();
        let methods = vec![Method::App.as_str().to_owned(); purposes.len()];
        let recorded = consents::insert_many(
            tx.conn(),
            row.patient_id,
            &purposes,
            &methods,
            NoticeChoice::Named(&row.notice_version, row.notice_id),
            row.requested_by,
        )
        .await?
        .iter()
        .map(|key| Purpose::parse(key).map_err(|_| AppError::Internal("unknown purpose")))
        .collect::<Result<Vec<_>, _>>()?;
        dal::mark_signed(tx.conn(), row.id).await?;
        Ok(SignOutcome::Signed(recorded))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn care_is_asked_by_default_and_each_purpose_once() {
        assert_eq!(purposes_of(&[]).unwrap(), vec![Purpose::Care]);
        assert!(purposes_of(&[Purpose::Care, Purpose::Care]).is_err());
        assert_eq!(
            purposes_of(&[Purpose::Reminders, Purpose::Care]).unwrap(),
            vec![Purpose::Care, Purpose::Reminders]
        );
    }

    #[test]
    fn a_link_is_pending_until_signed_or_expired() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let later = now + Duration::days(1);
        assert_eq!(LinkState::of(None, later, now), LinkState::Pending);
        assert_eq!(LinkState::of(None, now, later), LinkState::Expired);
        assert_eq!(LinkState::of(Some(now), now, later), LinkState::Signed);
    }
}
