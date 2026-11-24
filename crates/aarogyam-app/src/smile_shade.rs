//! The tooth colour a doctor settled on in Show patient, kept per patient for the next visit.
//! A display preference, not a clinical record, so a save replaces the earlier value.

use aarogyam_dal::{patient_smile_shades as dal, patients};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;

async fn require_patient(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    permission: Permission,
    patient: PatientId,
) -> Result<(), AppError> {
    patients::get(tx.conn(), patient.uuid(), actor.reach(permission).member())
        .await?
        .ok_or(AppError::NotFound("patient"))?;
    Ok(())
}

/// The patient's saved colour, or none when never saved.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or the caller's clinical reach.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient: PatientId,
) -> Result<Option<i16>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        require_patient(tx, actor, Permission::ClinicalRead, patient).await?;
        Ok(dal::get(tx.conn(), patient.uuid()).await?)
    })
    .await
}

/// Saves the patient's colour, 0 (lightest) to 100 (deepest).
///
/// # Errors
/// [`AppError::Invalid`] outside 0 to 100; [`AppError::NotFound`] when the patient isn't in
/// this clinic or the caller's clinical reach.
pub async fn save(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient: PatientId,
    shade: i64,
) -> Result<i16, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let shade = i16::try_from(shade)
        .ok()
        .filter(|s| (0..=100).contains(s))
        .ok_or_else(|| AppError::invalid("shade", "between 0 and 100"))?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        require_patient(tx, actor, Permission::ClinicalWrite, patient).await?;
        dal::upsert(tx.conn(), patient.uuid(), shade).await?;
        Ok(shade)
    })
    .await
}
