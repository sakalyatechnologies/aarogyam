//! The waiting-room queue: tokens numbered per branch per clinic day, issued when a booked
//! patient arrives or to a walk-in, and moved along as they are seen.

use aarogyam_dal::queue::{self as dal, TokenRow, TokenState};
use aarogyam_dal::{appointments, clinic, patients, schedule, visits};
use aarogyam_domain::access::{ClinicActor, Reach};
use aarogyam_domain::ids::{BranchId, EncounterId, PatientId, PractitionerId, QueueTokenId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{QueueStatus, minutes_between};
use sakalya_db::{Db, ScopedTx};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::appointments::{StatusPlan, apply_status, plan_status};
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::moved::Moved;
use crate::patients::age_on;
use crate::schedule::resolve_branch;
use crate::scope::staff_scope as scope;
use crate::visits::{Names, VisitView, visit_view};

/// Why a token whose appointment is changed through the queue was cancelled.
const LEFT_REASON: &str = "Left without being seen";

/// A token as the queue screen shows it.
#[derive(Debug, Clone)]
pub struct TokenView {
    /// The stored token with names.
    pub row: TokenRow,
    /// Minutes waited: until now while waiting, otherwise until called (or until leaving).
    pub wait_minutes: i64,
    /// The patient's age today.
    pub patient_age_years: Option<u16>,
}

impl TokenView {
    pub(crate) fn new(row: TokenRow, now: OffsetDateTime, today: Date) -> Self {
        let until = match row.status.as_str() {
            "waiting" => now,
            _ => row.called_at.or(row.done_at).unwrap_or(now),
        };
        let wait_minutes = minutes_between(row.issued_at, until);
        let patient_age_years = age_on(
            row.patient_date_of_birth,
            row.patient_birth_date_estimated,
            today,
        );
        Self {
            row,
            wait_minutes,
            patient_age_years,
        }
    }
}

/// Issues the next token of the branch's clinic day, inside an open transaction.
pub(crate) async fn issue_token(
    tx: &mut ScopedTx,
    timezone: &str,
    branch_id: Uuid,
    patient_id: Uuid,
    appointment_id: Option<Uuid>,
    practitioner_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Uuid, AppError> {
    let day = clinic_today(timezone, now);
    let series = branch_id.simple().to_string();
    let value = dal::next_number(tx.conn(), &series, &day.to_string()).await?;
    let token_number =
        i32::try_from(value).map_err(|_| AppError::Conflict("the day's token numbers ran out"))?;
    let id = QueueTokenId::new_v7().uuid();
    dal::insert(
        tx.conn(),
        &dal::NewToken {
            id,
            branch_id,
            day,
            token_number,
            patient_id,
            appointment_id,
            practitioner_id,
            issued_at: now,
        },
    )
    .await?;
    Ok(id)
}

pub(crate) async fn view(
    tx: &mut ScopedTx,
    id: Uuid,
    now: OffsetDateTime,
    today: Date,
) -> Result<TokenView, AppError> {
    let row = dal::get(tx.conn(), id, None)
        .await?
        .ok_or(AppError::NotFound("queue token"))?;
    Ok(TokenView::new(row, now, today))
}

/// The queue of a clinic day (today when `None`).
#[derive(Debug, Clone)]
pub struct Queue {
    /// The clinic day.
    pub date: Date,
    /// Tokens by branch and number.
    pub tokens: Vec<TokenView>,
}

/// The tokens of a clinic day, optionally one branch.
///
/// # Errors
/// [`AppError::Db`] on failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    date: Option<Date>,
    branch_id: Option<BranchId>,
    now: OffsetDateTime,
) -> Result<Queue, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        let date = date.unwrap_or(today);
        let rows = dal::list(
            tx.conn(),
            date,
            branch_id.map(BranchId::uuid),
            actor.reach(Permission::AppointmentsRead).member(),
        )
        .await?;
        Ok(Queue {
            date,
            tokens: rows
                .into_iter()
                .map(|row| TokenView::new(row, now, today))
                .collect(),
        })
    })
    .await
}

/// A walk-in as received.
#[derive(Debug, Clone, Copy)]
pub struct WalkIn {
    /// The patient.
    pub patient_id: PatientId,
    /// The doctor, if known.
    pub practitioner_id: Option<PractitionerId>,
    /// Branch; the default branch when absent.
    pub branch_id: Option<BranchId>,
}

/// Issues a token to a patient without an appointment.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Invalid`] for an
/// unknown doctor or branch.
pub async fn walk_in(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: WalkIn,
    now: OffsetDateTime,
) -> Result<TokenView, AppError> {
    actor.require(Permission::AppointmentsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        if patients::get(tx.conn(), input.patient_id.uuid(), None)
            .await?
            .is_none()
        {
            return Err(AppError::NotFound("patient"));
        }
        check_doctor(tx, actor, input.practitioner_id).await?;
        let branch_id = resolve_branch(tx, input.branch_id).await?;
        let id = issue_token(
            tx,
            &profile.timezone,
            branch_id,
            input.patient_id.uuid(),
            None,
            input.practitioner_id.map(PractitionerId::uuid),
            now,
        )
        .await?;
        view(tx, id, now, clinic_today(&profile.timezone, now)).await
    })
    .await
}

/// Checks the doctor a walk-in is queued with: a member who queues only their own patients
/// queues them only with themselves.
pub(crate) async fn check_doctor(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    practitioner_id: Option<PractitionerId>,
) -> Result<(), AppError> {
    let reach = actor.reach(Permission::AppointmentsWrite);
    if practitioner_id.is_none() && reach != Reach::All {
        return Err(AppError::invalid(
            "practitioner_id",
            "choose yourself as the doctor",
        ));
    }
    if let Some(id) = practitioner_id
        && schedule::practitioner(tx.conn(), id.uuid())
            .await?
            .is_none_or(|row| !reach.includes(row.membership_id))
    {
        return Err(AppError::invalid("practitioner_id", "no such doctor"));
    }
    Ok(())
}

/// Moves a token along: `in_chair`, `done` or `left`. A token with an appointment moves the
/// appointment too (in the chair, completed, or cancelled as left without being seen). Asking
/// for the status the token already has changes nothing and returns it; a move the table
/// doesn't allow is refused with the token as it is.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown status; [`AppError::NotFound`] when the token isn't in
/// this clinic.
pub async fn set_status(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    token_id: QueueTokenId,
    status: &str,
    now: OffsetDateTime,
) -> Result<Moved<TokenView>, AppError> {
    actor.require(Permission::AppointmentsWrite)?;
    let to = QueueStatus::parse(status).map_err(|error| AppError::invalid("status", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        // A retry of a move that landed is answered from one read, without a lock.
        let reach = actor.reach(Permission::AppointmentsWrite).member();
        if let Some(row) = dal::get(tx.conn(), token_id.uuid(), reach).await?
            && row.status == to.as_str()
        {
            return Ok(Moved::AlreadyDone(TokenView::new(row, now, today)));
        }
        let token = dal::get_for_update(tx.conn(), token_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("queue token"))?;
        let from = QueueStatus::parse(&token.status)
            .map_err(|_| AppError::Internal("unknown token status"))?;
        if from == to {
            return Ok(Moved::AlreadyDone(view(tx, token.id, now, today).await?));
        }
        if let Err(error) = from.check(to) {
            return Ok(Moved::Refused {
                reason: error.to_string(),
                current: view(tx, token.id, now, today).await?,
            });
        }
        if let Some(reason) = move_token(tx, &actor.timezone, &token, to, now).await? {
            return Ok(Moved::Refused {
                reason,
                current: view(tx, token.id, now, today).await?,
            });
        }
        Ok(Moved::Done(view(tx, token.id, now, today).await?))
    })
    .await
}

/// Moves a locked token that may move to `to` (checked by the caller), and its appointment with
/// it. Returns the reason when the appointment's table refuses the move.
pub(crate) async fn move_token(
    tx: &mut ScopedTx,
    timezone: &str,
    token: &TokenState,
    to: QueueStatus,
    now: OffsetDateTime,
) -> Result<Option<String>, AppError> {
    match (token.appointment_id, to.appointment_status()) {
        (Some(appointment_id), Some(next)) => {
            appointments::lock(tx.conn(), appointment_id, None).await?;
            let current = appointments::get(tx.conn(), appointment_id, None)
                .await?
                .ok_or(AppError::NotFound("appointment"))?;
            let reason = (to == QueueStatus::Left).then_some(LEFT_REASON);
            match plan_status(&current.status, next, reason)? {
                StatusPlan::Move(reason) => {
                    apply_status(tx, timezone, &current, next, reason.as_ref(), now).await?;
                }
                // The appointment is already there: bring the token along.
                StatusPlan::Same => {
                    dal::set_status(tx.conn(), token.id, to.as_str(), now).await?;
                }
                StatusPlan::Refused(error) => return Ok(Some(error.to_string())),
            }
        }
        _ => dal::set_status(tx.conn(), token.id, to.as_str(), now).await?,
    }
    Ok(None)
}

/// A visit started from the queue, and the token as it is now.
#[derive(Debug, Clone)]
pub struct StartedVisit {
    /// The visit, new or the one that already existed.
    pub visit: VisitView,
    /// The token, in the chair.
    pub token: TokenView,
    /// Whether this request started the visit (false on a repeat).
    pub created: bool,
}

/// Starts the visit of a queue token in one step: seats the token (and its appointment) if it is
/// waiting, then starts a visit linked to the token and its appointment with the member as the
/// clinician. When the token or its appointment already has a visit, that visit is returned and
/// linked, so a second tap changes nothing.
///
/// # Errors
/// [`AppError::NotFound`] when the token isn't in this clinic or out of the member's reach (the
/// patient isn't theirs and the token doesn't name them); [`AppError::Conflict`] when the patient
/// left without a visit or the appointment can't move to the chair.
pub async fn start_visit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    token_id: QueueTokenId,
    now: OffsetDateTime,
) -> Result<StartedVisit, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let reach = actor.reach(Permission::ClinicalWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        let token = dal::lock_for_visit(tx.conn(), token_id.uuid(), reach)
            .await?
            .ok_or(AppError::NotFound("queue token"))?;
        let status = QueueStatus::parse(&token.state.status)
            .map_err(|_| AppError::Internal("unknown token status"))?;
        let existing =
            visits::for_token(tx.conn(), token.state.id, token.state.appointment_id).await?;
        if existing.is_none() && status == QueueStatus::Left {
            return Err(AppError::Conflict(
                "the patient left without being seen; issue a new token",
            ));
        }
        if status == QueueStatus::Waiting
            && move_token(tx, &actor.timezone, &token.state, QueueStatus::InChair, now)
                .await?
                .is_some()
        {
            return Err(AppError::Conflict(
                "the appointment can't move to the chair from its status",
            ));
        }
        let (row, created) = if let Some(row) = existing {
            if row.appointment_id.is_some() && row.appointment_id == token.state.appointment_id {
                visits::link_token(tx.conn(), row.id, token.state.id).await?;
            }
            (row, false)
        } else {
            let branch_id = visits::default_branch(tx.conn())
                .await?
                .ok_or(AppError::NotFound("branch"))?;
            let value = patients::next_number(tx.conn(), "visit").await?;
            let number = format!("V-{value}");
            let row = visits::insert_encounter(
                tx.conn(),
                &visits::NewEncounter {
                    id: EncounterId::new_v7().uuid(),
                    number: &number,
                    patient_id: token.patient_id,
                    clinician_id: actor.membership_id.uuid(),
                    branch_id,
                    appointment_id: token.state.appointment_id,
                    chief_complaint: None,
                    started_at: now,
                    queue_token_id: Some(token.state.id),
                },
            )
            .await?;
            (row, true)
        };
        let names = Names::load(tx, [row.clinician_id]).await?;
        Ok(StartedVisit {
            visit: visit_view(row, &names)?,
            token: view(tx, token.state.id, now, today).await?,
            created,
        })
    })
    .await
}
