//! Setting up the calendar: chairs and rooms, doctors, their weekly hours and their leave.
//! Anyone who sees the calendar may list them; changing chairs, doctors and hours needs
//! `settings.manage`, and leave `appointments.write` (the front desk records it).

use aarogyam_dal::clinic;
use aarogyam_dal::schedule::{self as dal, LeaveRow, PractitionerRow, RoomRow, ShiftRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{BranchId, LeaveBlockId, MembershipId, PractitionerId, RoomId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{
    CalendarColor, DateSpan, Reason, RoomKind, ScheduleError, Shift, WeeklyHours, parse_name,
};
use sakalya_db::{Db, ScopedTx};
use time::{Date, OffsetDateTime, Time};
use uuid::Uuid;

use crate::clock::days_bounds;
use crate::error::AppError;
use crate::scope::staff_scope as scope;

fn invalid(field: &'static str) -> impl Fn(ScheduleError) -> AppError {
    move |error| AppError::invalid(field, error)
}

/// The branch to use: the one given, checked, or the clinic's default.
pub(crate) async fn resolve_branch(
    tx: &mut ScopedTx,
    branch_id: Option<BranchId>,
) -> Result<Uuid, AppError> {
    match branch_id {
        Some(id) => {
            if dal::branch_exists(tx.conn(), id.uuid()).await? {
                Ok(id.uuid())
            } else {
                Err(AppError::invalid("branch_id", "no such branch"))
            }
        }
        None => dal::default_branch(tx.conn())
            .await?
            .ok_or(AppError::invalid(
                "branch_id",
                "the clinic has no default branch",
            )),
    }
}

/// The clinic's chairs and rooms, in list order.
///
/// # Errors
/// [`AppError::Denied`] without `appointments.read`; [`AppError::Db`] on failures.
pub async fn rooms(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<RoomRow>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::rooms(tx.conn()).await?)
    })
    .await
}

/// A chair or room to add, or changes to one; `None` leaves a value as it is (or the default).
#[derive(Debug, Clone, Default)]
pub struct RoomInput {
    /// Branch; the default branch when adding without one.
    pub branch_id: Option<BranchId>,
    /// Name, such as `Chair 1`; required when adding.
    pub name: Option<String>,
    /// `chair`, `room` or `lab`; `chair` when adding without one.
    pub kind: Option<String>,
    /// Whether it can be booked.
    pub active: Option<bool>,
    /// Position in lists, 0 to 999.
    pub sort_order: Option<i16>,
}

const ROOM_TAKEN: &str = "this branch already has a room with that name";

async fn room_values(
    tx: &mut ScopedTx,
    input: &RoomInput,
    current: Option<&RoomRow>,
) -> Result<(Uuid, String, String, bool, i16), AppError> {
    let branch_id = match (input.branch_id, current) {
        (None, Some(room)) => room.branch_id,
        (branch, _) => resolve_branch(tx, branch).await?,
    };
    let name = match (&input.name, current) {
        (Some(text), _) => parse_name(text, 60).map_err(invalid("name"))?,
        (None, Some(room)) => room.name.clone(),
        (None, None) => return Err(AppError::invalid("name", ScheduleError::Name)),
    };
    let kind = match (&input.kind, current) {
        (Some(text), _) => RoomKind::parse(text)
            .map_err(invalid("kind"))?
            .as_str()
            .to_owned(),
        (None, Some(room)) => room.kind.clone(),
        (None, None) => RoomKind::Chair.as_str().to_owned(),
    };
    let active = input
        .active
        .or(current.map(|room| room.active))
        .unwrap_or(true);
    let sort_order = input
        .sort_order
        .or(current.map(|room| room.sort_order))
        .unwrap_or(0);
    if !(0..=999).contains(&sort_order) {
        return Err(AppError::invalid("sort_order", "must be 0 to 999"));
    }
    Ok((branch_id, name, kind, active, sort_order))
}

/// Adds a chair or room.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for bad input;
/// [`AppError::Conflict`] for a name the branch already has.
pub async fn add_room(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: RoomInput,
) -> Result<RoomRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let (branch_id, name, kind, active, sort_order) = room_values(tx, &input, None).await?;
        let values = dal::RoomValues {
            branch_id,
            name: &name,
            kind: &kind,
            active,
            sort_order,
        };
        dal::insert_room(tx.conn(), RoomId::new_v7().uuid(), &values)
            .await
            .map_err(|error| AppError::on_constraint(error, "rooms_name", ROOM_TAKEN))
    })
    .await
}

/// Renames, moves, retires or reorders a chair or room.
///
/// # Errors
/// As [`add_room`], and [`AppError::NotFound`] when the room isn't in this clinic.
pub async fn change_room(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    room_id: RoomId,
    input: RoomInput,
) -> Result<RoomRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::room(tx.conn(), room_id.uuid())
            .await?
            .ok_or(AppError::NotFound("room"))?;
        let (branch_id, name, kind, active, sort_order) =
            room_values(tx, &input, Some(&current)).await?;
        let values = dal::RoomValues {
            branch_id,
            name: &name,
            kind: &kind,
            active,
            sort_order,
        };
        dal::update_room(tx.conn(), current.id, &values)
            .await
            .map_err(|error| AppError::on_constraint(error, "rooms_name", ROOM_TAKEN))?
            .ok_or(AppError::NotFound("room"))
    })
    .await
}

/// Removes a chair or room that has no upcoming bookings.
///
/// # Errors
/// [`AppError::Conflict`] while active appointments remain booked into it.
pub async fn remove_room(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    room_id: RoomId,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::room(tx.conn(), room_id.uuid()).await?.is_none() {
            return Err(AppError::NotFound("room"));
        }
        if dal::future_bookings(tx.conn(), Some(room_id.uuid()), None, now).await? > 0 {
            return Err(AppError::Conflict(
                "this room has upcoming appointments; move or cancel them first",
            ));
        }
        dal::delete_room(tx.conn(), room_id.uuid()).await?;
        Ok(())
    })
    .await
}

/// The clinic's doctors, by name.
///
/// # Errors
/// [`AppError::Denied`] without `appointments.read`; [`AppError::Db`] on failures.
pub async fn practitioners(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<PractitionerRow>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::practitioners(tx.conn()).await?)
    })
    .await
}

/// A doctor to add, or changes to one. `None` leaves a value as it is (or the default); an
/// empty registration number or specialty clears it.
#[derive(Debug, Clone, Default)]
pub struct PractitionerInput {
    /// The member who is this doctor; `Some(None)` unlinks.
    pub membership_id: Option<Option<MembershipId>>,
    /// Name shown on the calendar; required when adding.
    pub display_name: Option<String>,
    /// Council registration number.
    pub registration_number: Option<String>,
    /// Qualifications, such as `BDS, MDS`.
    pub qualifications: Option<String>,
    /// Specialty.
    pub specialty: Option<String>,
    /// `#RRGGBB`.
    pub calendar_color: Option<String>,
    /// Whether they can be booked.
    pub active: Option<bool>,
}

const ALREADY_A_DOCTOR: &str = "that member is already a doctor here";

fn optional_text(
    given: Option<&String>,
    current: Option<&String>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    match given {
        Some(text) if text.trim().is_empty() => Ok(None),
        Some(text) => parse_name(text, max).map(Some).map_err(invalid(field)),
        None => Ok(current.cloned()),
    }
}

async fn practitioner_values(
    tx: &mut ScopedTx,
    input: &PractitionerInput,
    current: Option<&PractitionerRow>,
) -> Result<PractitionerRow, AppError> {
    let membership_id = match input.membership_id {
        Some(Some(id)) => {
            if !dal::membership_exists(tx.conn(), id.uuid()).await? {
                return Err(AppError::invalid("membership_id", "no such member"));
            }
            Some(id.uuid())
        }
        Some(None) => None,
        None => current.and_then(|row| row.membership_id),
    };
    let display_name = match (&input.display_name, current) {
        (Some(text), _) => parse_name(text, 120).map_err(invalid("display_name"))?,
        (None, Some(row)) => row.display_name.clone(),
        (None, None) => return Err(AppError::invalid("display_name", ScheduleError::Name)),
    };
    let calendar_color = match (&input.calendar_color, current) {
        (Some(text), _) => CalendarColor::parse(text)
            .map_err(invalid("calendar_color"))?
            .as_str()
            .to_owned(),
        (None, Some(row)) => row.calendar_color.clone(),
        (None, None) => "#136650".to_owned(),
    };
    Ok(PractitionerRow {
        id: current.map_or_else(|| PractitionerId::new_v7().uuid(), |row| row.id),
        membership_id,
        display_name,
        registration_number: optional_text(
            input.registration_number.as_ref(),
            current.and_then(|row| row.registration_number.as_ref()),
            "registration_number",
            40,
        )?,
        qualifications: optional_text(
            input.qualifications.as_ref(),
            current.and_then(|row| row.qualifications.as_ref()),
            "qualifications",
            160,
        )?,
        specialty: optional_text(
            input.specialty.as_ref(),
            current.and_then(|row| row.specialty.as_ref()),
            "specialty",
            80,
        )?,
        calendar_color,
        active: input
            .active
            .or(current.map(|row| row.active))
            .unwrap_or(true),
    })
}

fn practitioner_row_values(row: &PractitionerRow) -> dal::PractitionerValues<'_> {
    dal::PractitionerValues {
        membership_id: row.membership_id,
        display_name: &row.display_name,
        registration_number: row.registration_number.as_deref(),
        qualifications: row.qualifications.as_deref(),
        specialty: row.specialty.as_deref(),
        calendar_color: &row.calendar_color,
        active: row.active,
    }
}

/// Adds a doctor.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for bad input;
/// [`AppError::Conflict`] when the member is already a doctor.
pub async fn add_practitioner(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: PractitionerInput,
) -> Result<PractitionerRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = practitioner_values(tx, &input, None).await?;
        dal::insert_practitioner(tx.conn(), row.id, &practitioner_row_values(&row))
            .await
            .map_err(|error| {
                AppError::on_constraint(error, "practitioners_membership", ALREADY_A_DOCTOR)
            })
    })
    .await
}

/// Changes a doctor's details.
///
/// # Errors
/// As [`add_practitioner`], and [`AppError::NotFound`] when the doctor isn't in this clinic.
pub async fn change_practitioner(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    practitioner_id: PractitionerId,
    input: PractitionerInput,
) -> Result<PractitionerRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::practitioner(tx.conn(), practitioner_id.uuid())
            .await?
            .ok_or(AppError::NotFound("practitioner"))?;
        let row = practitioner_values(tx, &input, Some(&current)).await?;
        dal::update_practitioner(tx.conn(), row.id, &practitioner_row_values(&row))
            .await
            .map_err(|error| {
                AppError::on_constraint(error, "practitioners_membership", ALREADY_A_DOCTOR)
            })?
            .ok_or(AppError::NotFound("practitioner"))
    })
    .await
}

/// Removes a doctor who has no upcoming appointments, with their weekly hours.
///
/// # Errors
/// [`AppError::Conflict`] while active appointments remain booked with them.
pub async fn remove_practitioner(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    practitioner_id: PractitionerId,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::practitioner(tx.conn(), practitioner_id.uuid())
            .await?
            .is_none()
        {
            return Err(AppError::NotFound("practitioner"));
        }
        if dal::future_bookings(tx.conn(), None, Some(practitioner_id.uuid()), now).await? > 0 {
            return Err(AppError::Conflict(
                "this doctor has upcoming appointments; move or cancel them first",
            ));
        }
        dal::delete_practitioner(tx.conn(), practitioner_id.uuid()).await?;
        Ok(())
    })
    .await
}

/// A shift as received.
#[derive(Debug, Clone, Copy)]
pub struct ShiftInput {
    /// 1 Monday to 7 Sunday.
    pub weekday: u8,
    /// Local start.
    pub starts: Time,
    /// Local end.
    pub ends: Time,
    /// Branch; the default branch when absent.
    pub branch_id: Option<BranchId>,
}

/// A doctor's weekly hours, by weekday and start.
///
/// # Errors
/// [`AppError::NotFound`] when the doctor isn't in this clinic.
pub async fn hours(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    practitioner_id: PractitionerId,
) -> Result<Vec<ShiftRow>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::practitioner(tx.conn(), practitioner_id.uuid())
            .await?
            .is_none()
        {
            return Err(AppError::NotFound("practitioner"));
        }
        Ok(dal::shifts(tx.conn(), Some(practitioner_id.uuid()), None).await?)
    })
    .await
}

/// Replaces a doctor's weekly hours. An empty list clears them.
///
/// # Errors
/// [`AppError::Invalid`] for bad or overlapping shifts; [`AppError::NotFound`] when the doctor
/// isn't in this clinic.
pub async fn set_hours(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    practitioner_id: PractitionerId,
    input: Vec<ShiftInput>,
) -> Result<Vec<ShiftRow>, AppError> {
    actor.require(Permission::SettingsManage)?;
    replace_hours(db, actor, request_id, practitioner_id, input).await
}

async fn replace_hours(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    practitioner_id: PractitionerId,
    input: Vec<ShiftInput>,
) -> Result<Vec<ShiftRow>, AppError> {
    let week = WeeklyHours::new(
        input
            .iter()
            .map(|shift| Shift {
                weekday: shift.weekday,
                starts: shift.starts,
                ends: shift.ends,
            })
            .collect(),
    )
    .map_err(invalid("shifts"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::practitioner(tx.conn(), practitioner_id.uuid())
            .await?
            .is_none()
        {
            return Err(AppError::NotFound("practitioner"));
        }
        let mut rows = Vec::with_capacity(week.shifts().len());
        for shift in week.shifts() {
            let branch = input
                .iter()
                .find(|given| {
                    given.weekday == shift.weekday
                        && given.starts == shift.starts
                        && given.ends == shift.ends
                })
                .and_then(|given| given.branch_id);
            rows.push(ShiftRow {
                practitioner_id: practitioner_id.uuid(),
                branch_id: resolve_branch(tx, branch).await?,
                weekday: i16::from(shift.weekday),
                starts: shift.starts,
                ends: shift.ends,
            });
        }
        dal::replace_shifts(tx.conn(), practitioner_id.uuid(), &rows).await?;
        Ok(dal::shifts(tx.conn(), Some(practitioner_id.uuid()), None).await?)
    })
    .await
}

/// The doctor record linked to the signed-in member, if they are one.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn my_practitioner(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Option<PractitionerRow>, AppError> {
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::practitioner_of(tx.conn(), actor.membership_id.uuid()).await?)
    })
    .await
}

/// A doctor's own details: name, qualifications, registration number and specialty. Nothing
/// else about the record (colour, whether they can be booked, who they are linked to) can be
/// changed this way.
///
/// # Errors
/// [`AppError::NotFound`] when the member is not a doctor here; [`AppError::Invalid`] for bad
/// input.
pub async fn change_my_practitioner(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: PractitionerInput,
) -> Result<PractitionerRow, AppError> {
    let input = PractitionerInput {
        membership_id: None,
        calendar_color: None,
        active: None,
        ..input
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::practitioner_of(tx.conn(), actor.membership_id.uuid())
            .await?
            .ok_or(AppError::NotFound("practitioner"))?;
        let row = practitioner_values(tx, &input, Some(&current)).await?;
        dal::update_practitioner(tx.conn(), row.id, &practitioner_row_values(&row))
            .await?
            .ok_or(AppError::NotFound("practitioner"))
    })
    .await
}

/// A doctor's own weekly hours.
///
/// # Errors
/// [`AppError::NotFound`] when the member is not a doctor here.
pub async fn my_hours(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<ShiftRow>, AppError> {
    db.scoped(&scope(actor, request_id), async |tx| {
        let doctor = dal::practitioner_of(tx.conn(), actor.membership_id.uuid())
            .await?
            .ok_or(AppError::NotFound("practitioner"))?;
        Ok(dal::shifts(tx.conn(), Some(doctor.id), None).await?)
    })
    .await
}

/// Replaces a doctor's own weekly hours.
///
/// # Errors
/// As [`set_hours`]; [`AppError::NotFound`] when the member is not a doctor here.
pub async fn set_my_hours(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: Vec<ShiftInput>,
) -> Result<Vec<ShiftRow>, AppError> {
    let doctor = my_practitioner(db, actor, request_id)
        .await?
        .ok_or(AppError::NotFound("practitioner"))?;
    replace_hours(
        db,
        actor,
        request_id,
        PractitionerId::from_uuid(doctor.id),
        input,
    )
    .await
}

/// Leave overlapping the local days `from` to `to`, optionally for one doctor.
///
/// # Errors
/// [`AppError::Invalid`] for a range over 31 days; [`AppError::Db`] on failures.
pub async fn leave(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    from: Date,
    to: Date,
    practitioner_id: Option<PractitionerId>,
) -> Result<Vec<LeaveRow>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    let span = DateSpan::new(from, to).map_err(invalid("to"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let (start, end) = days_bounds(&profile.timezone, span.from(), span.to());
        Ok(dal::leave(
            tx.conn(),
            practitioner_id.map(PractitionerId::uuid),
            start,
            end,
        )
        .await?)
    })
    .await
}

/// Records a doctor's leave. Appointments already booked stay; new bookings get a warning.
///
/// # Errors
/// [`AppError::Invalid`] when the end isn't after the start or the reason is too long;
/// [`AppError::NotFound`] when the doctor isn't in this clinic.
pub async fn add_leave(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    practitioner_id: PractitionerId,
    starts_at: OffsetDateTime,
    ends_at: OffsetDateTime,
    reason: Option<String>,
) -> Result<LeaveRow, AppError> {
    actor.require(Permission::AppointmentsWrite)?;
    if starts_at >= ends_at {
        return Err(AppError::invalid("ends_at", ScheduleError::Times));
    }
    if ends_at - starts_at > time::Duration::days(366) {
        return Err(AppError::invalid("ends_at", "leave lasts at most a year"));
    }
    let reason = reason
        .filter(|text| !text.trim().is_empty())
        .map(|text| Reason::parse(&text))
        .transpose()
        .map_err(invalid("reason"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::practitioner(tx.conn(), practitioner_id.uuid())
            .await?
            .is_none()
        {
            return Err(AppError::NotFound("practitioner"));
        }
        Ok(dal::insert_leave(
            tx.conn(),
            &LeaveRow {
                id: LeaveBlockId::new_v7().uuid(),
                practitioner_id: practitioner_id.uuid(),
                starts_at,
                ends_at,
                reason: reason.map(|reason| reason.as_str().to_owned()),
            },
        )
        .await?)
    })
    .await
}

/// Removes leave.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't in this clinic.
pub async fn remove_leave(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    leave_id: LeaveBlockId,
) -> Result<(), AppError> {
    actor.require(Permission::AppointmentsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::delete_leave(tx.conn(), leave_id.uuid()).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("leave"))
        }
    })
    .await
}
