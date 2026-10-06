//! Booking, moving and progressing appointments. A chair holds one active booking at a time
//! (the database refuses overlaps with a conflict); a doctor in two chairs at once, on leave or
//! outside their hours is allowed with a warning. Every change appends to the appointment's
//! history, and arriving issues a queue token.

use aarogyam_dal::appointments::{self as dal, AppointmentRow, Booking};
use aarogyam_dal::{clinic, patients, queue, schedule};
use aarogyam_domain::access::{ClinicActor, Reach};
use aarogyam_domain::ids::{AppointmentId, BranchId, PatientId, PractitionerId, RoomId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{
    AppointmentKind, AppointmentStatus, BookingSource, DateSpan, QueueStatus, Reason,
    ScheduleError, Shift, TimeSlot, check_transition, within_hours,
};
use sakalya_db::{Db, ScopedTx};
use serde_json::{Map, Value, json};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_offset, clinic_today, days_bounds};
use crate::error::AppError;
use crate::moved::Moved;
use crate::patients::age_on;
use crate::queue::issue_token;
use crate::schedule::resolve_branch;
use crate::scope::staff_scope as scope;

/// The message for a booking that overlaps another in the same chair.
pub const ROOM_TAKEN: &str =
    "that chair is already booked for part of this time; choose another time or chair";

fn room_taken(error: sakalya_db::DbError) -> AppError {
    AppError::on_constraint(error, "appointments_room_overlap", ROOM_TAKEN)
}

/// An appointment as the calendar shows it.
#[derive(Debug, Clone)]
pub struct AppointmentView {
    /// The stored appointment with names.
    pub row: AppointmentRow,
    /// The patient's age in whole years today.
    pub patient_age_years: Option<u16>,
}

impl AppointmentView {
    pub(crate) fn new(row: AppointmentRow, today: Date) -> Self {
        let patient_age_years = age_on(
            row.patient_date_of_birth,
            row.patient_birth_date_estimated,
            today,
        );
        Self {
            row,
            patient_age_years,
        }
    }
}

/// Something worth knowing about a booking that doesn't stop it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Warning {
    /// The doctor has another appointment at the same time, in another chair.
    PractitionerBusy,
    /// The doctor is on leave then.
    OnLeave,
    /// The time is outside the doctor's weekly hours.
    OutsideHours,
}

impl Warning {
    /// Stable code for clients.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::PractitionerBusy => "practitioner_busy",
            Self::OnLeave => "practitioner_on_leave",
            Self::OutsideHours => "outside_working_hours",
        }
    }

    /// What to tell the front desk.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::PractitionerBusy => "The doctor has another appointment at this time.",
            Self::OnLeave => "The doctor is on leave at this time.",
            Self::OutsideHours => "This is outside the doctor's working hours.",
        }
    }
}

/// An appointment after a booking or change, with its warnings.
#[derive(Debug, Clone)]
pub struct Saved {
    /// The appointment.
    pub appointment: AppointmentView,
    /// Warnings, empty when all is well.
    pub warnings: Vec<Warning>,
}

/// Which appointments the calendar wants.
#[derive(Debug, Clone, Copy)]
pub struct CalendarQuery {
    /// First local day.
    pub from: Date,
    /// Last local day, at most 42 days after `from` counting both.
    pub to: Date,
    /// Only this room.
    pub room_id: Option<RoomId>,
    /// Only this doctor.
    pub practitioner_id: Option<PractitionerId>,
}

/// Appointments starting on the local days asked for, by start.
///
/// # Errors
/// [`AppError::Invalid`] for a bad range; [`AppError::Db`] on failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    query: CalendarQuery,
    now: OffsetDateTime,
) -> Result<Vec<AppointmentView>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let CalendarQuery {
        from,
        to,
        room_id,
        practitioner_id,
    } = query;
    let span = DateSpan::new(from, to).map_err(|error| AppError::invalid("to", error))?;
    let today = clinic_today(&actor.timezone, now);
    let (start, end) = days_bounds(&actor.timezone, span.from(), span.to());
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(
            tx.conn(),
            start,
            end,
            room_id.map(RoomId::uuid),
            practitioner_id.map(PractitionerId::uuid),
            actor.reach(Permission::AppointmentsRead).member(),
        )
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| AppointmentView::new(row, today))
            .collect())
    })
    .await
}

/// A booking as received.
#[derive(Debug, Clone)]
pub struct NewAppointment {
    /// The patient.
    pub patient_id: PatientId,
    /// The doctor.
    pub practitioner_id: PractitionerId,
    /// The chair or room, if any.
    pub room_id: Option<RoomId>,
    /// Branch; the room's, or the default branch.
    pub branch_id: Option<BranchId>,
    /// Start.
    pub starts_at: OffsetDateTime,
    /// End.
    pub ends_at: OffsetDateTime,
    /// `new`, `follow_up`, `procedure` or `emergency`; `follow_up` when absent.
    pub kind: Option<String>,
    /// Reason for the visit.
    pub reason: Option<String>,
    /// Front-desk note.
    pub notes: Option<String>,
    /// How it was booked; `front_desk` when absent.
    pub source: Option<String>,
}

pub(crate) fn parse_reason(text: Option<&str>) -> Result<Option<String>, AppError> {
    text.filter(|text| !text.trim().is_empty())
        .map(|text| {
            Reason::parse(text)
                .map(|reason| reason.as_str().to_owned())
                .map_err(|error| AppError::invalid("reason", error))
        })
        .transpose()
}

fn parse_notes(text: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(text) = text.map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    if text.chars().count() > 2000 {
        return Err(AppError::invalid(
            "notes",
            "must be at most 2000 characters",
        ));
    }
    Ok(Some(text.to_owned()))
}

/// Checks the doctor exists, takes bookings, and is within `reach`: a member who books only
/// their own appointments books only with their own practitioner record.
async fn check_practitioner(
    tx: &mut ScopedTx,
    id: PractitionerId,
    reach: Reach,
) -> Result<(), AppError> {
    let practitioner = schedule::practitioner(tx.conn(), id.uuid())
        .await?
        .filter(|row| reach.includes(row.membership_id))
        .ok_or(AppError::invalid("practitioner_id", "no such doctor"))?;
    if !practitioner.active {
        return Err(AppError::invalid(
            "practitioner_id",
            "this doctor is not taking bookings",
        ));
    }
    Ok(())
}

/// The branch a booking belongs to: the room's when there is one.
async fn booking_branch(
    tx: &mut ScopedTx,
    room_id: Option<RoomId>,
    branch_id: Option<BranchId>,
) -> Result<Uuid, AppError> {
    let Some(room_id) = room_id else {
        return resolve_branch(tx, branch_id).await;
    };
    let room = schedule::room(tx.conn(), room_id.uuid())
        .await?
        .ok_or(AppError::invalid("room_id", "no such room"))?;
    if !room.active {
        return Err(AppError::invalid(
            "room_id",
            "this room is not taking bookings",
        ));
    }
    if branch_id.is_some_and(|branch| branch.uuid() != room.branch_id) {
        return Err(AppError::invalid(
            "branch_id",
            "the room is in another branch",
        ));
    }
    Ok(room.branch_id)
}

async fn warnings(
    tx: &mut ScopedTx,
    timezone: &str,
    appointment_id: Uuid,
    practitioner_id: Uuid,
    slot: TimeSlot,
) -> Result<Vec<Warning>, AppError> {
    let mut warnings = Vec::new();
    if dal::practitioner_busy(
        tx.conn(),
        practitioner_id,
        slot.starts_at(),
        slot.ends_at(),
        appointment_id,
    )
    .await?
    {
        warnings.push(Warning::PractitionerBusy);
    }
    if dal::on_leave(tx.conn(), practitioner_id, slot.starts_at(), slot.ends_at()).await? {
        warnings.push(Warning::OnLeave);
    }
    let shifts: Vec<Shift> = schedule::shifts(tx.conn(), Some(practitioner_id), None)
        .await?
        .into_iter()
        .filter_map(|row| {
            Some(Shift {
                weekday: u8::try_from(row.weekday).ok()?,
                starts: row.starts,
                ends: row.ends,
            })
        })
        .collect();
    if !within_hours(&shifts, slot, clinic_offset(timezone)) {
        warnings.push(Warning::OutsideHours);
    }
    Ok(warnings)
}

async fn reload(tx: &mut ScopedTx, id: Uuid, today: Date) -> Result<AppointmentView, AppError> {
    let row = dal::get(tx.conn(), id, None)
        .await?
        .ok_or(AppError::NotFound("appointment"))?;
    Ok(AppointmentView::new(row, today))
}

/// Books an appointment.
///
/// # Errors
/// [`AppError::Invalid`] for bad input or an unknown doctor, room or branch;
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Conflict`] when
/// the chair is taken.
pub async fn book(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewAppointment,
    now: OffsetDateTime,
) -> Result<Saved, AppError> {
    actor.require(Permission::AppointmentsWrite)?;
    let slot = TimeSlot::new(input.starts_at, input.ends_at)
        .map_err(|error| AppError::invalid("ends_at", error))?;
    let kind = input
        .kind
        .as_deref()
        .map(AppointmentKind::parse)
        .transpose()
        .map_err(|error| AppError::invalid("kind", error))?
        .unwrap_or(AppointmentKind::FollowUp);
    let source = input
        .source
        .as_deref()
        .map(BookingSource::parse)
        .transpose()
        .map_err(|error| AppError::invalid("source", error))?
        .unwrap_or(BookingSource::FrontDesk);
    let reason = parse_reason(input.reason.as_deref())?;
    let notes = parse_notes(input.notes.as_deref())?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let today = clinic_today(&profile.timezone, now);
        // Any patient may be booked; the booking makes them the doctor's own.
        if patients::get(tx.conn(), input.patient_id.uuid(), None)
            .await?
            .is_none()
        {
            return Err(AppError::NotFound("patient"));
        }
        check_practitioner(
            tx,
            input.practitioner_id,
            actor.reach(Permission::AppointmentsWrite),
        )
        .await?;
        let branch_id = booking_branch(tx, input.room_id, input.branch_id).await?;
        let id = AppointmentId::new_v7().uuid();
        let booking = Booking {
            practitioner_id: input.practitioner_id.uuid(),
            branch_id,
            room_id: input.room_id.map(RoomId::uuid),
            starts_at: slot.starts_at(),
            ends_at: slot.ends_at(),
            kind: kind.as_str(),
            reason: reason.as_deref(),
            notes: notes.as_deref(),
        };
        dal::insert(
            tx.conn(),
            id,
            input.patient_id.uuid(),
            source.as_str(),
            &booking,
        )
        .await
        .map_err(room_taken)?;
        dal::insert_event(
            tx.conn(),
            &dal::NewEvent {
                appointment_id: id,
                kind: "booked",
                from_status: None,
                to_status: None,
                changes: None,
                note: None,
                at: now,
            },
        )
        .await?;
        let warnings = warnings(
            tx,
            &profile.timezone,
            id,
            input.practitioner_id.uuid(),
            slot,
        )
        .await?;
        Ok(Saved {
            appointment: reload(tx, id, today).await?,
            warnings,
        })
    })
    .await
}

/// Changes to an appointment. `None` leaves a value as it is; `Some(None)` clears the room and
/// an empty reason or note clears it. A new start without a new end keeps the length.
#[derive(Debug, Clone, Default)]
pub struct ChangeAppointment {
    /// Another doctor.
    pub practitioner_id: Option<PractitionerId>,
    /// Another room, or none.
    pub room_id: Option<Option<RoomId>>,
    /// New start.
    pub starts_at: Option<OffsetDateTime>,
    /// New end.
    pub ends_at: Option<OffsetDateTime>,
    /// New kind.
    pub kind: Option<String>,
    /// New reason; empty clears it.
    pub reason: Option<String>,
    /// New note; empty clears it.
    pub notes: Option<String>,
}

fn record_change(changes: &mut Map<String, Value>, column: &str, old: &Value, new: &Value) {
    if old != new {
        changes.insert(column.to_owned(), json!([old, new]));
    }
}

/// What changes, as the history records it: ids and times, and only a marker for free text.
fn history_changes(current: &AppointmentRow, next: &Booking<'_>) -> Map<String, Value> {
    let mut changes = Map::new();
    let pairs = [
        (
            "starts_at",
            rfc3339(current.starts_at),
            rfc3339(next.starts_at),
        ),
        ("ends_at", rfc3339(current.ends_at), rfc3339(next.ends_at)),
        ("room_id", json!(current.room_id), json!(next.room_id)),
        (
            "practitioner_id",
            json!(current.practitioner_id),
            json!(next.practitioner_id),
        ),
        ("kind", json!(current.kind), json!(next.kind)),
    ];
    for (column, old, new) in &pairs {
        record_change(&mut changes, column, old, new);
    }
    // Free text may describe the patient's condition: the history notes only that it changed.
    if next.reason != current.reason.as_deref() {
        changes.insert("reason".to_owned(), json!("changed"));
    }
    if next.notes != current.notes.as_deref() {
        changes.insert("notes".to_owned(), json!("changed"));
    }
    changes
}

/// The appointment, locked until the transaction ends so changes apply one after the other.
/// Not found when out of the member's `appointments.write` reach.
async fn locked(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    id: AppointmentId,
) -> Result<AppointmentRow, AppError> {
    let reach = actor.reach(Permission::AppointmentsWrite).member();
    if !dal::lock(tx.conn(), id.uuid(), reach).await? {
        return Err(AppError::NotFound("appointment"));
    }
    dal::get(tx.conn(), id.uuid(), None)
        .await?
        .ok_or(AppError::NotFound("appointment"))
}

/// The slot after a change: a new start without a new end keeps the length.
fn moved_slot(current: &AppointmentRow, input: &ChangeAppointment) -> Result<TimeSlot, AppError> {
    let starts_at = input.starts_at.unwrap_or(current.starts_at);
    let ends_at = match (input.starts_at, input.ends_at) {
        (_, Some(ends_at)) => ends_at,
        (Some(starts_at), None) => starts_at + (current.ends_at - current.starts_at),
        (None, None) => current.ends_at,
    };
    TimeSlot::new(starts_at, ends_at).map_err(|error| AppError::invalid("ends_at", error))
}

fn rfc3339(at: OffsetDateTime) -> Value {
    at.format(&time::format_description::well_known::Rfc3339)
        .map_or(Value::Null, Value::String)
}

/// Moves, reassigns or edits an appointment that isn't finished. With `expected_version` (the
/// `row_version` the client last saw), an edit of an appointment that has changed since is
/// refused.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't in this clinic; [`AppError::Stale`] when
/// `expected_version` is out of date; [`AppError::Invalid`] for bad input;
/// [`AppError::Conflict`] when it is finished or the chair is taken.
pub async fn change(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    appointment_id: AppointmentId,
    input: ChangeAppointment,
    expected_version: Option<i64>,
    now: OffsetDateTime,
) -> Result<Saved, AppError> {
    actor.require(Permission::AppointmentsWrite)?;
    let kind = input
        .kind
        .as_deref()
        .map(AppointmentKind::parse)
        .transpose()
        .map_err(|error| AppError::invalid("kind", error))?;
    let reason = input
        .reason
        .as_deref()
        .map(|text| parse_reason(Some(text)))
        .transpose()?;
    let notes = input
        .notes
        .as_deref()
        .map(|text| parse_notes(Some(text)))
        .transpose()?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        let current = locked(tx, actor, appointment_id).await?;
        AppError::check_version(expected_version, current.row_version)?;
        let status = AppointmentStatus::parse(&current.status)
            .map_err(|_| AppError::Internal("unknown appointment status"))?;
        if status.is_finished() {
            return Err(AppError::Conflict(
                "a completed, cancelled or no-show appointment can't be changed",
            ));
        }
        let slot = moved_slot(&current, &input)?;
        let practitioner_id = match input.practitioner_id {
            Some(id) => {
                if id.uuid() != current.practitioner_id {
                    check_practitioner(tx, id, actor.reach(Permission::AppointmentsWrite)).await?;
                }
                id.uuid()
            }
            None => current.practitioner_id,
        };
        let (room_id, branch_id) = match input.room_id {
            Some(room) if room.map(RoomId::uuid) != current.room_id => {
                let branch = booking_branch(
                    tx,
                    room,
                    room.is_none()
                        .then(|| BranchId::from_uuid(current.branch_id)),
                )
                .await?;
                (room.map(RoomId::uuid), branch)
            }
            _ => (current.room_id, current.branch_id),
        };
        let kind = kind.map_or(current.kind.clone(), |kind| kind.as_str().to_owned());
        let reason = reason.unwrap_or_else(|| current.reason.clone());
        let notes = notes.unwrap_or_else(|| current.notes.clone());
        let next = Booking {
            practitioner_id,
            branch_id,
            room_id,
            starts_at: slot.starts_at(),
            ends_at: slot.ends_at(),
            kind: &kind,
            reason: reason.as_deref(),
            notes: notes.as_deref(),
        };
        let changes = history_changes(&current, &next);
        if !changes.is_empty() {
            dal::update(tx.conn(), current.id, &next)
                .await
                .map_err(room_taken)?;
            dal::insert_event(
                tx.conn(),
                &dal::NewEvent {
                    appointment_id: current.id,
                    kind: "changed",
                    from_status: None,
                    to_status: None,
                    changes: Some(Value::Object(changes)),
                    note: None,
                    at: now,
                },
            )
            .await?;
        }
        let warnings = warnings(tx, &actor.timezone, current.id, practitioner_id, slot).await?;
        Ok(Saved {
            appointment: reload(tx, current.id, today).await?,
            warnings,
        })
    })
    .await
}

/// An appointment after a status change, with the queue token arriving issued.
#[derive(Debug, Clone)]
pub struct StatusChanged {
    /// The appointment.
    pub appointment: AppointmentView,
    /// The queue token's id, once the patient has arrived.
    pub token_id: Option<Uuid>,
}

/// What a status request comes to for an appointment, by the transition table.
pub(crate) enum StatusPlan {
    /// The appointment already has that status: repeating the request changes nothing.
    Same,
    /// The table allows the move; the cancel reason to keep, if any.
    Move(Option<Reason>),
    /// The table doesn't allow it.
    Refused(ScheduleError),
}

/// Checks a request to give an appointment in status `from` the status `to`.
///
/// # Errors
/// [`AppError::Invalid`] for a cancel without a reason or a reason that can't be kept.
pub(crate) fn plan_status(
    from: &str,
    to: AppointmentStatus,
    reason: Option<&str>,
) -> Result<StatusPlan, AppError> {
    let from = AppointmentStatus::parse(from)
        .map_err(|_| AppError::Internal("unknown appointment status"))?;
    if from == to {
        return Ok(StatusPlan::Same);
    }
    match check_transition(from, to, reason) {
        Ok(reason) => Ok(StatusPlan::Move(reason)),
        Err(error @ ScheduleError::Transition(..)) => Ok(StatusPlan::Refused(error)),
        Err(error @ (ScheduleError::ReasonRequired | ScheduleError::Text)) => {
            Err(AppError::invalid("reason", error))
        }
        Err(error) => Err(AppError::invalid("status", error)),
    }
}

/// Applies a status change that [`plan_status`] allowed, inside an open transaction: saves it,
/// appends the history, issues a queue token on arrival and moves an existing token along.
pub(crate) async fn apply_status(
    tx: &mut ScopedTx,
    timezone: &str,
    current: &AppointmentRow,
    to: AppointmentStatus,
    reason: Option<&Reason>,
    now: OffsetDateTime,
) -> Result<Option<Uuid>, AppError> {
    let from = AppointmentStatus::parse(&current.status)
        .map_err(|_| AppError::Internal("unknown appointment status"))?;
    let reason = reason.map(Reason::as_str);
    dal::set_status(
        tx.conn(),
        current.id,
        to.as_str(),
        if to == AppointmentStatus::Cancelled {
            reason
        } else {
            None
        },
        now,
    )
    .await?;
    dal::insert_event(
        tx.conn(),
        &dal::NewEvent {
            appointment_id: current.id,
            kind: "status",
            from_status: Some(from.as_str()),
            to_status: Some(to.as_str()),
            changes: None,
            note: reason,
            at: now,
        },
    )
    .await?;
    let token = queue::for_appointment(tx.conn(), current.id).await?;
    match (token, QueueStatus::for_appointment(to)) {
        (None, Some(QueueStatus::Waiting)) => {
            let id = issue_token(
                tx,
                timezone,
                current.branch_id,
                current.patient_id,
                Some(current.id),
                Some(current.practitioner_id),
                now,
            )
            .await?;
            Ok(Some(id))
        }
        (Some(token), Some(next)) => {
            let status = QueueStatus::parse(&token.status)
                .map_err(|_| AppError::Internal("unknown token status"))?;
            if status.can_become(next) {
                queue::set_status(tx.conn(), token.id, next.as_str(), now).await?;
            }
            Ok(Some(token.id))
        }
        (token, _) => Ok(token.map(|token| token.id)),
    }
}

/// An appointment as a status request leaves it, with its queue token once the patient has
/// arrived.
async fn status_changed(
    tx: &mut ScopedTx,
    id: Uuid,
    today: Date,
) -> Result<StatusChanged, AppError> {
    let token_id = queue::for_appointment(tx.conn(), id)
        .await?
        .map(|token| token.id);
    Ok(StatusChanged {
        appointment: reload(tx, id, today).await?,
        token_id,
    })
}

/// Changes an appointment's status along the transition table. Cancelling needs a reason;
/// arriving issues a queue token for the branch and clinic day. Asking for the status it
/// already has changes nothing (no second history entry, no second token) and returns the
/// appointment; a move the table doesn't allow is refused with the appointment as it is.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown status or a cancel without a reason;
/// [`AppError::NotFound`] when it isn't in this clinic.
pub async fn set_status(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    appointment_id: AppointmentId,
    status: &str,
    reason: Option<&str>,
    now: OffsetDateTime,
) -> Result<Moved<StatusChanged>, AppError> {
    actor.require(Permission::AppointmentsWrite)?;
    let to =
        AppointmentStatus::parse(status).map_err(|error| AppError::invalid("status", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        // A retry of a move that landed is answered from one read, without a lock.
        let reach = actor.reach(Permission::AppointmentsWrite).member();
        if let Some(row) = dal::get(tx.conn(), appointment_id.uuid(), reach).await?
            && row.status == to.as_str()
        {
            return Ok(Moved::AlreadyDone(StatusChanged {
                token_id: row.token_id,
                appointment: AppointmentView::new(row, today),
            }));
        }
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let current = locked(tx, actor, appointment_id).await?;
        let token_id = match plan_status(&current.status, to, reason)? {
            StatusPlan::Same => {
                return Ok(Moved::AlreadyDone(
                    status_changed(tx, current.id, today).await?,
                ));
            }
            StatusPlan::Refused(error) => {
                return Ok(Moved::Refused {
                    reason: error.to_string(),
                    current: status_changed(tx, current.id, today).await?,
                });
            }
            StatusPlan::Move(reason) => {
                apply_status(tx, &profile.timezone, &current, to, reason.as_ref(), now).await?
            }
        };
        if current.source == BookingSource::Website.as_str()
            && current.status == AppointmentStatus::Requested.as_str()
        {
            crate::self_booking::notify_decision(tx, &profile, &current, to).await?;
        }
        Ok(Moved::Done(StatusChanged {
            appointment: reload(tx, current.id, today).await?,
            token_id,
        }))
    })
    .await
}
