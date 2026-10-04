//! Reads that gather a patient's clinical record from several modules: everything recorded in
//! one visit.

use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::{self, NoteView, VisitView};

/// Everything recorded in a visit.
#[derive(Debug, Clone)]
pub struct VisitDetail {
    /// The visit.
    pub visit: VisitView,
    /// Its notes with their addenda, oldest first.
    pub notes: Vec<NoteView>,
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
        Ok(VisitDetail {
            visit: opened.visit,
            notes: opened.notes,
        })
    })
    .await
}
