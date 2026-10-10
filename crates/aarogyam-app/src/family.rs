//! Family under one mobile number: link patients of a clinic as guardian, child, spouse, parent
//! or sibling. A link and its inverse are written and removed together, so either patient lists
//! the other. Reading needs `patients.read`; changing needs `patients.write`; both patients must
//! be in the caller's reach.

use aarogyam_dal::family::{self as dal, RelationRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::family::{Relation, check_link};
use aarogyam_domain::ids::{PatientId, PatientRelationId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

use crate::visits::{invalid, require_patient};

/// A family link as listed.
#[derive(Debug, Clone)]
pub struct RelationView {
    /// The link.
    pub id: PatientRelationId,
    /// The related patient.
    pub related_patient_id: PatientId,
    /// Their readable number.
    pub number: String,
    /// Their full name.
    pub full_name: String,
    /// What they are to the patient.
    pub relation: Relation,
    /// Whether they are the contact person.
    pub is_primary_contact: bool,
}

fn view(row: RelationRow) -> Result<RelationView, AppError> {
    Ok(RelationView {
        id: PatientRelationId::from_uuid(row.id),
        related_patient_id: PatientId::from_uuid(row.related_patient_id),
        number: row.number,
        full_name: row.full_name,
        relation: Relation::parse(&row.relation).map_err(invalid("relation"))?,
        is_primary_contact: row.is_primary_contact,
    })
}

/// A new link.
#[derive(Debug, Clone, Copy)]
pub struct NewRelation {
    /// The relative.
    pub related_patient_id: PatientId,
    /// What they are to the patient.
    pub relation: Relation,
    /// Whether they are the contact person for the patient.
    pub is_primary_contact: bool,
}

/// The patient's family.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<RelationView>, AppError> {
    actor.require(Permission::PatientsRead)?;
    let reach = actor.reach(Permission::PatientsRead).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(tx.conn(), patient_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        rows.into_iter().map(view).collect()
    })
    .await
}

/// Links two patients inside an open transaction, both directions. Returns the forward link's id.
pub(crate) async fn link_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    patient_id: PatientId,
    new: NewRelation,
) -> Result<PatientRelationId, AppError> {
    check_link(patient_id, new.related_patient_id)
        .map_err(|refusal| AppError::Conflict(refusal.message()))?;
    let reach = actor.reach(Permission::PatientsWrite);
    require_patient(tx, patient_id, reach).await?;
    require_patient(tx, new.related_patient_id, reach).await?;
    let id = dal::insert(
        tx.conn(),
        patient_id.uuid(),
        new.related_patient_id.uuid(),
        new.relation.as_str(),
        new.is_primary_contact,
    )
    .await?
    .ok_or(AppError::Conflict("these patients are already linked"))?;
    // The other side may already hold its own link; keep it as it is.
    dal::insert(
        tx.conn(),
        new.related_patient_id.uuid(),
        patient_id.uuid(),
        new.relation.inverse().as_str(),
        false,
    )
    .await?;
    Ok(PatientRelationId::from_uuid(id))
}

/// Links the patient to a relative (and the relative back).
///
/// # Errors
/// [`AppError::NotFound`] when either patient isn't in this clinic or is out of reach;
/// [`AppError::Conflict`] for a patient linked to themselves or a pair already linked.
pub async fn add(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    new: NewRelation,
) -> Result<RelationView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let reach = actor.reach(Permission::PatientsRead).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let id = link_in(tx, actor, patient_id, new).await?;
        let rows = dal::list(tx.conn(), patient_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        rows.into_iter()
            .find(|row| row.id == id.uuid())
            .ok_or(AppError::Internal("link not found after saving"))
            .and_then(view)
    })
    .await
}

/// Removes a link and its inverse.
///
/// # Errors
/// [`AppError::NotFound`] when the patient or the link isn't in this clinic (or the patient is
/// out of reach).
pub async fn remove(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    relation_id: PatientRelationId,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        require_patient(tx, patient_id, actor.reach(Permission::PatientsWrite)).await?;
        if dal::delete_pair(tx.conn(), patient_id.uuid(), relation_id.uuid()).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("family link"))
        }
    })
    .await
}
