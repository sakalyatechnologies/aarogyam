//! What the patient sees after a visit: a link to one visit (opened with a PIN on the clinic's
//! host, as for prescriptions) and the same summary in the patient app.
//!
//! The summary holds the clinic and doctor, the date, the treatments done (name and tooth, no
//! fees), the advice, the issued prescription, the next follow-up and the last five earlier
//! visits (date and title). The advice is the Plan section of the visit's signed notes and
//! nothing else: the Subjective, Objective and Assessment sections are clinical working notes
//! and never reach a link or a patient account.

use aarogyam_dal::visit_shares::{self as dal, HeadRow, PrescriptionRow, TreatmentRow};
use aarogyam_dal::{access, prescriptions as links, visits};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{ClinicId, EncounterId, ShareLinkId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::share::{LINK_LIFETIME, LinkState, MAX_PIN_ATTEMPTS, Pin};
use sakalya_db::{Db, ScopedTx};
use serde::Deserialize;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::patient_app::{LinkedClinic, PatientAccess, read_clinic};
use crate::scope::{PATIENT, public_scope, staff_scope};
use crate::share::{NewLink, new_pin, pin_hash};
use crate::tokens::{hash_token, new_token};

/// How many earlier visits a summary lists.
pub const EARLIER_VISITS: i64 = 5;
/// Most visits the patient app lists for one clinic.
pub const MAX_LISTED: usize = 25;

/// Makes a link to a visit, valid for seven days, with a PIN. Writes the access record.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`; [`AppError::NotFound`] for a visit out of
/// reach or in another clinic.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    encounter_id: EncounterId,
    now: OffsetDateTime,
) -> Result<NewLink, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let reach = actor.reach(Permission::ClinicalRead);
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let visit = visits::get_encounter(tx.conn(), encounter_id.uuid(), false, reach.member())
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        let (token, token_hash) = new_token()?;
        let pin = new_pin()?;
        let id = ShareLinkId::new_v7();
        let expires_at = now + LINK_LIFETIME;
        dal::insert(
            tx.conn(),
            &dal::NewVisitLink {
                id: id.uuid(),
                token_hash: &token_hash,
                pin_hash: &pin_hash(&token, &pin),
                encounter_id: visit.id,
                patient_id: visit.patient_id,
                expires_at,
            },
        )
        .await?;
        let request_text = request_id.map(|id| id.to_string());
        access::record(
            tx.conn(),
            &access::DocumentAccess {
                actor_user_id: Some(actor.user_id.uuid()),
                actor_kind: crate::scope::actor_kind(actor).as_str(),
                patient_id: visit.patient_id,
                share_link_id: Some(id.uuid()),
                resource: "chart",
                resource_id: visit.id,
                action: "share",
                purpose: actor.access_purpose(),
                request_id: request_text.as_deref(),
            },
        )
        .await?;
        Ok::<_, AppError>(NewLink {
            id,
            token,
            pin,
            expires_at,
        })
    })
    .await
}

/// A procedure done in the visit.
#[derive(Debug, Clone)]
pub struct Treatment {
    /// What was done.
    pub name: String,
    /// FDI tooth number.
    pub tooth: Option<i16>,
    /// Surfaces, such as `O`.
    pub surfaces: Vec<String>,
}

/// One medicine of the visit's prescription.
#[derive(Debug, Clone, Deserialize)]
pub struct RxLine {
    /// As printed.
    pub drug_name: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// Form, such as `tablet`.
    pub form: Option<String>,
    /// How much per dose.
    pub dose: String,
    /// `1-0-1`.
    pub frequency: String,
    /// `after_food`, …
    pub timing: Option<String>,
    /// For how many days.
    pub duration_days: Option<i16>,
    /// In the prescription's language.
    pub instructions: Option<String>,
}

/// The prescription issued in the visit.
#[derive(Debug, Clone)]
pub struct RxSummary {
    /// `RX-…`.
    pub number: String,
    /// The clinic day it was issued.
    pub issued_on: Date,
    /// The medicines in order.
    pub items: Vec<RxLine>,
}

/// The next follow-up.
#[derive(Debug, Clone)]
pub struct FollowUp {
    /// The day it is due.
    pub due_on: Date,
    /// `follow_up`, `cleaning`, …
    pub kind: String,
}

/// An earlier visit: the date and a title, nothing clinical.
#[derive(Debug, Clone)]
pub struct EarlierVisit {
    /// The clinic day.
    pub visited_on: Date,
    /// The treatments done, or `Consultation`.
    pub title: String,
}

/// What a patient sees of one visit.
#[derive(Debug, Clone)]
pub struct VisitSummary {
    /// The visit.
    pub id: Uuid,
    /// `V-318`.
    pub number: String,
    /// The clinic's name.
    pub clinic_name: String,
    /// The clinic day of the visit.
    pub visited_on: Date,
    /// The doctor's name.
    pub doctor_name: Option<String>,
    /// What was done.
    pub treatments: Vec<Treatment>,
    /// The Plan section of the signed notes.
    pub advice: Option<String>,
    /// The issued prescription, when one is linked to the visit.
    pub prescription: Option<RxSummary>,
    /// The patient's next open recall.
    pub next_follow_up: Option<FollowUp>,
    /// The last five visits before this one, newest first.
    pub earlier_visits: Vec<EarlierVisit>,
}

/// Fallback title of a visit with no treatment done.
const CONSULTATION: &str = "Consultation";

fn title(treatments: &[&TreatmentRow]) -> String {
    let mut names: Vec<&str> = Vec::new();
    for row in treatments {
        if !names.contains(&row.name.as_str()) {
            names.push(&row.name);
        }
    }
    if names.is_empty() {
        CONSULTATION.to_owned()
    } else {
        names.join(", ")
    }
}

/// The rows a summary is made of, read in one clinic transaction.
struct Raw {
    heads: Vec<HeadRow>,
    earlier: Vec<HeadRow>,
    treatments: Vec<TreatmentRow>,
    prescriptions: Vec<PrescriptionRow>,
    follow_up: Option<dal::FollowUpRow>,
}

/// Reads the rows for `heads` (newest first) and for `earlier`, the visits older than the last
/// of them, so every summary can list its five earlier visits.
async fn fetch(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    today: Date,
    heads: Vec<HeadRow>,
    earlier: Vec<HeadRow>,
) -> Result<Raw, sakalya_db::DbError> {
    let ids: Vec<Uuid> = heads.iter().chain(&earlier).map(|head| head.id).collect();
    Ok(Raw {
        treatments: dal::treatments(tx.conn(), patient_id, &ids).await?,
        prescriptions: dal::prescriptions(tx.conn(), patient_id, &ids).await?,
        follow_up: dal::next_follow_up(tx.conn(), patient_id, today).await?,
        heads,
        earlier,
    })
}

/// The visits a patient may see, newest first, with the five visits before each.
fn compose(raw: &Raw, clinic_name: &str, timezone: &str) -> Result<Vec<VisitSummary>, AppError> {
    let day = |at: OffsetDateTime| clinic_today(timezone, at);
    let all: Vec<&HeadRow> = raw.heads.iter().chain(&raw.earlier).collect();
    let mut out = Vec::with_capacity(raw.heads.len());
    for (index, head) in raw.heads.iter().enumerate() {
        let done = |id: Uuid| -> Vec<&TreatmentRow> {
            raw.treatments
                .iter()
                .filter(|row| row.encounter_id == id)
                .collect()
        };
        let prescription = raw
            .prescriptions
            .iter()
            .find(|row| row.encounter_id == head.id)
            .map(|row| {
                Ok::<_, AppError>(RxSummary {
                    number: row.number.clone(),
                    issued_on: day(row.issued_at),
                    items: serde_json::from_value(row.items.clone())
                        .map_err(|_| AppError::Internal("unreadable prescription lines"))?,
                })
            })
            .transpose()?;
        out.push(VisitSummary {
            id: head.id,
            number: head.number.clone(),
            clinic_name: clinic_name.to_owned(),
            visited_on: day(head.started_at),
            doctor_name: head.doctor_name.clone(),
            treatments: done(head.id)
                .into_iter()
                .map(|row| Treatment {
                    name: row.name.clone(),
                    tooth: row.tooth,
                    surfaces: row.surfaces.clone(),
                })
                .collect(),
            advice: head.advice.clone(),
            prescription,
            next_follow_up: raw.follow_up.as_ref().map(|row| FollowUp {
                due_on: row.due_on,
                kind: row.kind.clone(),
            }),
            earlier_visits: all
                .iter()
                .skip(index + 1)
                .take(usize::try_from(EARLIER_VISITS).unwrap_or(5))
                .map(|older| EarlierVisit {
                    visited_on: day(older.started_at),
                    title: title(&done(older.id)),
                })
                .collect(),
        });
    }
    Ok(out)
}

/// The rows of one visit of `patient_id`, `None` when the patient has no such visit.
async fn fetch_one(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    encounter_id: Uuid,
    today: Date,
) -> Result<Option<Raw>, sakalya_db::DbError> {
    let heads = dal::heads(tx.conn(), patient_id, Some(encounter_id), None, 1).await?;
    let Some(head) = heads.first() else {
        return Ok(None);
    };
    let earlier = dal::heads(
        tx.conn(),
        patient_id,
        None,
        Some(head.started_at),
        EARLIER_VISITS,
    )
    .await?;
    Ok(Some(fetch(tx, patient_id, today, heads, earlier).await?))
}

/// What opening a visit link did.
#[derive(Debug, Clone)]
pub enum OpenOutcome {
    /// The PIN was right.
    Opened(Box<VisitSummary>),
    /// The PIN was wrong; this many tries are left.
    WrongPin(i32),
    /// Too many wrong PINs; the clinic must send a new link.
    Locked,
    /// Past its expiry, or revoked.
    Expired,
}

/// Opens a link to a visit with the PIN. A wrong PIN counts and the fifth locks the link; a
/// right one returns the summary and writes the access record.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown token or a link that is not to a visit.
pub async fn open(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    token: &str,
    pin: &str,
    now: OffsetDateTime,
) -> Result<OpenOutcome, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let link = links::share_link(tx.conn(), &hash_token(token))
            .await?
            .filter(|link| link.resource == "visit")
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
        let encounter_id = dal::link_encounter(tx.conn(), link.id)
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        links::share_link_opened(tx.conn(), link.id, now).await?;
        let (clinic_name, timezone) = links::clinic_name(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let raw = fetch_one(
            tx,
            link.patient_id,
            encounter_id,
            clinic_today(&timezone, now),
        )
        .await?
        .ok_or(AppError::NotFound("visit"))?;
        let summary = compose(&raw, &clinic_name, &timezone)?
            .pop()
            .ok_or(AppError::NotFound("visit"))?;
        let request_text = request_id.map(|id| id.to_string());
        access::record(
            tx.conn(),
            &access::DocumentAccess {
                actor_user_id: None,
                actor_kind: PATIENT.as_str(),
                patient_id: link.patient_id,
                share_link_id: Some(link.id),
                resource: "chart",
                resource_id: encounter_id,
                action: "view",
                purpose: "patient_self",
                request_id: request_text.as_deref(),
            },
        )
        .await?;
        Ok(OpenOutcome::Opened(Box::new(summary)))
    })
    .await
}

/// A visit summary at one of the patient's linked clinics.
pub type PatientVisits = Vec<(usize, VisitSummary)>;

fn view_access<'a>(
    reader: &'a aarogyam_dal::patient_app::Reader<'a>,
    resource_id: Option<Uuid>,
) -> access::DocumentAccess<'a> {
    access::DocumentAccess {
        actor_user_id: Some(reader.account_id),
        actor_kind: "patient",
        patient_id: reader.patient_id,
        share_link_id: None,
        resource: "chart",
        resource_id: resource_id.unwrap_or(reader.patient_id),
        action: "view",
        purpose: "patient_self",
        request_id: reader.request_id,
    }
}

/// The patient's visits at every linked clinic, newest first within each clinic (at most
/// [`MAX_LISTED`] each), with the same summary as a link. Writes the access record.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn list(
    db: &Db,
    access: &PatientAccess,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<PatientVisits, AppError> {
    let mut all = Vec::new();
    for (index, clinic) in access.clinics.iter().enumerate() {
        let timezone = clinic.place.timezone.as_str();
        let patient_id = clinic.patient_id.uuid();
        let raw = read_clinic(db, access, clinic, request_id, async |tx, reader| {
            access::record(tx.conn(), &view_access(&reader, None)).await?;
            let limit = i64::try_from(MAX_LISTED).unwrap_or(25) + EARLIER_VISITS;
            let mut heads = dal::heads(tx.conn(), patient_id, None, None, limit).await?;
            let earlier = heads.split_off(heads.len().min(MAX_LISTED));
            fetch(tx, patient_id, clinic_today(timezone, now), heads, earlier).await
        })
        .await?;
        all.extend(
            compose(&raw, &clinic.name, timezone)?
                .into_iter()
                .map(|summary| (index, summary)),
        );
    }
    Ok(all)
}

/// One visit of the patient at `clinic`, `None` when it isn't theirs.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn get(
    db: &Db,
    access: &PatientAccess,
    clinic: &LinkedClinic,
    request_id: Option<Uuid>,
    id: EncounterId,
    now: OffsetDateTime,
) -> Result<Option<VisitSummary>, AppError> {
    let timezone = clinic.place.timezone.as_str();
    let patient_id = clinic.patient_id.uuid();
    let raw = read_clinic(db, access, clinic, request_id, async |tx, reader| {
        let raw = fetch_one(tx, patient_id, id.uuid(), clinic_today(timezone, now)).await?;
        if raw.is_some() {
            access::record(tx.conn(), &view_access(&reader, Some(id.uuid()))).await?;
        }
        Ok(raw)
    })
    .await?;
    raw.map(|raw| compose(&raw, &clinic.name, timezone))
        .transpose()
        .map(|found| found.and_then(|mut one| one.pop()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_visit_without_treatments_is_a_consultation() {
        assert_eq!(title(&[]), "Consultation");
    }

    #[test]
    fn a_title_lists_each_treatment_once() {
        let row = |name: &str| TreatmentRow {
            encounter_id: Uuid::nil(),
            name: name.to_owned(),
            tooth: None,
            surfaces: Vec::new(),
        };
        let (a, b, c) = (row("Filling"), row("Scaling"), row("Filling"));
        assert_eq!(title(&[&a, &b, &c]), "Filling, Scaling");
    }
}
