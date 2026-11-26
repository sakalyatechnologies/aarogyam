//! Free-text notes on a tooth: the doctor types or dictates, nothing else is needed. Notes are
//! only added; to fix one the doctor adds a new one. They show newest first.

use aarogyam_dal::tooth_notes::{self as dal, NewToothNote, ToothNoteRow};
use aarogyam_dal::visits::lock_client_id;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::dental::{Tooth, ToothNoteBody};
use aarogyam_domain::ids::{EncounterId, MembershipId, PatientId, ToothNoteId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::chart::open_visit;
use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::require_patient;

/// The most notes one read returns.
const LIST_LIMIT: i64 = 50;

/// A note on a tooth.
#[derive(Debug, Clone)]
pub struct ToothNoteView {
    /// Identifier.
    pub id: ToothNoteId,
    /// The tooth.
    pub tooth: Tooth,
    /// The text.
    pub body: String,
    /// The visit it joined.
    pub visit_id: Option<EncounterId>,
    /// The member who wrote it.
    pub recorded_by: Option<MembershipId>,
    /// Their name, when known.
    pub recorded_by_name: Option<String>,
    /// When it was written.
    pub recorded_at: OffsetDateTime,
}

/// The start of a tooth's newest note, for marking the chart.
#[derive(Debug, Clone)]
pub struct LatestNoteView {
    /// The tooth.
    pub tooth: Tooth,
    /// The newest note's first 120 characters.
    pub latest_note: String,
}

fn stored_tooth(tooth: i16) -> Result<Tooth, AppError> {
    Tooth::new(i64::from(tooth))
        .map_err(|_| AppError::Internal("a stored tooth note has a bad tooth"))
}

fn view(row: ToothNoteRow) -> Result<ToothNoteView, AppError> {
    Ok(ToothNoteView {
        id: ToothNoteId::from_uuid(row.id),
        tooth: stored_tooth(row.tooth)?,
        body: row.body,
        visit_id: row.visit_id.map(EncounterId::from_uuid),
        recorded_by: row.recorded_by.map(MembershipId::from_uuid),
        recorded_by_name: row.recorded_by_name,
        recorded_at: row.created_at,
    })
}

/// The newest note of each tooth of the patient that has one.
pub(crate) async fn latest(
    tx: &mut ScopedTx,
    patient_id: Uuid,
) -> Result<Vec<LatestNoteView>, AppError> {
    dal::latest_tooth_notes(tx.conn(), patient_id)
        .await?
        .into_iter()
        .map(|row| {
            Ok(LatestNoteView {
                tooth: stored_tooth(row.tooth)?,
                latest_note: row.latest_note,
            })
        })
        .collect()
}

/// Adds a note to a tooth, in the open visit when there is one; no visit is needed. A retry
/// with the same `client_id` and body returns the first note.
///
/// # Errors
/// [`AppError::Invalid`] for a bad tooth or body; [`AppError::NotFound`] when the patient isn't
/// in this clinic or reach; [`AppError::IdConflict`] when the `client_id` made something else.
pub async fn add_tooth_note(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    tooth: i64,
    body: &str,
    client_id: Option<Uuid>,
) -> Result<ToothNoteView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let tooth = Tooth::new(tooth).map_err(|error| AppError::invalid("tooth", error))?;
    let body = ToothNoteBody::new(body).map_err(|error| AppError::invalid("body", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalWrite);
        let patient = require_patient(tx, patient_id, reach).await?;
        let tooth = i16::from(tooth.number());
        if let Some(client_id) = client_id {
            lock_client_id(tx.conn(), client_id).await?;
            if let Some(row) = dal::tooth_note_by_client_id(tx.conn(), client_id).await? {
                if row.patient_id == patient.id && row.tooth == tooth && row.body == body.as_str() {
                    return view(row);
                }
                return Err(AppError::IdConflict);
            }
        }
        let visit_id = open_visit(tx, patient.id, reach.member()).await?;
        let row = dal::insert_tooth_note(
            tx.conn(),
            &NewToothNote {
                id: ToothNoteId::new_v7().uuid(),
                patient_id: patient.id,
                tooth,
                visit_id,
                body: body.as_str(),
                client_id,
                recorded_by: actor.membership_id.uuid(),
            },
        )
        .await?;
        view(row)
    })
    .await
}

/// A tooth's notes, newest first (at most 50).
///
/// # Errors
/// [`AppError::Invalid`] for a bad tooth; [`AppError::NotFound`] when the patient isn't in this
/// clinic or reach.
pub async fn list_tooth_notes(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    tooth: i64,
) -> Result<Vec<ToothNoteView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let tooth = Tooth::new(tooth).map_err(|error| AppError::invalid("tooth", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient =
            require_patient(tx, patient_id, actor.reach(Permission::ClinicalRead)).await?;
        dal::list_tooth_notes(tx.conn(), patient.id, i16::from(tooth.number()), LIST_LIMIT)
            .await?
            .into_iter()
            .map(view)
            .collect()
    })
    .await
}
