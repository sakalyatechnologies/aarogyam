//! A patient's summary note and the list of their visit notes, for Patient 360.

use aarogyam_dal::patient_notes::{self as dal, SummaryRow, VisitNoteRow};
use aarogyam_domain::clinical::{NoteBody, NoteKind, NoteStatus};
use aarogyam_domain::ids::{ClinicalNoteId, EncounterId, PatientId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::richtext;
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::{Member, invalid, record_access, require_patient};
use aarogyam_domain::ids::MembershipId;

/// Most visit notes the list returns.
pub const MAX_NOTES: i64 = 100;

/// The patient's summary note.
#[derive(Debug, Clone)]
pub struct SummaryView {
    /// The formatted text (a Markdown subset).
    pub body: String,
    /// Goes up when the text changes; send it back as `If-Match` when editing.
    pub row_version: i64,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
    /// Who last changed it.
    pub updated_by: Option<String>,
}

impl From<SummaryRow> for SummaryView {
    fn from(row: SummaryRow) -> Self {
        Self {
            body: row.body,
            row_version: row.row_version,
            updated_at: row.updated_at,
            updated_by: row.updated_by_name,
        }
    }
}

/// A visit note as listed on the patient.
#[derive(Debug, Clone)]
pub struct VisitNoteView {
    /// Identifier.
    pub id: ClinicalNoteId,
    /// The visit.
    pub visit_id: EncounterId,
    /// The visit's number.
    pub visit_number: String,
    /// What it is for.
    pub kind: NoteKind,
    /// Where it is in its life.
    pub status: NoteStatus,
    /// Its sections.
    pub body: NoteBody,
    /// Who wrote it.
    pub author: Member,
    /// When it was signed.
    pub signed_at: Option<OffsetDateTime>,
    /// When it was written.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
    /// The note's version.
    pub row_version: i64,
    /// How many addenda it has.
    pub addenda_count: i64,
}

fn visit_note(row: VisitNoteRow) -> Result<VisitNoteView, AppError> {
    Ok(VisitNoteView {
        id: ClinicalNoteId::from_uuid(row.id),
        visit_id: EncounterId::from_uuid(row.encounter_id),
        visit_number: row.visit_number,
        kind: NoteKind::parse(&row.kind).map_err(invalid("kind"))?,
        status: NoteStatus::parse(&row.status).map_err(invalid("status"))?,
        body: serde_json::from_value(row.body).unwrap_or_default(),
        author: Member {
            id: MembershipId::from_uuid(row.author_id),
            name: row.author_name.unwrap_or_default(),
        },
        signed_at: row.signed_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        row_version: row.row_version,
        addenda_count: row.addenda_count,
    })
}

/// A patient's notes: the summary note and the visit notes.
#[derive(Debug, Clone)]
pub struct PatientNotes {
    /// The summary note, when one was written.
    pub summary: Option<SummaryView>,
    /// Visit notes, newest first.
    pub visit_notes: Vec<VisitNoteView>,
}

/// The patient's summary note and visit notes. Visit notes outside the caller's reach are left
/// out. Reading writes the access record.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach.
pub async fn get(
    db: &Db,
    actor: &aarogyam_domain::access::ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<PatientNotes, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalRead);
        let overview = dal::overview(tx.conn(), patient_id.uuid(), reach.member(), MAX_NOTES)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        record_access(
            tx,
            actor,
            request_id,
            patient_id.uuid(),
            "note",
            None,
            "view",
        )
        .await?;
        Ok(PatientNotes {
            summary: overview.summary.map(SummaryView::from),
            visit_notes: overview
                .visit_notes
                .into_iter()
                .map(visit_note)
                .collect::<Result<_, _>>()?,
        })
    })
    .await
}

/// Saves the patient's summary note: the first save creates it; later saves replace the text,
/// and with `expected_version` are refused when the note changed since it was read.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach;
/// [`AppError::Invalid`] for text outside the Markdown subset; [`AppError::Stale`] when
/// `expected_version` is out of date.
pub async fn save_summary(
    db: &Db,
    actor: &aarogyam_domain::access::ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    expected_version: Option<i64>,
    text: &str,
) -> Result<SummaryView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let body = richtext::summary(text).map_err(invalid("body"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        require_patient(tx, patient_id, actor.reach(Permission::ClinicalWrite)).await?;
        let row = if let Some(current) = dal::lock_summary(tx.conn(), patient_id.uuid()).await? {
            AppError::check_version(expected_version, current)?;
            dal::update_summary(tx.conn(), patient_id.uuid(), &body).await?
        } else {
            // No note yet: a client that expected a version saw a different record.
            AppError::check_version(expected_version, 0)?;
            if let Some(row) = dal::insert_summary(tx.conn(), patient_id.uuid(), &body).await? {
                row
            } else {
                // Someone saved the first note a moment ago.
                let current = dal::lock_summary(tx.conn(), patient_id.uuid())
                    .await?
                    .unwrap_or(1);
                return Err(AppError::Stale { current });
            }
        };
        Ok(row.into())
    })
    .await
}
