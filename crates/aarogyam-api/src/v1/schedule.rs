//! Chairs and rooms, doctors, their weekly hours and their leave.

use aarogyam_app::schedule::{self as app, PractitionerInput, RoomInput, ShiftInput};
use aarogyam_dal::schedule::{LeaveRow, PractitionerRow, RoomRow, ShiftRow};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{BranchId, LeaveBlockId, MembershipId, PractitionerId, RoomId};
use aarogyam_domain::permission::require::{AppointmentsRead, AppointmentsWrite, SettingsManage};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{clock, parse_clock, parse_day, parse_id, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

fn logged(what: &'static str, id: Uuid) {
    tracing::info!(
        event = Event::ScheduleSetupChanged.as_str(),
        what,
        id = %id,
        "schedule setup changed"
    );
}

/// A chair, room or lab.
#[derive(Debug, Serialize, ToSchema)]
pub struct Room {
    /// The room.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its branch.
    #[schema(value_type = String)]
    pub branch_id: Uuid,
    /// Name, such as `Chair 1`.
    pub name: String,
    /// `chair`, `room` or `lab`.
    pub kind: String,
    /// Whether it can be booked.
    pub active: bool,
    /// Position in lists.
    pub sort_order: i16,
}

impl From<RoomRow> for Room {
    fn from(row: RoomRow) -> Self {
        Self {
            id: row.id,
            branch_id: row.branch_id,
            name: row.name,
            kind: row.kind,
            active: row.active,
            sort_order: row.sort_order,
        }
    }
}

/// The clinic's rooms.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoomList {
    /// In list order.
    pub items: Vec<Room>,
}

/// The clinic's chairs and rooms, in list order.
#[utoipa::path(
    get,
    path = "/api/v1/rooms",
    tag = "schedule",
    security(("bearer" = [])),
    responses(
        (status = 200, body = RoomList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn rooms(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
) -> Result<Json<RoomList>, ApiFailure> {
    let rows = app::rooms(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(RoomList {
        items: rows.into_iter().map(Room::from).collect(),
    }))
}

/// A room to add, or changes to one. Fields left out stay as they are (or take the default).
#[derive(Debug, Deserialize, ToSchema)]
pub struct RoomFields {
    /// Branch; the default branch when adding without one.
    pub branch_id: Option<String>,
    /// Name, 1 to 60 characters; required when adding.
    pub name: Option<String>,
    /// `chair` (default), `room` or `lab`.
    pub kind: Option<String>,
    /// Whether it can be booked (default true).
    pub active: Option<bool>,
    /// Position in lists, 0 to 999.
    pub sort_order: Option<i16>,
}

impl RoomFields {
    fn into_input(self) -> Result<RoomInput, ApiFailure> {
        Ok(RoomInput {
            branch_id: self
                .branch_id
                .as_deref()
                .map(|text| parse_id("branch_id", text).map(BranchId::from_uuid))
                .transpose()?,
            name: self.name,
            kind: self.kind,
            active: self.active,
            sort_order: self.sort_order,
        })
    }
}

/// Adds a chair or room.
#[utoipa::path(
    post,
    path = "/api/v1/rooms",
    tag = "schedule",
    request_body = RoomFields,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Room),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 409, description = "The branch already has a room of that name")
    )
)]
pub(crate) async fn add_room(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<RoomFields>,
) -> Result<(StatusCode, Json<Room>), ApiFailure> {
    let row = app::add_room(
        state.db(),
        &request.actor,
        request.request_id,
        body.into_input()?,
    )
    .await?;
    logged("room", row.id);
    Ok((StatusCode::CREATED, Json(row.into())))
}

/// Renames, moves, retires or reorders a chair or room.
#[utoipa::path(
    patch,
    path = "/api/v1/rooms/{id}",
    tag = "schedule",
    params(("id" = String, Path, description = "The room")),
    request_body = RoomFields,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Room),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such room in this clinic"),
        (status = 409, description = "The branch already has a room of that name")
    )
)]
pub(crate) async fn change_room(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RoomFields>,
) -> Result<Json<Room>, ApiFailure> {
    let row = app::change_room(
        state.db(),
        &request.actor,
        request.request_id,
        RoomId::from_uuid(id),
        body.into_input()?,
    )
    .await?;
    logged("room", row.id);
    Ok(Json(row.into()))
}

/// Removes a chair or room with no upcoming appointments.
#[utoipa::path(
    delete,
    path = "/api/v1/rooms/{id}",
    tag = "schedule",
    params(("id" = String, Path, description = "The room")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such room in this clinic"),
        (status = 409, description = "The room has upcoming appointments")
    )
)]
pub(crate) async fn remove_room(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::remove_room(
        state.db(),
        &request.actor,
        request.request_id,
        RoomId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    logged("room", id);
    Ok(StatusCode::NO_CONTENT)
}

/// A doctor who sees patients.
#[derive(Debug, Serialize, ToSchema)]
pub struct Practitioner {
    /// The doctor.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Their membership, if they sign in.
    #[schema(value_type = Option<String>)]
    pub membership_id: Option<Uuid>,
    /// Name shown on the calendar.
    pub display_name: String,
    /// Council registration number.
    pub registration_number: Option<String>,
    /// Specialty, such as `Orthodontics`.
    pub specialty: Option<String>,
    /// Calendar colour, `#RRGGBB`.
    pub calendar_color: String,
    /// Whether they can be booked.
    pub active: bool,
}

impl From<PractitionerRow> for Practitioner {
    fn from(row: PractitionerRow) -> Self {
        Self {
            id: row.id,
            membership_id: row.membership_id,
            display_name: row.display_name,
            registration_number: row.registration_number,
            specialty: row.specialty,
            calendar_color: row.calendar_color,
            active: row.active,
        }
    }
}

/// The clinic's doctors.
#[derive(Debug, Serialize, ToSchema)]
pub struct PractitionerList {
    /// By name.
    pub items: Vec<Practitioner>,
}

/// The clinic's doctors, by name.
#[utoipa::path(
    get,
    path = "/api/v1/practitioners",
    tag = "schedule",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PractitionerList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn practitioners(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
) -> Result<Json<PractitionerList>, ApiFailure> {
    let rows = app::practitioners(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(PractitionerList {
        items: rows.into_iter().map(Practitioner::from).collect(),
    }))
}

/// A doctor to add, or changes to one. Fields left out stay as they are; an empty
/// `membership_id`, `registration_number` or `specialty` clears it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PractitionerFields {
    /// The member who is this doctor.
    pub membership_id: Option<String>,
    /// Name shown on the calendar, 1 to 120 characters; required when adding.
    pub display_name: Option<String>,
    /// Council registration number.
    pub registration_number: Option<String>,
    /// Specialty.
    pub specialty: Option<String>,
    /// Calendar colour, `#RRGGBB`.
    pub calendar_color: Option<String>,
    /// Whether they can be booked (default true).
    pub active: Option<bool>,
}

impl PractitionerFields {
    fn into_input(self) -> Result<PractitionerInput, ApiFailure> {
        let membership_id = match self.membership_id.as_deref().map(str::trim) {
            None => None,
            Some("") => Some(None),
            Some(text) => Some(Some(MembershipId::from_uuid(parse_id(
                "membership_id",
                text,
            )?))),
        };
        Ok(PractitionerInput {
            membership_id,
            display_name: self.display_name,
            registration_number: self.registration_number,
            specialty: self.specialty,
            calendar_color: self.calendar_color,
            active: self.active,
        })
    }
}

/// Adds a doctor.
#[utoipa::path(
    post,
    path = "/api/v1/practitioners",
    tag = "schedule",
    request_body = PractitionerFields,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Practitioner),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 409, description = "The member is already a doctor")
    )
)]
pub(crate) async fn add_practitioner(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<PractitionerFields>,
) -> Result<(StatusCode, Json<Practitioner>), ApiFailure> {
    let row = app::add_practitioner(
        state.db(),
        &request.actor,
        request.request_id,
        body.into_input()?,
    )
    .await?;
    logged("practitioner", row.id);
    Ok((StatusCode::CREATED, Json(row.into())))
}

/// Changes a doctor's details.
#[utoipa::path(
    patch,
    path = "/api/v1/practitioners/{id}",
    tag = "schedule",
    params(("id" = String, Path, description = "The doctor")),
    request_body = PractitionerFields,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Practitioner),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such doctor in this clinic"),
        (status = 409, description = "The member is already a doctor")
    )
)]
pub(crate) async fn change_practitioner(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PractitionerFields>,
) -> Result<Json<Practitioner>, ApiFailure> {
    let row = app::change_practitioner(
        state.db(),
        &request.actor,
        request.request_id,
        PractitionerId::from_uuid(id),
        body.into_input()?,
    )
    .await?;
    logged("practitioner", row.id);
    Ok(Json(row.into()))
}

/// Removes a doctor with no upcoming appointments, and their weekly hours.
#[utoipa::path(
    delete,
    path = "/api/v1/practitioners/{id}",
    tag = "schedule",
    params(("id" = String, Path, description = "The doctor")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such doctor in this clinic"),
        (status = 409, description = "The doctor has upcoming appointments")
    )
)]
pub(crate) async fn remove_practitioner(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::remove_practitioner(
        state.db(),
        &request.actor,
        request.request_id,
        PractitionerId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    logged("practitioner", id);
    Ok(StatusCode::NO_CONTENT)
}

/// One stretch of a doctor's week, in the clinic's local time.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WorkingShift {
    /// 1 Monday to 7 Sunday.
    pub weekday: u8,
    /// Start, `HH:MM`.
    pub starts: String,
    /// End, `HH:MM`, after the start.
    pub ends: String,
    /// Branch; the default branch when left out.
    pub branch_id: Option<String>,
}

impl From<ShiftRow> for WorkingShift {
    fn from(row: ShiftRow) -> Self {
        Self {
            weekday: u8::try_from(row.weekday).unwrap_or_default(),
            starts: clock(row.starts),
            ends: clock(row.ends),
            branch_id: Some(row.branch_id.to_string()),
        }
    }
}

/// A doctor's week.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct WorkingHours {
    /// Shifts by weekday and start; split shifts are two entries.
    pub shifts: Vec<WorkingShift>,
}

/// A doctor's weekly hours.
#[utoipa::path(
    get,
    path = "/api/v1/practitioners/{id}/working-hours",
    tag = "schedule",
    params(("id" = String, Path, description = "The doctor")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = WorkingHours),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read"),
        (status = 404, description = "No such doctor in this clinic")
    )
)]
pub(crate) async fn hours(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<WorkingHours>, ApiFailure> {
    let rows = app::hours(
        state.db(),
        &request.actor,
        request.request_id,
        PractitionerId::from_uuid(id),
    )
    .await?;
    Ok(Json(WorkingHours {
        shifts: rows.into_iter().map(WorkingShift::from).collect(),
    }))
}

/// Replaces a doctor's weekly hours. An empty list clears them.
#[utoipa::path(
    put,
    path = "/api/v1/practitioners/{id}/working-hours",
    tag = "schedule",
    params(("id" = String, Path, description = "The doctor")),
    request_body = WorkingHours,
    security(("bearer" = [])),
    responses(
        (status = 200, body = WorkingHours),
        (status = 400, description = "Bad or overlapping shifts"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such doctor in this clinic")
    )
)]
pub(crate) async fn set_hours(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<WorkingHours>,
) -> Result<Json<WorkingHours>, ApiFailure> {
    let mut shifts = Vec::with_capacity(body.shifts.len());
    for shift in body.shifts {
        shifts.push(ShiftInput {
            weekday: shift.weekday,
            starts: parse_clock("starts", &shift.starts)?,
            ends: parse_clock("ends", &shift.ends)?,
            branch_id: shift
                .branch_id
                .as_deref()
                .map(|text| parse_id("branch_id", text).map(BranchId::from_uuid))
                .transpose()?,
        });
    }
    let rows = app::set_hours(
        state.db(),
        &request.actor,
        request.request_id,
        PractitionerId::from_uuid(id),
        shifts,
    )
    .await?;
    logged("working_hours", id);
    Ok(Json(WorkingHours {
        shifts: rows.into_iter().map(WorkingShift::from).collect(),
    }))
}

/// Time a doctor is away.
#[derive(Debug, Serialize, ToSchema)]
pub struct Leave {
    /// The leave.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The doctor.
    #[schema(value_type = String)]
    pub practitioner_id: Uuid,
    /// Start (RFC 3339).
    pub starts_at: String,
    /// End (RFC 3339).
    pub ends_at: String,
    /// Why.
    pub reason: Option<String>,
}

impl From<LeaveRow> for Leave {
    fn from(row: LeaveRow) -> Self {
        Self {
            id: row.id,
            practitioner_id: row.practitioner_id,
            starts_at: rfc3339(row.starts_at),
            ends_at: rfc3339(row.ends_at),
            reason: row.reason,
        }
    }
}

/// Leave in a range.
#[derive(Debug, Serialize, ToSchema)]
pub struct LeaveList {
    /// By start.
    pub items: Vec<Leave>,
}

/// Which leave to list.
#[derive(Debug, Deserialize)]
pub struct LeaveQuery {
    /// First local day, `YYYY-MM-DD`.
    pub from: String,
    /// Last local day, `YYYY-MM-DD`; at most 31 days counting both.
    pub to: String,
    /// Only this doctor.
    pub practitioner_id: Option<String>,
}

/// Leave overlapping the local days `from` to `to`.
#[utoipa::path(
    get,
    path = "/api/v1/leave-blocks",
    tag = "schedule",
    params(
        ("from" = String, Query, description = "First local day, `YYYY-MM-DD`"),
        ("to" = String, Query, description = "Last local day, `YYYY-MM-DD`; at most 31 days counting both"),
        ("practitioner_id" = Option<String>, Query, description = "Only this doctor")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LeaveList),
        (status = 400, description = "Bad dates or a range over 31 days"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read")
    )
)]
pub(crate) async fn leave(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
    ApiQuery(query): ApiQuery<LeaveQuery>,
) -> Result<Json<LeaveList>, ApiFailure> {
    let rows = app::leave(
        state.db(),
        &request.actor,
        request.request_id,
        parse_day("from", &query.from)?,
        parse_day("to", &query.to)?,
        query
            .practitioner_id
            .as_deref()
            .map(|text| parse_id("practitioner_id", text).map(PractitionerId::from_uuid))
            .transpose()?,
    )
    .await?;
    Ok(Json(LeaveList {
        items: rows.into_iter().map(Leave::from).collect(),
    }))
}

/// Leave to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewLeave {
    /// The doctor.
    pub practitioner_id: String,
    /// Start (RFC 3339).
    pub starts_at: String,
    /// End (RFC 3339), after the start.
    pub ends_at: String,
    /// Why, up to 200 characters.
    pub reason: Option<String>,
}

/// Records a doctor's leave. Bookings already made stay; new ones get a warning.
#[utoipa::path(
    post,
    path = "/api/v1/leave-blocks",
    tag = "schedule",
    request_body = NewLeave,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Leave),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.write"),
        (status = 404, description = "No such doctor in this clinic")
    )
)]
pub(crate) async fn add_leave(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsWrite>,
    ApiJson(body): ApiJson<NewLeave>,
) -> Result<(StatusCode, Json<Leave>), ApiFailure> {
    let row = app::add_leave(
        state.db(),
        &request.actor,
        request.request_id,
        PractitionerId::from_uuid(parse_id("practitioner_id", &body.practitioner_id)?),
        parse_instant("starts_at", &body.starts_at)?,
        parse_instant("ends_at", &body.ends_at)?,
        body.reason,
    )
    .await?;
    logged("leave", row.id);
    Ok((StatusCode::CREATED, Json(row.into())))
}

/// Removes leave.
#[utoipa::path(
    delete,
    path = "/api/v1/leave-blocks/{id}",
    tag = "schedule",
    params(("id" = String, Path, description = "The leave")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.write"),
        (status = 404, description = "No such leave in this clinic")
    )
)]
pub(crate) async fn remove_leave(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::remove_leave(
        state.db(),
        &request.actor,
        request.request_id,
        LeaveBlockId::from_uuid(id),
    )
    .await?;
    logged("leave", id);
    Ok(StatusCode::NO_CONTENT)
}
