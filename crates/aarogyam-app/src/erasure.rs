//! Erasing patient records past retention (`docs/decisions.md`, "Erasure job"), and the legal
//! hold that stops it. The job runs over the schema owner's connection: a dry run lists what
//! would go, `apply` erases one clinic's patients one transaction each, and `replay` erases again
//! the patients an erasure log names, after a restore from backup.

use aarogyam_dal::erasure::{self as dal, ClinicCandidates};
use aarogyam_dal::legal_hold::{self as hold_dal, HoldRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{ClinicId, PatientId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::retention::{self, Class, PatientRetentionYears, Period};
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// One patient erased, as the erasure log records it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Erased {
    /// The clinic.
    pub org_id: Uuid,
    /// The patient (now a tombstone).
    pub patient_id: Uuid,
    /// The run that erased them.
    pub run_id: Uuid,
}

fn default_years() -> i32 {
    match Class::PatientRecord.period() {
        Period::Years(years) => i32::from(years),
        Period::Days(_) => 0,
    }
}

/// Per clinic (or one clinic), the patients past retention and how many legal holds keep.
/// Reads only.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn plan(
    db: &Db,
    now: OffsetDateTime,
    clinic: Option<ClinicId>,
) -> Result<Vec<ClinicCandidates>, DbError> {
    let adults = retention::adult_born_on_or_before(now);
    dal::candidates(
        db.pool(),
        now,
        default_years(),
        adults,
        clinic.map(ClinicId::uuid),
    )
    .await
}

/// The clinic with this subdomain.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic(db: &Db, slug: &str) -> Result<Option<ClinicId>, DbError> {
    Ok(dal::clinic_by_slug(db.pool(), slug)
        .await?
        .map(ClinicId::from_uuid))
}

/// Erases one clinic's patients past retention, each in its own transaction, calling `logged`
/// after each so the caller can write the erasure log outside the database as it goes. A patient
/// put on hold since the plan was read is skipped. Returns how many were erased.
///
/// # Errors
/// [`DbError`] on a database failure; patients erased before it stay erased and logged.
pub async fn apply(
    db: &Db,
    now: OffsetDateTime,
    clinic: ClinicId,
    run_id: Uuid,
    mut logged: impl FnMut(Erased) -> std::io::Result<()>,
) -> Result<usize, AppError> {
    let mut erased = 0;
    for group in plan(db, now, Some(clinic)).await? {
        for patient_id in group.patients {
            if dal::erase(db.pool(), group.org_id, patient_id, run_id, false).await? {
                erased += 1;
                logged(Erased {
                    org_id: group.org_id,
                    patient_id,
                    run_id,
                })
                .map_err(|_| AppError::Internal("the erasure log could not be written"))?;
            }
        }
    }
    Ok(erased)
}

/// Erases again every patient in `log` (after a restore brought them back), whatever their
/// state now. Returns how many rows changed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn replay(db: &Db, log: &[Erased]) -> Result<usize, DbError> {
    let mut changed = 0;
    for entry in log {
        if dal::erase(
            db.pool(),
            entry.org_id,
            entry.patient_id,
            entry.run_id,
            true,
        )
        .await?
        {
            changed += 1;
        }
    }
    Ok(changed)
}

/// Sets how long a clinic keeps patient records (`None`: the default). `false` for an unknown
/// clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_patient_years(
    db: &Db,
    clinic: ClinicId,
    years: Option<PatientRetentionYears>,
) -> Result<bool, DbError> {
    let years = years.map(|years| i16::from(years.get()));
    dal::set_patient_years(db.pool(), clinic.uuid(), years).await
}

/// Puts a patient on legal hold for `reason`, which stops their erasure, or releases them with
/// `None`. Needs `settings.manage`.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Invalid`] for a bad
/// reason.
pub async fn set_legal_hold(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient: PatientId,
    reason: Option<&str>,
) -> Result<HoldRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    let reason = reason
        .map(retention::legal_hold_reason)
        .transpose()
        .map_err(|error| AppError::invalid("reason", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        hold_dal::set(tx.conn(), patient.uuid(), reason.as_deref())
            .await?
            .ok_or(AppError::NotFound("patient"))
    })
    .await
}
