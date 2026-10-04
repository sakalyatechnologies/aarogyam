//! Reads that gather a patient's clinical record from several modules: everything recorded in
//! one visit.

use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use uuid::Uuid;

use crate::chart::{self, ChartEntryView};
use crate::error::AppError;
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
            visit: opened.visit,
            notes: opened.notes,
        })
    })
    .await
}
