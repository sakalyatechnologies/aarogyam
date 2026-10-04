//! The waiting-room queue.

use aarogyam_app::queue::{self as app, TokenView, WalkIn};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{BranchId, PatientId, PractitionerId, QueueTokenId};
use aarogyam_domain::permission::require::{AppointmentsRead, AppointmentsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::appointments::{PatientBrief, PractitionerBrief};
use super::{parse_day, parse_id, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A waiting-room token.
#[derive(Debug, Serialize, ToSchema)]
pub struct QueueToken {
    /// The token.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Branch.
    #[schema(value_type = String)]
    pub branch_id: Uuid,
    /// The clinic day, `YYYY-MM-DD`.
    pub day: String,
    /// Number shown on the screen; restarts at 1 each day per branch.
    pub token_number: i32,
    /// `waiting`, `in_chair`, `done` or `left`.
    pub status: String,
    /// When it was issued (RFC 3339).
    pub issued_at: String,
    /// When the patient was called in (RFC 3339).
    pub called_at: Option<String>,
    /// When they were done or left (RFC 3339).
    pub done_at: Option<String>,
    /// Minutes waited: until now while waiting, otherwise until called.
    pub wait_minutes: i64,
    /// The appointment; none for a walk-in.
    #[schema(value_type = Option<String>)]
    pub appointment_id: Option<Uuid>,
    /// The patient.
    pub patient: PatientBrief,
    /// The doctor, if known.
    pub practitioner: Option<PractitionerBrief>,
}

impl From<TokenView> for QueueToken {
    fn from(view: TokenView) -> Self {
        let row = view.row;
        Self {
            id: row.id,
            branch_id: row.branch_id,
            day: row.day.to_string(),
            token_number: row.token_number,
            status: row.status,
            issued_at: rfc3339(row.issued_at),
            called_at: row.called_at.map(rfc3339),
            done_at: row.done_at.map(rfc3339),
            wait_minutes: view.wait_minutes,
            appointment_id: row.appointment_id,
            patient: PatientBrief {
                id: row.patient_id,
                number: row.patient_number,
                full_name: row.patient_name,
                sex: row.patient_sex,
                age_years: view.patient_age_years,
            },
            practitioner: row.practitioner_id.zip(row.practitioner_name).map(
                |(id, display_name)| PractitionerBrief {
                    id,
                    display_name,
                    calendar_color: None,
                },
            ),
        }
    }
}

/// A day's queue.
#[derive(Debug, Serialize, ToSchema)]
pub struct QueueDay {
    /// The clinic day, `YYYY-MM-DD`.
    pub date: String,
    /// Tokens by branch and number.
    pub items: Vec<QueueToken>,
}

/// Which day's queue.
#[derive(Debug, Deserialize)]
pub struct QueueQuery {
    /// The clinic day, `YYYY-MM-DD`; today when left out.
    pub date: Option<String>,
    /// Only this branch.
    pub branch_id: Option<String>,
}

/// The queue of a clinic day, with each token's wait.
#[utoipa::path(
    get,
    path = "/api/v1/queue",
    tag = "queue",
    params(
        ("date" = Option<String>, Query, description = "The clinic day, `YYYY-MM-DD`; today when left out"),
        ("branch_id" = Option<String>, Query, description = "Only this branch")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = QueueDay),
        (status = 400, description = "Bad date or id"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
    ApiQuery(query): ApiQuery<QueueQuery>,
) -> Result<Json<QueueDay>, ApiFailure> {
    let queue = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        query
            .date
            .as_deref()
            .map(|text| parse_day("date", text))
            .transpose()?,
        query
            .branch_id
            .as_deref()
            .map(|text| parse_id("branch_id", text).map(BranchId::from_uuid))
            .transpose()?,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(QueueDay {
        date: queue.date.to_string(),
        items: queue.tokens.into_iter().map(QueueToken::from).collect(),
    }))
}

/// A walk-in.
#[derive(Debug, Deserialize, ToSchema)]
#[expect(
    clippy::struct_field_names,
    reason = "the API names references `<thing>_id`"
)]
pub struct WalkInBody {
    /// The patient (register them first if new).
    pub patient_id: String,
    /// The doctor, if known.
    pub practitioner_id: Option<String>,
    /// Branch; the default branch when left out.
    pub branch_id: Option<String>,
}

/// Issues a token to a patient without an appointment.
#[utoipa::path(
    post,
    path = "/api/v1/queue",
    tag = "queue",
    request_body = WalkInBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = QueueToken),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.write"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn walk_in(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsWrite>,
    ApiJson(body): ApiJson<WalkInBody>,
) -> Result<(StatusCode, Json<QueueToken>), ApiFailure> {
    let input = WalkIn {
        patient_id: PatientId::from_uuid(parse_id("patient_id", &body.patient_id)?),
        practitioner_id: body
            .practitioner_id
            .as_deref()
            .map(|text| parse_id("practitioner_id", text).map(PractitionerId::from_uuid))
            .transpose()?,
        branch_id: body
            .branch_id
            .as_deref()
            .map(|text| parse_id("branch_id", text).map(BranchId::from_uuid))
            .transpose()?,
    };
    let token = app::walk_in(
        state.db(),
        &request.actor,
        request.request_id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::QueueTokenIssued.as_str(),
        queue_token_id = %token.row.id,
        "queue token issued"
    );
    Ok((StatusCode::CREATED, Json(token.into())))
}

/// A token status change.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TokenStatusChange {
    /// `in_chair`, `done` or `left`.
    pub status: String,
}

/// Moves a token along. A token with an appointment moves the appointment too.
#[utoipa::path(
    post,
    path = "/api/v1/queue/{id}/status",
    tag = "queue",
    params(("id" = String, Path, description = "The token")),
    request_body = TokenStatusChange,
    security(("bearer" = [])),
    responses(
        (status = 200, body = QueueToken),
        (status = 400, description = "Unknown status or a move the table doesn't allow"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.write"),
        (status = 404, description = "No such token in this clinic")
    )
)]
pub(crate) async fn set_status(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<TokenStatusChange>,
) -> Result<Json<QueueToken>, ApiFailure> {
    let token = app::set_status(
        state.db(),
        &request.actor,
        request.request_id,
        QueueTokenId::from_uuid(id),
        &body.status,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(token.into()))
}
