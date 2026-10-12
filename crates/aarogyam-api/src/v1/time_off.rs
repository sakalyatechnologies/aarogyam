//! Staff time off: who is away, requests, decisions, and the appointments a leave affects.
//! Other staff learn only that someone is away and when; the kind and reason are for the
//! requester and for holders of `time_off.manage`.

use aarogyam_app::time_off::{self as app, Affected, FreeDoctor, NewRequest, TimeOffView};
use aarogyam_dal::time_off::AffectedRow;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::MembershipId;
use aarogyam_domain::permission::require::{AppointmentsRead, TimeOffManage, TimeOffRequest};
use aarogyam_domain::time_off::Window;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::{parse_day, parse_id, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::{ClinicRequest, Require};
use crate::failure::ApiFailure;

/// The routes of this module.
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/time-off", get(list).post(create))
        .route("/time-off/{id}/approve", post(approve))
        .route("/time-off/{id}/decline", post(decline))
        .route("/time-off/{id}/cancel", post(cancel))
        .route(
            "/time-off/{id}/affected-appointments",
            get(affected_appointments),
        )
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths(list, create, approve, decline, cancel, affected_appointments))]
pub(crate) struct Doc;

fn logged(what: &'static str, id: Uuid) {
    tracing::info!(
        event = Event::ScheduleSetupChanged.as_str(),
        what,
        id = %id,
        "time off changed"
    );
}

/// A period of time off. `kind`, `reason` and the decision are left out for staff who are not the
/// person away and do not hold `time_off.manage`; they see approved time off only.
#[derive(Debug, Serialize, ToSchema)]
pub struct TimeOff {
    /// The request.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The person away.
    #[schema(value_type = String)]
    pub membership_id: Uuid,
    /// Their name.
    pub member_name: Option<String>,
    /// Start (RFC 3339).
    pub starts_at: String,
    /// End (RFC 3339), exclusive.
    pub ends_at: String,
    /// Whether the window is whole days of the clinic's calendar.
    pub all_day: bool,
    /// `pending`, `approved`, `declined` or `cancelled`.
    pub status: String,
    /// `vacation`, `sick`, `personal` or `other`; private.
    pub kind: Option<String>,
    /// Why; private.
    pub reason: Option<String>,
    /// Who decided; private.
    #[schema(value_type = Option<String>)]
    pub decided_by: Option<Uuid>,
    /// When (RFC 3339); private.
    pub decided_at: Option<String>,
    /// The decider's note; private.
    pub decision_note: Option<String>,
}

impl From<TimeOffView> for TimeOff {
    fn from(view: TimeOffView) -> Self {
        let row = view.row;
        Self {
            id: row.id,
            membership_id: row.membership_id,
            member_name: view.member_name,
            starts_at: rfc3339(row.starts_at),
            ends_at: rfc3339(row.ends_at),
            all_day: row.all_day,
            status: row.status,
            kind: row.kind,
            reason: row.reason,
            decided_by: row.decided_by,
            decided_at: row.decided_at.map(rfc3339),
            decision_note: row.decision_note,
        }
    }
}

/// Time off in a range.
#[derive(Debug, Serialize, ToSchema)]
pub struct TimeOffList {
    /// By start.
    pub items: Vec<TimeOff>,
}

/// Which time off to list.
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// First local day, `YYYY-MM-DD`.
    pub from: String,
    /// Last local day, `YYYY-MM-DD`; at most 42 days counting both.
    pub to: String,
}

/// Who is away on the local days `from` to `to`, and the viewer's own requests.
#[utoipa::path(
    get,
    path = "/api/v1/time-off",
    operation_id = "listTimeOff",
    tag = "schedule",
    params(
        ("from" = String, Query, description = "First local day, `YYYY-MM-DD`"),
        ("to" = String, Query, description = "Last local day, `YYYY-MM-DD`; at most 42 days counting both")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = TimeOffList),
        (status = 400, description = "Bad dates or a range over 42 days"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
    ApiQuery(query): ApiQuery<ListQuery>,
) -> Result<Json<TimeOffList>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        parse_day("from", &query.from)?,
        parse_day("to", &query.to)?,
    )
    .await?;
    Ok(Json(TimeOffList {
        items: rows.into_iter().map(TimeOff::from).collect(),
    }))
}

/// Time off to ask for or record. Give either `starts_at` and `ends_at`, or `first_day` and
/// `last_day` for whole days.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NewTimeOff {
    /// `vacation`, `sick`, `personal` or `other`.
    pub kind: String,
    /// Start (RFC 3339), with `ends_at`.
    pub starts_at: Option<String>,
    /// End (RFC 3339), after the start.
    pub ends_at: Option<String>,
    /// First day, `YYYY-MM-DD`, with `last_day`.
    pub first_day: Option<String>,
    /// Last day, `YYYY-MM-DD`, included.
    pub last_day: Option<String>,
    /// A private reason, at most 200 characters.
    pub reason: Option<String>,
    /// Record it for this member instead of yourself; needs `time_off.manage` and is approved
    /// at once.
    pub membership_id: Option<String>,
}

fn bad(field: &str, message: &str) -> ApiError {
    ApiError::bad_request("invalid_request", format!("{field}: {message}"))
}

fn window(body: &NewTimeOff) -> Result<Window, ApiError> {
    match (
        &body.starts_at,
        &body.ends_at,
        &body.first_day,
        &body.last_day,
    ) {
        (Some(starts_at), Some(ends_at), None, None) => Ok(Window::Timed {
            starts_at: parse_instant("starts_at", starts_at)?,
            ends_at: parse_instant("ends_at", ends_at)?,
        }),
        (None, None, Some(first_day), Some(last_day)) => Ok(Window::AllDay {
            first_day: parse_day("first_day", first_day)?,
            last_day: parse_day("last_day", last_day)?,
        }),
        _ => Err(bad(
            "starts_at",
            "give starts_at and ends_at, or first_day and last_day",
        )),
    }
}

/// Asks for time off, or (with `membership_id`) records it for someone. Your own request waits
/// for the owner unless the clinic switched approval off; time off recorded for someone else
/// is approved at once.
#[utoipa::path(
    post,
    path = "/api/v1/time-off",
    operation_id = "createTimeOff",
    tag = "schedule",
    request_body = NewTimeOff,
    security(("bearer" = [])),
    responses(
        (status = 201, body = TimeOff),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks time_off.request, or time_off.manage for someone else"),
        (status = 404, description = "No such member in this clinic")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<TimeOffRequest>,
    ApiJson(body): ApiJson<NewTimeOff>,
) -> Result<(StatusCode, Json<TimeOff>), ApiFailure> {
    let input = NewRequest {
        membership_id: body
            .membership_id
            .as_deref()
            .map(|text| parse_id("membership_id", text).map(MembershipId::from_uuid))
            .transpose()?,
        window: window(&body)?,
        kind: body.kind,
        reason: body.reason,
    };
    let view = app::request(state.db(), &request.actor, request.request_id, input).await?;
    logged("time_off", view.row.id);
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// A decision's optional note for the requester.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TimeOffDecision {
    /// A note for the requester, at most 200 characters.
    pub note: Option<String>,
}

async fn decide(
    state: &AppState,
    request: &ClinicRequest,
    id: Uuid,
    approve: bool,
    body: TimeOffDecision,
) -> Result<Json<TimeOff>, ApiFailure> {
    let view = app::decide(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        approve,
        body.note.as_deref(),
    )
    .await?;
    logged("time_off", id);
    Ok(Json(view.into()))
}

/// Approves a pending request. A doctor's leave block is made in the same step, so new bookings
/// for them are refused; the requester is told.
#[utoipa::path(
    post,
    path = "/api/v1/time-off/{id}/approve",
    operation_id = "approveTimeOff",
    tag = "schedule",
    params(("id" = String, Path, description = "The request")),
    request_body = TimeOffDecision,
    security(("bearer" = [])),
    responses(
        (status = 200, body = TimeOff),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks time_off.manage"),
        (status = 404, description = "No such request in this clinic"),
        (status = 409, description = "The request is not pending")
    )
)]
pub(crate) async fn approve(
    State(state): State<AppState>,
    Require { request, .. }: Require<TimeOffManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<TimeOffDecision>,
) -> Result<Json<TimeOff>, ApiFailure> {
    decide(&state, &request, id, true, body).await
}

/// Declines a pending request; the requester is told.
#[utoipa::path(
    post,
    path = "/api/v1/time-off/{id}/decline",
    operation_id = "declineTimeOff",
    tag = "schedule",
    params(("id" = String, Path, description = "The request")),
    request_body = TimeOffDecision,
    security(("bearer" = [])),
    responses(
        (status = 200, body = TimeOff),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks time_off.manage"),
        (status = 404, description = "No such request in this clinic"),
        (status = 409, description = "The request is not pending")
    )
)]
pub(crate) async fn decline(
    State(state): State<AppState>,
    Require { request, .. }: Require<TimeOffManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<TimeOffDecision>,
) -> Result<Json<TimeOff>, ApiFailure> {
    decide(&state, &request, id, false, body).await
}

/// Withdraws a pending or approved request and removes its leave block, so the doctor can be
/// booked again. The requester or a holder of `time_off.manage` may; to anyone else it is a 404.
#[utoipa::path(
    post,
    path = "/api/v1/time-off/{id}/cancel",
    operation_id = "cancelTimeOff",
    tag = "schedule",
    params(("id" = String, Path, description = "The request")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = TimeOff),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks time_off.request"),
        (status = 404, description = "No such request in this clinic, or not yours to cancel"),
        (status = 409, description = "The request is already declined or cancelled")
    )
)]
pub(crate) async fn cancel(
    State(state): State<AppState>,
    Require { request, .. }: Require<TimeOffRequest>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<TimeOff>, ApiFailure> {
    let view = app::cancel(state.db(), &request.actor, request.request_id, id).await?;
    logged("time_off", id);
    Ok(Json(view.into()))
}

/// A doctor free for an appointment's time.
#[derive(Debug, Serialize, ToSchema)]
pub struct FreeDoctorSuggestion {
    /// The doctor.
    #[schema(value_type = String)]
    pub practitioner_id: Uuid,
    /// Their name.
    pub display_name: String,
    /// Their calendar colour, `#RRGGBB`.
    pub calendar_color: String,
    /// Whether their weekly hours are set and cover the time.
    pub in_hours: bool,
}

impl From<FreeDoctor> for FreeDoctorSuggestion {
    fn from(doctor: FreeDoctor) -> Self {
        Self {
            practitioner_id: doctor.practitioner_id,
            display_name: doctor.display_name,
            calendar_color: doctor.calendar_color,
            in_hours: doctor.in_hours,
        }
    }
}

/// An unfinished appointment the leave covers.
#[derive(Debug, Serialize, ToSchema)]
pub struct AffectedAppointment {
    /// The appointment.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The doctor who is away.
    #[schema(value_type = String)]
    pub practitioner_id: Uuid,
    /// Start (RFC 3339).
    pub starts_at: String,
    /// End (RFC 3339).
    pub ends_at: String,
    /// `requested`, `booked`, `confirmed`, `arrived` or `in_chair`.
    pub status: String,
    /// The patient's name.
    pub patient_name: String,
    /// Send as `If-Match` when changing the appointment.
    pub row_version: i64,
    /// Doctors free at that time, those with hours set first; at most five.
    pub suggestions: Vec<FreeDoctorSuggestion>,
}

impl From<Affected> for AffectedAppointment {
    fn from(affected: Affected) -> Self {
        let AffectedRow {
            id,
            practitioner_id,
            starts_at,
            ends_at,
            status,
            patient_name,
            row_version,
        } = affected.appointment;
        Self {
            id,
            practitioner_id,
            starts_at: rfc3339(starts_at),
            ends_at: rfc3339(ends_at),
            status,
            patient_name,
            row_version,
            suggestions: affected.suggestions.into_iter().map(Into::into).collect(),
        }
    }
}

/// Appointments a leave covers.
#[derive(Debug, Serialize, ToSchema)]
pub struct AffectedAppointments {
    /// By start.
    pub items: Vec<AffectedAppointment>,
}

/// The unfinished appointments of the person away in the request's window, each with doctors who
/// are free then. To move one, change the appointment as usual: the patient is told the same way.
#[utoipa::path(
    get,
    path = "/api/v1/time-off/{id}/affected-appointments",
    operation_id = "listAffectedAppointments",
    tag = "schedule",
    params(("id" = String, Path, description = "The request")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = AffectedAppointments),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks time_off.manage"),
        (status = 404, description = "No such request in this clinic")
    )
)]
pub(crate) async fn affected_appointments(
    State(state): State<AppState>,
    Require { request, .. }: Require<TimeOffManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<AffectedAppointments>, ApiFailure> {
    let rows =
        app::affected_appointments(state.db(), &request.actor, request.request_id, id).await?;
    Ok(Json(AffectedAppointments {
        items: rows.into_iter().map(AffectedAppointment::from).collect(),
    }))
}
