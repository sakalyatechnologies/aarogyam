//! Notice and consent records (DPDP Act 2023): record that a patient was shown the clinic's
//! notice and agreed to a purpose, withdraw it, and list a patient's consents for Patient 360.

use aarogyam_dal::consents::{self as dal, ConsentRow, NewConsent};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::consent::{self, Method, Purpose, Status};
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::AppError;
use crate::notices;
use crate::scope::staff_scope as scope;
use crate::visits::require_patient;

/// How far ahead of the server clock a recorded time may be (clock drift on a front desk).
const FUTURE_SLACK: Duration = Duration::minutes(10);

/// A consent record as shown.
#[derive(Debug, Clone)]
pub struct ConsentView {
    /// Identifier.
    pub id: Uuid,
    /// What the patient agreed to.
    pub purpose: Purpose,
    /// The notice version they were shown.
    pub notice_version: String,
    /// The clinic's published notice they were shown, when recorded against one.
    pub notice_id: Option<Uuid>,
    /// When they agreed.
    pub given_at: OffsetDateTime,
    /// How.
    pub method: Method,
    /// Who recorded it.
    pub recorded_by: String,
    /// In force, or withdrawn.
    pub status: Status,
    /// When it was withdrawn.
    pub withdrawn_at: Option<OffsetDateTime>,
    /// Who recorded the withdrawal.
    pub withdrawn_by: Option<String>,
    /// How it was withdrawn.
    pub withdrawn_method: Option<Method>,
    /// A short remark.
    pub note: Option<String>,
    /// A short remark about the withdrawal.
    pub withdrawal_note: Option<String>,
}

fn view(row: ConsentRow) -> Result<ConsentView, AppError> {
    let unknown = |field| move |_| AppError::Internal(field);
    Ok(ConsentView {
        id: row.id,
        purpose: Purpose::parse(&row.purpose).map_err(unknown("purpose"))?,
        notice_version: row.notice_version,
        notice_id: row.notice_id,
        given_at: row.given_at,
        method: Method::parse(&row.method).map_err(unknown("method"))?,
        recorded_by: row.recorded_by_name.unwrap_or_default(),
        status: Status::parse(&row.status).map_err(unknown("status"))?,
        withdrawn_at: row.withdrawn_at,
        withdrawn_by: row.withdrawn_by_name,
        withdrawn_method: row
            .withdrawn_method
            .as_deref()
            .map(Method::parse)
            .transpose()
            .map_err(unknown("withdrawn_method"))?,
        note: row.note,
        withdrawal_note: row.withdrawal_note,
    })
}

/// The patient's consents, newest first. Needs `patients.read`.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<ConsentView>, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(
            tx.conn(),
            patient_id.uuid(),
            actor.reach(Permission::PatientsRead).member(),
        )
        .await?
        .ok_or(AppError::NotFound("patient"))?;
        rows.into_iter().map(view).collect()
    })
    .await
}

/// What the caller says about a consent being recorded.
#[derive(Debug, Clone)]
pub struct Give {
    /// What the patient agreed to.
    pub purpose: Purpose,
    /// The published notice they were shown; the clinic's current notice when neither this
    /// nor `notice_version` is given.
    pub notice_id: Option<Uuid>,
    /// A notice label, for consents taken against a notice that isn't published here.
    pub notice_version: Option<String>,
    /// When they agreed; now when absent.
    pub given_at: Option<OffsetDateTime>,
    /// How.
    pub method: Method,
    /// A short remark.
    pub note: Option<String>,
}

/// Records that the patient was shown the notice and agreed. Needs `patients.write`.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or is out of reach;
/// [`AppError::Invalid`] for a bad version, note or a time in the future;
/// [`AppError::Conflict`] when an active consent for the purpose exists (withdraw it first).
pub async fn give(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: &Give,
) -> Result<ConsentView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let note =
        consent::note(input.note.as_deref()).map_err(|error| AppError::invalid("note", error))?;
    if input
        .given_at
        .is_some_and(|at| at > OffsetDateTime::now_utc() + FUTURE_SLACK)
    {
        return Err(AppError::invalid("given_at", "must not be in the future"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        require_patient(tx, patient_id, actor.reach(Permission::PatientsWrite)).await?;
        let (version, notice_id) =
            notices::resolve(tx, input.notice_id, input.notice_version.as_deref()).await?;
        let id = dal::insert(
            tx.conn(),
            &NewConsent {
                patient_id: patient_id.uuid(),
                purpose: input.purpose.as_str(),
                notice_version: &version,
                notice_id,
                given_at: input.given_at,
                method: input.method.as_str(),
                recorded_by: actor.membership_id.uuid(),
                note,
            },
        )
        .await?
        .ok_or(AppError::Conflict(
            "this patient already has an active consent for that purpose; withdraw it first",
        ))?;
        let rows = dal::list(tx.conn(), patient_id.uuid(), None)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        rows.into_iter()
            .find(|row| row.id == id)
            .ok_or(AppError::Internal("consent missing after insert"))
            .and_then(view)
    })
    .await
}

/// Records that the patient withdrew a consent. Needs `patients.write`. The record stays as
/// history; withdrawing twice is a conflict.
///
/// # Errors
/// [`AppError::NotFound`] when the consent isn't in this clinic or its patient is out of reach;
/// [`AppError::Conflict`] when it was already withdrawn.
pub async fn withdraw(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    consent_id: Uuid,
    method: Method,
    note: Option<&str>,
) -> Result<ConsentView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let note = consent::note(note).map_err(|error| AppError::invalid("note", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let found = dal::lock(
            tx.conn(),
            consent_id,
            actor.reach(Permission::PatientsWrite).member(),
        )
        .await?
        .ok_or(AppError::NotFound("consent"))?;
        if found.status == Status::Withdrawn.as_str() {
            return Err(AppError::Conflict("that consent was already withdrawn"));
        }
        dal::withdraw(
            tx.conn(),
            consent_id,
            method.as_str(),
            actor.membership_id.uuid(),
            note,
        )
        .await?;
        let rows = dal::list(tx.conn(), found.patient_id, None)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        rows.into_iter()
            .find(|row| row.id == consent_id)
            .ok_or(AppError::Internal("consent missing after update"))
            .and_then(view)
    })
    .await
}
