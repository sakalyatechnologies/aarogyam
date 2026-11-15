//! What the patient app shows of a visit: the clinic and doctor, the date, the treatments done
//! (name and tooth, no fees), the advice, the issued prescription, the next open recall and the
//! last five earlier visits (date and title). The advice is the Plan section of the visit's signed
//! notes and nothing else: Subjective, Objective and Assessment never reach a patient account.

use aarogyam_dal::access;
use aarogyam_dal::patient_visits::{self as dal, HeadRow, PrescriptionRow, TreatmentRow};
use aarogyam_domain::ids::EncounterId;
use sakalya_db::{Db, ScopedTx};
use serde::Deserialize;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::patient_app::{LinkedClinic, PatientAccess, read_clinic};

/// How many earlier visits a summary lists.
pub const EARLIER_VISITS: i64 = 5;
/// Most visits the patient app lists for one clinic.
pub const MAX_LISTED: usize = 25;

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
