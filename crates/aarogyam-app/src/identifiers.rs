//! Other numbers a patient is known by (file number, legacy ID, smart card, ABHA), shown on
//! the patient's record. Each number belongs to one patient per clinic and kind.

use aarogyam_dal::identifiers::{self as dal, IdentifierRow};
use aarogyam_dal::patients;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{PatientId, PatientIdentifierId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{IdentifierKind, parse_identifier};
use sakalya_db::{Db, ScopedTx};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// The message for a number another patient already has.
pub const TAKEN: &str = "another patient already has this number";

/// The patient exists and the member can read them (`patients.read` reach).
async fn require_patient(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    patient_id: PatientId,
) -> Result<(), AppError> {
    let reach = actor.reach(Permission::PatientsRead).member();
    if patients::get(tx.conn(), patient_id.uuid(), reach)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound("patient"));
    }
    Ok(())
}

/// A patient's identifiers.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<IdentifierRow>, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        require_patient(tx, actor, patient_id).await?;
        Ok(dal::list(tx.conn(), patient_id.uuid()).await?)
    })
    .await
}

/// Adds an identifier to a patient.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown kind or bad value; [`AppError::NotFound`] when the
/// patient isn't in this clinic; [`AppError::Conflict`] when another patient has the number.
pub async fn add(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    kind: &str,
    value: &str,
) -> Result<IdentifierRow, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let kind = IdentifierKind::parse(kind).map_err(|error| AppError::invalid("kind", error))?;
    let value = parse_identifier(value).map_err(|error| AppError::invalid("value", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        require_patient(tx, actor, patient_id).await?;
        dal::insert(
            tx.conn(),
            PatientIdentifierId::new_v7().uuid(),
            patient_id.uuid(),
            kind.as_str(),
            &value,
        )
        .await
        .map_err(|error| AppError::on_constraint(error, "patient_identifiers_value", TAKEN))
    })
    .await
}

/// Removes an identifier from a patient.
///
/// # Errors
/// [`AppError::NotFound`] when the patient or identifier isn't in this clinic.
pub async fn remove(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    identifier_id: PatientIdentifierId,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::delete(tx.conn(), patient_id.uuid(), identifier_id.uuid()).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("identifier"))
        }
    })
    .await
}
