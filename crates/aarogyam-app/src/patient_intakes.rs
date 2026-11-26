//! The case-paper fields clinics collect at registration (blood group, second phone,
//! emergency contact, referral, family doctor, pregnancy...), and the health checklist that
//! goes with them. One shared path serves the desk's registration form and the QR arrival's
//! accept, so both record exactly the same things.

use aarogyam_dal::{patient_intakes as dal, patients};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::patient_intake::{IntakeError, PatientIntake, RawIntake};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::self_check_in::catalogue;
use sakalya_db::{Db, ScopedTx};
use uuid::Uuid;

use crate::error::AppError;
use crate::intake::{self, Intake, MAX_ALLERGIES};
use crate::scope::staff_scope;

/// The health code that means "none of these".
const NONE: &str = "none";

impl From<IntakeError> for AppError {
    fn from(error: IntakeError) -> Self {
        Self::invalid(error.field, error.message)
    }
}

/// Checks the case-paper fields.
///
/// # Errors
/// [`AppError::Invalid`] naming the bad field.
pub fn parse(raw: &RawIntake) -> Result<PatientIntake, AppError> {
    Ok(PatientIntake::parse(raw)?)
}

/// Checks health codes against the clinic's list: each known, none repeated, and `none` alone.
///
/// # Errors
/// [`AppError::Invalid`] naming `health`.
pub fn check_health(codes: &[String]) -> Result<Vec<String>, AppError> {
    let lists = catalogue();
    let mut health: Vec<String> = Vec::new();
    for code in codes {
        if lists.health_flag(code).is_none() {
            return Err(AppError::invalid("health", "unknown value"));
        }
        if !health.contains(code) {
            health.push(code.clone());
        }
    }
    if health.len() > 1 && health.iter().any(|code| code == NONE) {
        return Err(AppError::invalid(
            "health",
            "\"none\" can't be combined with other conditions",
        ));
    }
    Ok(health)
}

/// Allergies typed as one line ("penicillin, sulfa") as a list.
pub(crate) fn allergy_list(text: Option<&str>) -> Vec<String> {
    text.map(|text| {
        text.split([',', ';', '\n'])
            .map(|part| part.trim().chars().take(200).collect::<String>())
            .filter(|part| !part.is_empty())
            .take(MAX_ALLERGIES)
            .collect()
    })
    .unwrap_or_default()
}

/// The conditions (in words) the health codes stand for; `none` and unknown codes stand for
/// nothing.
pub(crate) fn conditions(health: &[String]) -> Vec<String> {
    let lists = catalogue();
    health
        .iter()
        .filter_map(|code| lists.health_flag(code).and_then(|c| c.condition.clone()))
        .collect()
}

/// What a registration form carries beyond the patient's own details.
#[derive(Debug, Clone, Default)]
pub struct CasePaper {
    /// The case-paper fields.
    pub intake: Option<PatientIntake>,
    /// Health checklist codes.
    pub health: Vec<String>,
    /// Allergies in the patient's words.
    pub allergies_text: Option<String>,
}

impl CasePaper {
    /// Whether nothing needs recording.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.intake.as_ref().is_none_or(PatientIntake::is_empty)
            && self.health.is_empty()
            && self.allergies_text.as_deref().is_none_or(str::is_empty)
    }

    /// Checks the health codes and returns them with the intake the ticks imply: pregnant and
    /// nursing ticks also set those fields.
    ///
    /// # Errors
    /// [`AppError::Invalid`] naming `health`.
    pub fn checked(&self) -> Result<(Vec<String>, PatientIntake), AppError> {
        let health = check_health(&self.health)?;
        let mut intake = self.intake.clone().unwrap_or_default();
        if health.iter().any(|code| code == "pregnant") {
            intake.pregnant = Some(true);
        }
        if health.iter().any(|code| code == "nursing") {
            intake.nursing = Some(true);
        }
        Ok((health, intake))
    }
}

/// Records a case paper for a patient inside an open transaction: allergies and conditions the
/// same way the desk's intake does, and the case-paper fields. With `keep_existing`, fields the
/// patient already has are left as they are and only blanks are filled.
///
/// # Errors
/// [`AppError::Denied`] without `intake.write` when health or allergies are given;
/// [`AppError::Invalid`] for a bad health code.
pub(crate) async fn record_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    patient_id: Uuid,
    case: &CasePaper,
    keep_existing: bool,
) -> Result<(), AppError> {
    let (health, mut fields) = case.checked()?;
    let allergies = allergy_list(case.allergies_text.as_deref());
    let conditions = conditions(&health);
    if !allergies.is_empty() || !conditions.is_empty() {
        actor.require(Permission::IntakeWrite)?;
        let checked = intake::check(&Intake {
            allergies,
            conditions,
            ..Intake::default()
        })?;
        intake::record(tx, patient_id, &checked, actor.membership_id.uuid()).await?;
    }
    if fields.is_empty() {
        return Ok(());
    }
    if keep_existing && let Some(raw) = dal::get(tx.conn(), patient_id).await? {
        let mut merged = parse(&raw)?;
        merged.fill_from(&fields);
        fields = merged;
    }
    dal::upsert(tx.conn(), patient_id, &fields).await?;
    Ok(())
}

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

/// The patient's case-paper fields; empty when never saved.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or the caller's reach.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient: PatientId,
) -> Result<RawIntake, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        require_patient(tx, actor, Permission::PatientsRead, patient).await?;
        Ok(dal::get(tx.conn(), patient.uuid())
            .await?
            .unwrap_or_default())
    })
    .await
}

/// Replaces the patient's case-paper fields and returns them as saved.
///
/// # Errors
/// [`AppError::Invalid`] naming the bad field; [`AppError::NotFound`] when the patient isn't
/// in this clinic or the caller's reach.
pub async fn put(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient: PatientId,
    raw: &RawIntake,
) -> Result<RawIntake, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let fields = parse(raw)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        require_patient(tx, actor, Permission::PatientsWrite, patient).await?;
        dal::upsert(tx.conn(), patient.uuid(), &fields).await?;
        Ok(fields.to_raw())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_stands_alone() {
        assert!(check_health(&["none".into()]).is_ok());
        assert!(check_health(&["none".into(), "asthma".into()]).is_err());
        assert!(check_health(&["asthma".into(), "asthma".into()]).is_ok_and(|h| h.len() == 1));
        assert!(check_health(&["nonsense".into()]).is_err());
    }

    #[test]
    fn ticks_set_pregnancy_and_nursing() {
        let case = CasePaper {
            health: vec!["pregnant".into(), "nursing".into()],
            ..CasePaper::default()
        };
        let (_, fields) = case.checked().unwrap_or_default();
        assert_eq!(fields.pregnant, Some(true));
        assert_eq!(fields.nursing, Some(true));
    }
}
