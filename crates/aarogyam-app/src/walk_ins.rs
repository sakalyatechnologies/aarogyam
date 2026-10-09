//! A walk-in in one step: register the patient (or take an existing one), record what they
//! report about allergies and the consents they give at the desk, and issue a queue token, all
//! in one clinic transaction. Allergies recorded here are patient-reported until a clinician
//! confirms them (docs/decisions.md, "Walk-in fast path").

use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::ids::{BranchId, PatientId, PractitionerId};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::intake::{self, Intake};
use crate::patients::{PatientView, RegisterPatient, existing, insert_new, validate};
use crate::queue::{TokenView, check_doctor, issue_token, view as token_view};
use crate::schedule::resolve_branch;
use crate::scope::staff_scope as scope;

/// Who the walk-in is.
#[derive(Debug, Clone)]
pub enum WalkInPatient {
    /// Someone new, registered now.
    New(RegisterPatient),
    /// A patient already registered (found by the phone lookup).
    Existing(PatientId),
}

/// A walk-in as received.
#[derive(Debug, Clone)]
pub struct NewWalkIn {
    /// Who.
    pub patient: WalkInPatient,
    /// The doctor, if known.
    pub practitioner_id: Option<PractitionerId>,
    /// Branch; the default branch when absent.
    pub branch_id: Option<BranchId>,
    /// Allergies or "No known allergies", and desk consents.
    pub intake: Intake,
}

/// What a walk-in did.
#[derive(Debug, Clone)]
pub struct WalkInView {
    /// The patient.
    pub patient: PatientView,
    /// Whether the patient was registered by this request.
    pub registered: bool,
    /// The queue token.
    pub token: TokenView,
    /// How many allergies were recorded (already active ones are not repeated).
    pub allergies_recorded: u64,
    /// The purposes whose consent was recorded (ones already in force are left as they are).
    pub consents_recorded: Vec<Purpose>,
}

/// Registers (or takes) the patient, records allergies or "No known allergies" and the desk
/// consents, and issues a queue token, in one transaction: either all of it happens or none.
/// Needs `intake.write`, `patients.write` and `appointments.write`.
///
/// # Errors
/// [`AppError::Denied`] without the permissions; [`AppError::Invalid`] for bad input or an
/// unknown doctor; [`AppError::NotFound`] when an existing patient isn't in this clinic;
/// [`AppError::Conflict`] for "No known allergies" when an allergy is on record.
pub async fn register(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewWalkIn,
    now: OffsetDateTime,
) -> Result<WalkInView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    actor.require(Permission::AppointmentsWrite)?;
    actor.require(Permission::IntakeWrite)?;
    let intake = intake::check(&input.intake)?;
    let today = clinic_today(&actor.timezone, now);
    let new_patient = match &input.patient {
        WalkInPatient::New(details) => Some(validate(details, today)?),
        WalkInPatient::Existing(_) => None,
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        check_doctor(tx, actor, input.practitioner_id).await?;
        let (patient, registered) = match (&input.patient, &new_patient) {
            (_, Some(details)) => (
                insert_new(tx, &actor.number_prefix, details, actor, today).await?,
                true,
            ),
            (WalkInPatient::Existing(id), None) => (existing(tx, actor, *id, today).await?, false),
            (WalkInPatient::New(_), None) => {
                return Err(AppError::Internal("new patient not validated"));
            }
        };
        let patient_id = patient.id.uuid();
        let (allergies_recorded, consents_recorded) =
            intake::record(tx, patient_id, &intake, actor.membership_id.uuid()).await?;
        let branch_id = resolve_branch(tx, input.branch_id).await?;
        let token_id = issue_token(
            tx,
            &actor.timezone,
            branch_id,
            patient_id,
            None,
            input.practitioner_id.map(PractitionerId::uuid),
            now,
        )
        .await?;
        let token = token_view(tx, token_id, now, today).await?;
        Ok(WalkInView {
            patient,
            registered,
            token,
            allergies_recorded,
            consents_recorded,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use aarogyam_domain::consent::{DEFAULT_NOTICE_VERSION, Method};
    use intake::{DeskConsent, MAX_ALLERGIES};

    fn walk_in(intake: Intake) -> NewWalkIn {
        NewWalkIn {
            patient: WalkInPatient::Existing(PatientId::new_v7()),
            practitioner_id: None,
            branch_id: None,
            intake,
        }
    }

    #[test]
    fn allergies_and_none_known_exclude_each_other() {
        let input = walk_in(Intake {
            allergies: vec!["Penicillin".into()],
            no_known_allergies: true,
            ..Intake::default()
        });
        assert!(matches!(
            intake::check(&input.intake),
            Err(AppError::Invalid {
                field: "no_known_allergies",
                ..
            })
        ));
    }

    #[test]
    fn the_default_notice_is_used_and_purposes_are_named_once() {
        let checked = intake::check(&Intake::default()).map(|c| c.notice_version);
        assert_eq!(checked.ok().as_deref(), Some(DEFAULT_NOTICE_VERSION));
        let care = DeskConsent {
            purpose: Purpose::Care,
            method: Method::Verbal,
        };
        let twice = Intake {
            consents: vec![care, care],
            ..Intake::default()
        };
        assert!(matches!(
            intake::check(&twice),
            Err(AppError::Invalid {
                field: "consents",
                ..
            })
        ));
    }

    #[test]
    fn blank_or_too_many_allergies_are_refused() {
        let blank = Intake {
            allergies: vec!["  ".into()],
            ..Intake::default()
        };
        assert!(intake::check(&blank).is_err());
        let many = Intake {
            allergies: vec!["Dust".into(); MAX_ALLERGIES + 1],
            ..Intake::default()
        };
        assert!(intake::check(&many).is_err());
    }
}
