//! Follow-ups: planned for a patient, listed when due, marked done.

use aarogyam_dal::{patients, recalls as dal};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{PatientId, RecallId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::PatientRef;
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// A follow-up as the API shows it.
#[derive(Debug, Clone)]
pub struct RecallView {
    /// Identifier.
    pub id: RecallId,
    /// The patient.
    pub patient: PatientRef,
    /// `follow_up`, `cleaning`, …
    pub kind: String,
    /// Why.
    pub reason: String,
    /// When it falls due.
    pub due_on: Date,
    /// `due`, `notified`, `booked`, `done` or `dismissed`.
    pub status: String,
    /// When it was done.
    pub done_at: Option<OffsetDateTime>,
}

fn view(row: dal::RecallRow) -> RecallView {
    RecallView {
        id: RecallId::from_uuid(row.id),
        patient: PatientRef {
            id: PatientId::from_uuid(row.patient_id),
            name: row.patient_name,
            number: row.patient_number,
        },
        kind: row.kind,
        reason: row.reason,
        due_on: row.due_on,
        status: row.status,
        done_at: row.done_at,
    }
}

async fn load(tx: &mut ScopedTx, id: Uuid, member: Option<Uuid>) -> Result<RecallView, AppError> {
    dal::list(tx.conn(), Some(id), None, 1, member)
        .await?
        .into_iter()
        .next()
        .map(view)
        .ok_or(AppError::NotFound("recall"))
}

/// Plans a follow-up for a patient.
///
/// # Errors
/// [`AppError::Denied`] without `patients.write`; [`AppError::NotFound`] for an unknown
/// patient; [`AppError::Invalid`] for a bad kind or reason.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    due_on: Date,
    reason: &str,
    kind: Option<&str>,
) -> Result<RecallView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let reason = reason.trim();
    if !(1..=300).contains(&reason.chars().count()) {
        return Err(AppError::invalid("reason", "must be 1 to 300 characters"));
    }
    let kind = kind.map_or("follow_up", str::trim);
    let kind_ok = (1..=32).contains(&kind.len())
        && kind.starts_with(|c: char| c.is_ascii_lowercase())
        && kind.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
    if !kind_ok {
        return Err(AppError::invalid("kind", "use lower-case letters and _"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::PatientsRead).member();
        patients::get(tx.conn(), patient_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let id = RecallId::new_v7().uuid();
        dal::insert(tx.conn(), id, patient_id.uuid(), kind, reason, due_on).await?;
        load(tx, id, reach).await
    })
    .await
}

/// Open follow-ups falling due before `due_before` (all open ones without it), soonest first.
///
/// # Errors
/// [`AppError::Denied`] without `patients.read`.
pub async fn due(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    due_before: Option<Date>,
) -> Result<Vec<RecallView>, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(
            tx.conn(),
            None,
            due_before,
            500,
            actor.reach(Permission::PatientsRead).member(),
        )
        .await?;
        Ok(rows.into_iter().map(view).collect())
    })
    .await
}

/// Marks a follow-up done.
///
/// # Errors
/// [`AppError::Denied`] without `patients.write`; [`AppError::NotFound`];
/// [`AppError::Conflict`] when already done or dismissed.
pub async fn done(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: RecallId,
    now: OffsetDateTime,
) -> Result<RecallView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::PatientsRead).member();
        load(tx, id.uuid(), reach).await?;
        if !dal::done(tx.conn(), id.uuid(), now).await? {
            return Err(AppError::Conflict("this follow-up is already closed"));
        }
        load(tx, id.uuid(), reach).await
    })
    .await
}
