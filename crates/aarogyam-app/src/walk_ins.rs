//! A walk-in in one step: register the patient (or take an existing one), record what they
//! report about allergies and the consents they give at the desk, and issue a queue token, all
//! in one clinic transaction. Allergies recorded here are patient-reported until a clinician
//! confirms them (docs/decisions.md, "Walk-in fast path").

use aarogyam_dal::{consents, facts};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::clinical_text;
use aarogyam_domain::consent::{self, DEFAULT_NOTICE_VERSION, Method, Purpose};
use aarogyam_domain::ids::{BranchId, PatientId, PractitionerId};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::patients::{PatientView, RegisterPatient, existing, insert_new, validate};
use crate::queue::{TokenView, check_doctor, issue_token, view as token_view};
use crate::schedule::resolve_branch;
use crate::scope::staff_scope as scope;
use crate::visits::invalid;

/// Most allergies one walk-in may report.
pub const MAX_ALLERGIES: usize = 20;

/// Who the walk-in is.
#[derive(Debug, Clone)]
pub enum WalkInPatient {
    /// Someone new, registered now.
    New(RegisterPatient),
    /// A patient already registered (found by the phone lookup).
    Existing(PatientId),
}

/// A consent given at the desk.
#[derive(Debug, Clone, Copy)]
pub struct DeskConsent {
    /// What the patient agreed to.
    pub purpose: Purpose,
    /// How: usually verbal at the desk.
    pub method: Method,
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
    /// Substances the patient says they are allergic to.
    pub allergies: Vec<String>,
    /// The patient knows of no allergies. Not with `allergies`.
    pub no_known_allergies: bool,
    /// Consents given at the desk.
    pub consents: Vec<DeskConsent>,
    /// The notice version shown; the default notice when absent.
    pub notice_version: Option<String>,
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

/// Checks what doesn't need the database: the allergy list, the consents and the notice version.
fn check(input: &NewWalkIn) -> Result<(Vec<String>, String), AppError> {
    if input.no_known_allergies && !input.allergies.is_empty() {
        return Err(AppError::invalid(
            "no_known_allergies",
            "can't be given together with allergies",
        ));
    }
    if input.allergies.len() > MAX_ALLERGIES {
        return Err(AppError::invalid(
            "allergies",
            format!("at most {MAX_ALLERGIES}"),
        ));
    }
    let allergies = input
        .allergies
        .iter()
        .map(|text| clinical_text(text, 1, 200).map_err(invalid("allergies")))
        .collect::<Result<Vec<_>, _>>()?;
    let mut purposes: Vec<Purpose> = input.consents.iter().map(|c| c.purpose).collect();
    purposes.sort_by_key(|p| p.as_str());
    purposes.dedup();
    if purposes.len() != input.consents.len() {
        return Err(AppError::invalid("consents", "name each purpose once"));
    }
    let version = consent::version(
        input
            .notice_version
            .as_deref()
            .unwrap_or(DEFAULT_NOTICE_VERSION),
    )
    .map_err(|error| AppError::invalid("notice_version", error))?
    .to_owned();
    Ok((allergies, version))
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
    let (allergies, version) = check(&input)?;
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
        let allergies_recorded = if allergies.is_empty() {
            0
        } else {
            facts::insert_reported(tx.conn(), patient_id, &allergies).await?
        };
        if input.no_known_allergies && !facts::mark_none_known(tx.conn(), patient_id).await? {
            return Err(AppError::Conflict(
                "this patient has an allergy on record; a doctor must review it first",
            ));
        }
        let consents_recorded = if input.consents.is_empty() {
            Vec::new()
        } else {
            let purposes: Vec<String> = input
                .consents
                .iter()
                .map(|c| c.purpose.as_str().to_owned())
                .collect();
            let methods: Vec<String> = input
                .consents
                .iter()
                .map(|c| c.method.as_str().to_owned())
                .collect();
            consents::insert_many(
                tx.conn(),
                patient_id,
                &purposes,
                &methods,
                &version,
                actor.membership_id.uuid(),
            )
            .await?
            .iter()
            .map(|key| Purpose::parse(key).map_err(|_| AppError::Internal("unknown purpose")))
            .collect::<Result<Vec<_>, _>>()?
        };
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

    fn walk_in() -> NewWalkIn {
        NewWalkIn {
            patient: WalkInPatient::Existing(PatientId::new_v7()),
            practitioner_id: None,
            branch_id: None,
            allergies: Vec::new(),
            no_known_allergies: false,
            consents: Vec::new(),
            notice_version: None,
        }
    }

    #[test]
    fn allergies_and_none_known_exclude_each_other() {
        let input = NewWalkIn {
            allergies: vec!["Penicillin".into()],
            no_known_allergies: true,
            ..walk_in()
        };
        assert!(matches!(
            check(&input),
            Err(AppError::Invalid {
                field: "no_known_allergies",
                ..
            })
        ));
    }

    #[test]
    fn the_default_notice_is_used_and_purposes_are_named_once() {
        let (_, version) = check(&walk_in()).unwrap_or_default();
        assert_eq!(version, DEFAULT_NOTICE_VERSION);
        let care = DeskConsent {
            purpose: Purpose::Care,
            method: Method::Verbal,
        };
        let twice = NewWalkIn {
            consents: vec![care, care],
            ..walk_in()
        };
        assert!(matches!(
            check(&twice),
            Err(AppError::Invalid {
                field: "consents",
                ..
            })
        ));
    }

    #[test]
    fn blank_or_too_many_allergies_are_refused() {
        let blank = NewWalkIn {
            allergies: vec!["  ".into()],
            ..walk_in()
        };
        assert!(check(&blank).is_err());
        let many = NewWalkIn {
            allergies: vec!["Dust".into(); MAX_ALLERGIES + 1],
            ..walk_in()
        };
        assert!(check(&many).is_err());
    }
}
