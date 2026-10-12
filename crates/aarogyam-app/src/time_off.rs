//! Staff time off: asking for it, deciding, cancelling, and which appointments it affects.
//!
//! Approving makes the leave block that stops bookings for a doctor (see the dal). Other staff
//! learn only that someone is away and when; the kind and reason are for the requester and for
//! holders of `time_off.manage`.

use std::collections::HashMap;

use aarogyam_dal::appointments as appointment_dal;
use aarogyam_dal::schedule;
use aarogyam_dal::time_off::{self as dal, NewTimeOff, TimeOffRow, Viewer};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::MembershipId;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{DateSpan, Shift, TimeSlot, within_hours};
use aarogyam_domain::time_off::{
    Kind, TimeOffError, Window, approved_at_once, clean_text, sees_private,
};
use sakalya_db::{Db, ScopedTx};
use time::Date;
use uuid::Uuid;

use crate::clock::{clinic_offset, days_bounds};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Event names for the two notifications this module writes.
const REQUESTED: &str = "time_off_requested";
const DECIDED: &str = "time_off_decided";

/// The most appointments one request lists.
const MAX_AFFECTED: i64 = 200;
/// The most free doctors suggested for one appointment.
const MAX_SUGGESTIONS: usize = 5;

/// A request as a viewer may see it: `kind`, `reason` and the decision are `None` for other
/// staff.
#[derive(Debug, Clone)]
pub struct TimeOffView {
    /// The request as stored, with the private parts removed when the viewer may not see them.
    pub row: TimeOffRow,
    /// The person away.
    pub member_name: Option<String>,
}

/// A request as received.
#[derive(Debug, Clone)]
pub struct NewRequest {
    /// Record it for this member; needs `time_off.manage`. `None` for yourself.
    pub membership_id: Option<MembershipId>,
    /// `vacation`, `sick`, `personal` or `other`.
    pub kind: String,
    /// When.
    pub window: Window,
    /// A private reason, at most 200 characters.
    pub reason: Option<String>,
}

fn invalid(error: TimeOffError) -> AppError {
    AppError::invalid(error.field(), error)
}

async fn views(tx: &mut ScopedTx, rows: Vec<TimeOffRow>) -> Result<Vec<TimeOffView>, AppError> {
    let mut ids: Vec<Uuid> = rows.iter().map(|row| row.membership_id).collect();
    ids.sort_unstable();
    ids.dedup();
    let names: HashMap<Uuid, String> = dal::member_names(tx.conn(), &ids)
        .await?
        .into_iter()
        .collect();
    Ok(rows
        .into_iter()
        .map(|row| TimeOffView {
            member_name: names.get(&row.membership_id).cloned(),
            row,
        })
        .collect())
}

async fn view(tx: &mut ScopedTx, row: TimeOffRow) -> Result<TimeOffView, AppError> {
    Ok(views(tx, vec![row]).await?.remove(0))
}

fn manages(actor: &ClinicActor) -> bool {
    actor.permissions.allows(Permission::TimeOffManage)
}

/// Who is away, and requests of the viewer's own (all of them for `time_off.manage`), overlapping
/// the local days `from` to `to` (at most 42 days). Others see approved time off only, with
/// the person and the window.
///
/// # Errors
/// [`AppError::Denied`] without `appointments.read`; [`AppError::Invalid`] for a bad range.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    from: Date,
    to: Date,
) -> Result<Vec<TimeOffView>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let span = DateSpan::new(from, to).map_err(|error| AppError::invalid("to", error))?;
    let (start, end) = days_bounds(&actor.timezone, span.from(), span.to());
    let viewer = Viewer {
        membership_id: actor.membership_id.uuid(),
        manages: manages(actor),
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(tx.conn(), viewer, start, end).await?;
        views(tx, rows).await
    })
    .await
}

/// Asks for time off for yourself: pending, or approved at once when the clinic does not ask
/// for approval. With `membership_id` it records time off for someone else, which needs
/// `time_off.manage` and is approved at once. A pending request tells the people who decide.
///
/// # Errors
/// [`AppError::Denied`] without `time_off.request` (or `time_off.manage` for someone else);
/// [`AppError::Invalid`] for a bad window, kind or reason; [`AppError::NotFound`] for a member
/// who is not in this clinic.
pub async fn request(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewRequest,
) -> Result<TimeOffView, AppError> {
    actor.require(Permission::TimeOffRequest)?;
    let own = actor.membership_id;
    let target = input.membership_id.unwrap_or(own);
    let for_someone_else = target != own;
    if for_someone_else {
        actor.require(Permission::TimeOffManage)?;
    }
    let kind = Kind::parse(&input.kind).map_err(|error| AppError::invalid("kind", error))?;
    input.window.check().map_err(invalid)?;
    let reason = clean_text(input.reason.as_deref()).map_err(invalid)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if for_someone_else && !schedule::membership_exists(tx.conn(), target.uuid()).await? {
            return Err(AppError::NotFound("member"));
        }
        let settings = crate::staff_ops::settings_in(tx).await?;
        let mut row = dal::create(
            tx.conn(),
            &NewTimeOff {
                membership_id: target.uuid(),
                kind,
                window: input.window,
                reason: reason.as_deref(),
            },
        )
        .await?;
        if approved_at_once(for_someone_else, settings.time_off_requires_approval) {
            row = dal::approve(tx.conn(), row.id, own.uuid(), None)
                .await?
                .ok_or(AppError::Internal("a new request was not pending"))?;
            if for_someone_else {
                dal::notify(tx.conn(), row.id, DECIDED).await?;
            }
        } else {
            dal::notify(tx.conn(), row.id, REQUESTED).await?;
        }
        view(tx, row).await
    })
    .await
}

async fn request_of(tx: &mut ScopedTx, id: Uuid) -> Result<TimeOffRow, AppError> {
    dal::get(tx.conn(), id)
        .await?
        .ok_or(AppError::NotFound("time off"))
}

/// Approves (`approve`) or declines a pending request, with an optional note for the requester,
/// and tells the requester. Approving makes the leave block in the same transaction.
///
/// # Errors
/// [`AppError::Denied`] without `time_off.manage`; [`AppError::NotFound`] when it is not in this
/// clinic; [`AppError::Conflict`] when it is not pending.
pub async fn decide(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
    approve: bool,
    note: Option<&str>,
) -> Result<TimeOffView, AppError> {
    actor.require(Permission::TimeOffManage)?;
    let note =
        clean_text(note).map_err(|_| AppError::invalid("note", "must be 1 to 200 characters"))?;
    let by = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        request_of(tx, id).await?;
        let decided = if approve {
            dal::approve(tx.conn(), id, by, note.as_deref()).await?
        } else {
            dal::decline(tx.conn(), id, by, note.as_deref()).await?
        };
        let row = decided.ok_or(AppError::Conflict("only a pending request can be decided"))?;
        if row.membership_id != by {
            dal::notify(tx.conn(), row.id, DECIDED).await?;
        }
        view(tx, row).await
    })
    .await
}

/// Withdraws a pending or approved request and removes its leave block. The requester and
/// holders of `time_off.manage` may; to anyone else it does not exist.
///
/// # Errors
/// [`AppError::NotFound`] when it is not the caller's to cancel; [`AppError::Conflict`] when it
/// is already declined or cancelled.
pub async fn cancel(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<TimeOffView, AppError> {
    actor.require(Permission::TimeOffRequest)?;
    let manages = manages(actor);
    let me = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = request_of(tx, id).await?;
        if !sees_private(current.membership_id == me, manages) {
            return Err(AppError::NotFound("time off"));
        }
        let row = dal::cancel(tx.conn(), id).await?.ok_or(AppError::Conflict(
            "only a pending or approved request can be cancelled",
        ))?;
        view(tx, row).await
    })
    .await
}

/// A doctor who is free for an appointment's time.
#[derive(Debug, Clone)]
pub struct FreeDoctor {
    /// The doctor.
    pub practitioner_id: Uuid,
    /// Their name.
    pub display_name: String,
    /// Their calendar colour.
    pub calendar_color: String,
    /// Whether weekly hours are set and cover the time (otherwise they have none set).
    pub in_hours: bool,
}

/// An appointment the time off clashes with, and who could take it instead.
#[derive(Debug, Clone)]
pub struct Affected {
    /// The appointment.
    pub appointment: dal::AffectedRow,
    /// Doctors free then: not on leave, not in another appointment, within their hours; those
    /// with hours set first.
    pub suggestions: Vec<FreeDoctor>,
}

/// The unfinished appointments a request's window covers for the person away, with free-doctor
/// suggestions for each. Moving them goes through the usual appointment change.
///
/// # Errors
/// [`AppError::Denied`] without `time_off.manage`; [`AppError::NotFound`] when the request is not
/// in this clinic.
pub async fn affected_appointments(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<Vec<Affected>, AppError> {
    actor.require(Permission::TimeOffManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let request = request_of(tx, id).await?;
        let appointments = dal::affected(
            tx.conn(),
            request.membership_id,
            request.starts_at,
            request.ends_at,
            MAX_AFFECTED,
        )
        .await?;
        if appointments.is_empty() {
            return Ok(Vec::new());
        }
        let doctors: Vec<_> = schedule::practitioners(tx.conn())
            .await?
            .into_iter()
            .filter(|doctor| doctor.active && doctor.membership_id != Some(request.membership_id))
            .collect();
        let mut shifts: HashMap<Uuid, Vec<Shift>> = HashMap::new();
        for row in schedule::shifts(tx.conn(), None, None).await? {
            if let Ok(weekday) = u8::try_from(row.weekday) {
                shifts.entry(row.practitioner_id).or_default().push(Shift {
                    weekday,
                    starts: row.starts,
                    ends: row.ends,
                });
            }
        }
        let offset = clinic_offset(&actor.timezone);
        let mut out = Vec::with_capacity(appointments.len());
        for appointment in appointments {
            let mut suggestions = Vec::new();
            if let Ok(slot) = TimeSlot::new(appointment.starts_at, appointment.ends_at) {
                for doctor in &doctors {
                    let hours = shifts.get(&doctor.id).map_or(&[][..], Vec::as_slice);
                    if !within_hours(hours, slot, offset)
                        || appointment_dal::on_leave(
                            tx.conn(),
                            doctor.id,
                            appointment.starts_at,
                            appointment.ends_at,
                        )
                        .await?
                        || appointment_dal::practitioner_busy(
                            tx.conn(),
                            doctor.id,
                            appointment.starts_at,
                            appointment.ends_at,
                            appointment.id,
                        )
                        .await?
                    {
                        continue;
                    }
                    suggestions.push(FreeDoctor {
                        practitioner_id: doctor.id,
                        display_name: doctor.display_name.clone(),
                        calendar_color: doctor.calendar_color.clone(),
                        in_hours: !hours.is_empty(),
                    });
                }
            }
            suggestions.sort_by_key(|doctor| !doctor.in_hours);
            suggestions.truncate(MAX_SUGGESTIONS);
            out.push(Affected {
                appointment,
                suggestions,
            });
        }
        Ok(out)
    })
    .await
}
