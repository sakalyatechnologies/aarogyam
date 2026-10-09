//! Checking in a booked patient in one step: complete their registration (sex, age or date of
//! birth), record what they report about allergies and the consents they give, and mark them
//! arrived (which issues the queue token), all in one transaction. Online sign-ups arrive with
//! only a name, email and phone; this is where the desk completes them.

use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::ids::{AppointmentId, PatientId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::AppointmentStatus;
use sakalya_db::Db;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::appointments::{
    StatusChanged, StatusPlan, apply_status, locked, plan_status, status_changed,
};
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::intake::{self, Intake};
use crate::patients::{EditPatient, edit_in};
use crate::scope::staff_scope as scope;

/// A check-in as received. Details left out stay as they are.
#[derive(Debug, Clone, Default)]
pub struct CheckIn {
    /// `female`, `male`, `other` or `unknown`.
    pub sex: Option<String>,
    /// Date of birth, when known.
    pub date_of_birth: Option<Date>,
    /// Age in years, when the date of birth is unknown.
    pub age_years: Option<u16>,
    /// Allergies or "No known allergies", and desk consents.
    pub intake: Intake,
}

/// What a check-in did.
#[derive(Debug, Clone)]
pub struct CheckedIn {
    /// The appointment, arrived, with its queue token.
    pub arrived: StatusChanged,
    /// How many allergies were recorded.
    pub allergies_recorded: u64,
    /// The purposes whose consent was recorded.
    pub consents_recorded: Vec<Purpose>,
}

/// Checks in a booked patient. Needs `intake.write`, `patients.write` and
/// `appointments.write`. Checking in a patient who has already arrived records the details
/// without a second token.
///
/// # Errors
/// [`AppError::Denied`] without the permissions; [`AppError::NotFound`] when the appointment
/// or its patient isn't in reach; [`AppError::Invalid`] for bad details; [`AppError::Conflict`]
/// when the appointment can't arrive from its status, or for "No known allergies" with an
/// allergy on record.
pub async fn check_in(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    appointment_id: AppointmentId,
    input: CheckIn,
    now: OffsetDateTime,
) -> Result<CheckedIn, AppError> {
    actor.require(Permission::PatientsWrite)?;
    actor.require(Permission::AppointmentsWrite)?;
    actor.require(Permission::IntakeWrite)?;
    let checked = intake::check(&input.intake)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        let current = locked(tx, actor, appointment_id).await?;
        let plan = match plan_status(&current.status, AppointmentStatus::Arrived, None)? {
            StatusPlan::Refused(_) => {
                return Err(AppError::Conflict(
                    "this appointment can't be checked in from its current status",
                ));
            }
            plan => plan,
        };
        if input.sex.is_some() || input.date_of_birth.is_some() || input.age_years.is_some() {
            let edit = EditPatient {
                sex: input.sex.clone(),
                date_of_birth: input.date_of_birth.map(Some),
                age_years: input.age_years,
                ..EditPatient::default()
            };
            edit_in(
                tx,
                actor,
                PatientId::from_uuid(current.patient_id),
                &edit,
                None,
                today,
            )
            .await?;
        }
        let (allergies_recorded, consents_recorded) =
            intake::record(tx, current.patient_id, &checked, actor.membership_id.uuid()).await?;
        if let StatusPlan::Move(reason) = plan {
            apply_status(
                tx,
                &actor.timezone,
                &current,
                AppointmentStatus::Arrived,
                reason.as_ref(),
                Some(actor.membership_id),
                now,
            )
            .await?;
        }
        Ok(CheckedIn {
            arrived: status_changed(tx, current.id, today).await?,
            allergies_recorded,
            consents_recorded,
        })
    })
    .await
}
