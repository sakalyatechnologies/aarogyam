//! Reads that gather a patient's clinical record from several modules: everything recorded in
//! one visit, and a patient's timeline.

use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{EncounterId, PatientId};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use sakalya_types::Paise;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::chart::{self, ChartEntryView};
use crate::error::AppError;
use crate::files::{self, AttachmentView};
use crate::scope::staff_scope as scope;
use crate::treatment::{self, ProcedureView};
use crate::visits::{self, NoteView, VisitView};
use crate::vitals::{self, ObservationView};

/// Everything recorded in a visit.
#[derive(Debug, Clone)]
pub struct VisitDetail {
    /// The visit.
    pub visit: VisitView,
    /// Its notes with their addenda, oldest first.
    pub notes: Vec<NoteView>,
    /// Vital signs, oldest first, corrected ones included.
    pub observations: Vec<ObservationView>,
    /// Dental chart entries recorded in the visit.
    pub chart_entries: Vec<ChartEntryView>,
    /// Procedures planned or done in the visit.
    pub procedures: Vec<ProcedureView>,
    /// Files attached to the visit.
    pub attachments: Vec<AttachmentView>,
}

/// Opens a visit with everything recorded in it, and writes the access record.
///
/// # Errors
/// [`AppError::NotFound`] when the visit isn't in this clinic.
pub async fn open_visit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
) -> Result<VisitDetail, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let opened = visits::open_in(tx, actor, request_id, visit_id).await?;
        let id = opened.visit.id.uuid();
        Ok(VisitDetail {
            observations: vitals::of_visit(tx, id).await?,
            chart_entries: chart::of_visit(tx, id).await?,
            procedures: treatment::of_visit(tx, id).await?,
            attachments: files::of_visit(tx, id).await?,
            visit: opened.visit,
            notes: opened.notes,
        })
    })
    .await
}

/// Most events a timeline page returns.
pub const MAX_EVENTS: i64 = 200;

/// What a timeline event is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    /// A visit started.
    Visit,
    /// A note was signed.
    Note,
    /// A procedure was planned or done.
    Procedure,
    /// A file was added.
    Attachment,
}

impl EventKind {
    /// The name sent over the API.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Visit => "visit",
            Self::Note => "note",
            Self::Procedure => "procedure",
            Self::Attachment => "attachment",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        [Self::Visit, Self::Note, Self::Procedure, Self::Attachment]
            .into_iter()
            .find(|kind| kind.as_str() == text)
    }
}

/// One event on a patient's timeline.
#[derive(Debug, Clone)]
pub struct TimelineEvent {
    /// What it is.
    pub kind: EventKind,
    /// The record's id.
    pub id: Uuid,
    /// When it happened.
    pub at: OffsetDateTime,
    /// The visit it belongs to.
    pub visit_id: Option<EncounterId>,
    /// A short title: visit number, note kind, procedure name or file kind.
    pub title: String,
    /// More detail: the chief complaint, assessment, tooth or caption.
    pub detail: Option<String>,
    /// The record's status.
    pub status: Option<String>,
    /// The member responsible.
    pub by: Option<visits::Member>,
    /// The fee, for procedures.
    pub amount: Option<Paise>,
}

/// A patient's clinical timeline, newest first: visits, signed notes, procedures and files.
/// Reading it writes the access record.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn timeline(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    before: Option<OffsetDateTime>,
    limit: i64,
) -> Result<Vec<TimelineEvent>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let limit = limit.clamp(1, MAX_EVENTS);
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalRead);
        let patient = visits::require_patient(tx, patient_id, reach).await?;
        visits::record_access(tx, actor, request_id, patient.id, "chart", None, "view").await?;
        let rows =
            aarogyam_dal::timeline::events(tx.conn(), patient.id, before, limit, reach.member())
                .await?;
        let names = visits::Names::load(tx, rows.iter().filter_map(|row| row.member_id)).await?;
        rows.into_iter()
            .map(|row| {
                Ok(TimelineEvent {
                    kind: EventKind::parse(&row.kind)
                        .ok_or(AppError::Internal("unknown timeline event"))?,
                    id: row.id,
                    at: row.at,
                    visit_id: row.visit_id.map(EncounterId::from_uuid),
                    title: row.title,
                    detail: row.detail,
                    status: row.status,
                    by: row.member_id.map(|id| names.member(id)),
                    amount: row.amount_paise.map(Paise::new),
                })
            })
            .collect()
    })
    .await
}
