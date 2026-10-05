//! Follow-ups (recalls).

use aarogyam_app::recalls::{self as app, RecallView};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{PatientId, RecallId};
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::PatientRef;
use super::{parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A follow-up.
#[derive(Debug, Serialize, ToSchema)]
pub struct Recall {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The patient.
    pub patient: PatientRef,
    /// `follow_up`, `cleaning`, …
    pub kind: String,
    /// Why.
    pub reason: String,
    /// When it falls due, `YYYY-MM-DD`.
    pub due_on: String,
    /// `due`, `notified`, `booked`, `done` or `dismissed`.
    pub status: String,
    /// When it was done.
    pub done_at: Option<String>,
}

impl From<RecallView> for Recall {
    fn from(v: RecallView) -> Self {
        Self {
            id: v.id.uuid(),
            patient: v.patient.into(),
            kind: v.kind,
            reason: v.reason,
            due_on: v.due_on.to_string(),
            status: v.status,
            done_at: v.done_at.map(rfc3339),
        }
    }
}

/// Follow-ups.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecallList {
    /// Soonest first.
    pub items: Vec<Recall>,
}

/// A follow-up to plan.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewRecall {
    /// When it falls due, `YYYY-MM-DD`.
    pub due_on: String,
    /// Why, 1 to 300 characters.
    pub reason: String,
    /// `follow_up` by default; `cleaning`, `review`, …
    pub kind: Option<String>,
}

/// Plans a follow-up for a patient.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/recalls",
    operation_id = "createRecall",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = NewRecall,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Recall),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewRecall>,
) -> Result<(StatusCode, Json<Recall>), ApiFailure> {
    let due_on = parse_day("due_on", &body.due_on)?;
    let view = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        due_on,
        &body.reason,
        body.kind.as_deref(),
    )
    .await?;
    tracing::info!(event = Event::RecallCreated.as_str(), recall_id = %view.id.uuid(), "recall created");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Filters for due follow-ups.
#[derive(Debug, Deserialize)]
pub struct DueParams {
    /// Only those due before this clinic day.
    pub due_before: Option<String>,
}

/// Open follow-ups, soonest first.
#[utoipa::path(
    get,
    path = "/api/v1/recalls",
    operation_id = "listRecallsDue",
    tag = "patients",
    params(("due_before" = Option<String>, Query, description = "Only those due before this day, YYYY-MM-DD")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = RecallList),
        (status = 400, description = "A bad date"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read")
    )
)]
pub(crate) async fn due(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiQuery(params): ApiQuery<DueParams>,
) -> Result<Json<RecallList>, ApiFailure> {
    let before = params
        .due_before
        .as_deref()
        .map(|t| parse_day("due_before", t))
        .transpose()?;
    let rows = app::due(state.db(), &request.actor, request.request_id, before).await?;
    Ok(Json(RecallList {
        items: rows.into_iter().map(Recall::from).collect(),
    }))
}

/// Marks a follow-up done.
#[utoipa::path(
    post,
    path = "/api/v1/recalls/{id}/done",
    operation_id = "markRecallDone",
    tag = "patients",
    params(("id" = String, Path, description = "The follow-up")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Recall),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such follow-up in this clinic"),
        (status = 409, description = "Already closed")
    )
)]
pub(crate) async fn done(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Recall>, ApiFailure> {
    let view = app::done(
        state.db(),
        &request.actor,
        request.request_id,
        RecallId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(view.into()))
}
