//! Appointments: the calendar, booking, moving, and status changes.

use aarogyam_app::Moved;
use aarogyam_app::appointments::{
    self as app, AppointmentView, CalendarQuery, ChangeAppointment, NewAppointment, Saved,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AppointmentId, BranchId, PatientId, PractitionerId, RoomId};
use aarogyam_domain::permission::require::{AppointmentsRead, AppointmentsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_day, parse_id, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::{ApiFailure, MoveRefused};

/// A patient as the calendar and queue show them.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientBrief {
    /// The patient.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Readable number, such as `SD-1042`.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Age in whole years today.
    pub age_years: Option<u16>,
}

/// A doctor as the calendar shows them.
#[derive(Debug, Serialize, ToSchema)]
pub struct PractitionerBrief {
    /// The doctor.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name shown on the calendar.
    pub display_name: String,
    /// Calendar colour, `#RRGGBB`.
    pub calendar_color: Option<String>,
}

/// An appointment.
#[derive(Debug, Serialize, ToSchema)]
pub struct Appointment {
    /// The appointment.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Branch.
    #[schema(value_type = String)]
    pub branch_id: Uuid,
    /// Chair or room, if booked into one.
    #[schema(value_type = Option<String>)]
    pub room_id: Option<Uuid>,
    /// The room's name.
    pub room: Option<String>,
    /// Start (RFC 3339, UTC).
    pub starts_at: String,
    /// End (RFC 3339, UTC).
    pub ends_at: String,
    /// `booked`, `confirmed`, `arrived`, `in_chair`, `completed`, `cancelled` or `no_show`.
    pub status: String,
    /// `new`, `follow_up`, `procedure` or `emergency`.
    pub kind: String,
    /// Reason for the visit.
    pub reason: Option<String>,
    /// Front-desk note.
    pub notes: Option<String>,
    /// Whether there is a front-desk note.
    pub has_notes: bool,
    /// `front_desk`, `phone`, `website`, `app` or `whatsapp`.
    pub source: String,
    /// Why it was cancelled.
    pub cancel_reason: Option<String>,
    /// When the patient arrived (RFC 3339).
    pub arrived_at: Option<String>,
    /// When they sat in the chair (RFC 3339).
    pub seated_at: Option<String>,
    /// When the visit ended (RFC 3339).
    pub completed_at: Option<String>,
    /// The day's queue token number, once arrived.
    pub token_number: Option<i32>,
    /// The patient.
    pub patient: PatientBrief,
    /// The doctor.
    pub practitioner: PractitionerBrief,
}

impl From<AppointmentView> for Appointment {
    fn from(view: AppointmentView) -> Self {
        let row = view.row;
        Self {
            id: row.id,
            branch_id: row.branch_id,
            room_id: row.room_id,
            room: row.room_name,
            starts_at: rfc3339(row.starts_at),
            ends_at: rfc3339(row.ends_at),
            status: row.status,
            kind: row.kind,
            reason: row.reason,
            has_notes: row.notes.is_some(),
            notes: row.notes,
            source: row.source,
            cancel_reason: row.cancel_reason,
            arrived_at: row.arrived_at.map(rfc3339),
            seated_at: row.seated_at.map(rfc3339),
            completed_at: row.completed_at.map(rfc3339),
            token_number: row.token_number,
            patient: PatientBrief {
                id: row.patient_id,
                number: row.patient_number,
                full_name: row.patient_name,
                sex: row.patient_sex,
                age_years: view.patient_age_years,
            },
            practitioner: PractitionerBrief {
                id: row.practitioner_id,
                display_name: row.practitioner_name,
                calendar_color: Some(row.practitioner_color),
            },
        }
    }
}

/// Appointments in a range.
#[derive(Debug, Serialize, ToSchema)]
pub struct AppointmentList {
    /// By start.
    pub items: Vec<Appointment>,
}

/// Which appointments to list.
#[derive(Debug, Deserialize)]
pub struct AppointmentQuery {
    /// First local day, `YYYY-MM-DD`.
    pub from: String,
    /// Last local day, `YYYY-MM-DD`; at most 42 days counting both.
    pub to: String,
    /// Only this chair or room.
    pub room_id: Option<String>,
    /// Only this doctor.
    pub practitioner_id: Option<String>,
}

/// Appointments starting on the clinic's local days `from` to `to`, cancelled ones included.
#[utoipa::path(
    get,
    path = "/api/v1/appointments",
    operation_id = "listAppointments",
    tag = "appointments",
    params(
        ("from" = String, Query, description = "First local day, `YYYY-MM-DD`"),
        ("to" = String, Query, description = "Last local day, `YYYY-MM-DD`; at most 42 days counting both"),
        ("room_id" = Option<String>, Query, description = "Only this chair or room"),
        ("practitioner_id" = Option<String>, Query, description = "Only this doctor")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = AppointmentList),
        (status = 400, description = "Bad dates, ids, or a range over 42 days"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
    ApiQuery(query): ApiQuery<AppointmentQuery>,
) -> Result<Json<AppointmentList>, ApiFailure> {
    let calendar = CalendarQuery {
        from: parse_day("from", &query.from)?,
        to: parse_day("to", &query.to)?,
        room_id: query
            .room_id
            .as_deref()
            .map(|text| parse_id("room_id", text).map(RoomId::from_uuid))
            .transpose()?,
        practitioner_id: query
            .practitioner_id
            .as_deref()
            .map(|text| parse_id("practitioner_id", text).map(PractitionerId::from_uuid))
            .transpose()?,
    };
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        calendar,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(AppointmentList {
        items: rows.into_iter().map(Appointment::from).collect(),
    }))
}

/// Something worth knowing that didn't stop the booking.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingWarning {
    /// `practitioner_busy`, `practitioner_on_leave` or `outside_working_hours`.
    pub code: String,
    /// What to tell the front desk.
    pub message: String,
}

/// An appointment after a booking or change.
#[derive(Debug, Serialize, ToSchema)]
pub struct SavedAppointment {
    /// The appointment.
    pub appointment: Appointment,
    /// Warnings; empty when all is well.
    pub warnings: Vec<BookingWarning>,
}

impl From<Saved> for SavedAppointment {
    fn from(saved: Saved) -> Self {
        Self {
            appointment: saved.appointment.into(),
            warnings: saved
                .warnings
                .into_iter()
                .map(|warning| BookingWarning {
                    code: warning.code().to_owned(),
                    message: warning.message().to_owned(),
                })
                .collect(),
        }
    }
}

/// An appointment to book.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewAppointmentBody {
    /// The patient.
    pub patient_id: String,
    /// The doctor.
    pub practitioner_id: String,
    /// The chair or room.
    pub room_id: Option<String>,
    /// Branch; the room's, or the default branch.
    pub branch_id: Option<String>,
    /// Start (RFC 3339).
    pub starts_at: String,
    /// End (RFC 3339), 5 minutes to 12 hours after the start.
    pub ends_at: String,
    /// `new`, `follow_up` (default), `procedure` or `emergency`.
    pub kind: Option<String>,
    /// Reason for the visit, up to 200 characters.
    pub reason: Option<String>,
    /// Front-desk note, up to 2000 characters.
    pub notes: Option<String>,
    /// `front_desk` (default), `phone`, `website`, `app` or `whatsapp`.
    pub source: Option<String>,
}

fn optional_id(field: &str, text: Option<&str>) -> Result<Option<Uuid>, ApiFailure> {
    Ok(text.map(|text| parse_id(field, text)).transpose()?)
}

/// Books an appointment. Two active bookings can't overlap in one chair (`409`); a doctor
/// booked in another chair at the same time, on leave, or outside their hours is allowed, with
/// `warnings`.
#[utoipa::path(
    post,
    path = "/api/v1/appointments",
    operation_id = "bookAppointment",
    tag = "appointments",
    request_body = NewAppointmentBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = SavedAppointment),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "The chair is already booked for part of this time")
    )
)]
pub(crate) async fn book(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsWrite>,
    ApiJson(body): ApiJson<NewAppointmentBody>,
) -> Result<(StatusCode, Json<SavedAppointment>), ApiFailure> {
    let input = NewAppointment {
        patient_id: PatientId::from_uuid(parse_id("patient_id", &body.patient_id)?),
        practitioner_id: PractitionerId::from_uuid(parse_id(
            "practitioner_id",
            &body.practitioner_id,
        )?),
        room_id: optional_id("room_id", body.room_id.as_deref())?.map(RoomId::from_uuid),
        branch_id: optional_id("branch_id", body.branch_id.as_deref())?.map(BranchId::from_uuid),
        starts_at: parse_instant("starts_at", &body.starts_at)?,
        ends_at: parse_instant("ends_at", &body.ends_at)?,
        kind: body.kind,
        reason: body.reason,
        notes: body.notes,
        source: body.source,
    };
    let saved = app::book(
        state.db(),
        &request.actor,
        request.request_id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::AppointmentBooked.as_str(),
        appointment_id = %saved.appointment.row.id,
        warnings = saved.warnings.len(),
        "appointment booked"
    );
    Ok((StatusCode::CREATED, Json(saved.into())))
}

/// Changes to an appointment. Fields left out stay as they are; an empty `room_id`, `reason`
/// or `notes` clears it. A new start without a new end keeps the length.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AppointmentChanges {
    /// Another doctor.
    pub practitioner_id: Option<String>,
    /// Another chair or room; empty for none.
    pub room_id: Option<String>,
    /// New start (RFC 3339).
    pub starts_at: Option<String>,
    /// New end (RFC 3339).
    pub ends_at: Option<String>,
    /// `new`, `follow_up`, `procedure` or `emergency`.
    pub kind: Option<String>,
    /// Reason for the visit; empty to clear.
    pub reason: Option<String>,
    /// Front-desk note; empty to clear.
    pub notes: Option<String>,
}

/// Moves, reassigns or edits an appointment that isn't completed, cancelled or a no-show.
#[utoipa::path(
    patch,
    path = "/api/v1/appointments/{id}",
    operation_id = "updateAppointment",
    tag = "appointments",
    params(("id" = String, Path, description = "The appointment")),
    request_body = AppointmentChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SavedAppointment),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.write"),
        (status = 404, description = "No such appointment in this clinic"),
        (status = 409, description = "The appointment is finished, or the chair is taken")
    )
)]
pub(crate) async fn change(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<AppointmentChanges>,
) -> Result<Json<SavedAppointment>, ApiFailure> {
    let room_id = match body.room_id.as_deref().map(str::trim) {
        None => None,
        Some("") => Some(None),
        Some(text) => Some(Some(RoomId::from_uuid(parse_id("room_id", text)?))),
    };
    let input = ChangeAppointment {
        practitioner_id: optional_id("practitioner_id", body.practitioner_id.as_deref())?
            .map(PractitionerId::from_uuid),
        room_id,
        starts_at: body
            .starts_at
            .as_deref()
            .map(|text| parse_instant("starts_at", text))
            .transpose()?,
        ends_at: body
            .ends_at
            .as_deref()
            .map(|text| parse_instant("ends_at", text))
            .transpose()?,
        kind: body.kind,
        reason: body.reason,
        notes: body.notes,
    };
    let saved = app::change(
        state.db(),
        &request.actor,
        request.request_id,
        AppointmentId::from_uuid(id),
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::AppointmentChanged.as_str(),
        appointment_id = %saved.appointment.row.id,
        warnings = saved.warnings.len(),
        "appointment changed"
    );
    Ok(Json(saved.into()))
}

/// A status change.
#[derive(Debug, Deserialize, ToSchema)]
pub struct StatusChange {
    /// `confirmed`, `arrived`, `in_chair`, `completed`, `cancelled` or `no_show`.
    pub status: String,
    /// Why; required to cancel, up to 200 characters.
    pub reason: Option<String>,
}

/// An appointment after a status change.
#[derive(Debug, Serialize, ToSchema)]
pub struct StatusChanged {
    /// The appointment.
    pub appointment: Appointment,
    /// Its queue token, once the patient has arrived.
    #[schema(value_type = Option<String>)]
    pub queue_token_id: Option<Uuid>,
}

/// Moves an appointment along: booked → confirmed → arrived → in the chair → completed, or
/// cancelled (with a reason) or no-show before arrival. Arriving issues the branch's next queue
/// token for the clinic day. Asking for the status it already has changes nothing (no second
/// history entry or token) and returns the appointment, so a retry after a lost answer is safe.
#[utoipa::path(
    post,
    path = "/api/v1/appointments/{id}/status",
    operation_id = "setAppointmentStatus",
    tag = "appointments",
    params(("id" = String, Path, description = "The appointment")),
    request_body = StatusChange,
    security(("bearer" = [])),
    responses(
        (status = 200, body = StatusChanged),
        (status = 400, description = "Unknown status, or a cancel without a reason"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.write"),
        (status = 404, description = "No such appointment in this clinic"),
        (status = 409, body = MoveRefused, description = "A move the table doesn't allow; `current` is the appointment as it is")
    )
)]
pub(crate) async fn set_status(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<StatusChange>,
) -> Result<Json<StatusChanged>, ApiFailure> {
    let outcome = app::set_status(
        state.db(),
        &request.actor,
        request.request_id,
        AppointmentId::from_uuid(id),
        &body.status,
        body.reason.as_deref(),
        OffsetDateTime::now_utc(),
    )
    .await?;
    match outcome {
        Moved::Done(changed) => {
            tracing::info!(
                event = Event::AppointmentStatusChanged.as_str(),
                appointment_id = %changed.appointment.row.id,
                status = %changed.appointment.row.status,
                "appointment status changed"
            );
            Ok(Json(changed.into()))
        }
        Moved::AlreadyDone(changed) => Ok(Json(changed.into())),
        Moved::Refused { reason, current } => {
            Err(ApiFailure::refused(reason, &StatusChanged::from(current)))
        }
    }
}

impl From<app::StatusChanged> for StatusChanged {
    fn from(changed: app::StatusChanged) -> Self {
        Self {
            appointment: changed.appointment.into(),
            queue_token_id: changed.token_id,
        }
    }
}
