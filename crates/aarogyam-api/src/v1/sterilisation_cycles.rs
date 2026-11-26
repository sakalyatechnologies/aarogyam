//! Sterilisation cycles: record an autoclave run and list a day's runs (`tasks.use`).

use aarogyam_app::sterilisation::{self as app, Cycle};
use aarogyam_domain::event::Event;
use aarogyam_domain::permission::require::TasksUse;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// One autoclave run.
#[derive(Debug, Serialize, ToSchema)]
pub struct SterilisationCycle {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// When it ran, RFC 3339.
    pub run_at: String,
    /// Who recorded it.
    pub recorded_by_name: Option<String>,
    /// What was in the load, in a few words.
    pub load_note: Option<String>,
}

impl From<Cycle> for SterilisationCycle {
    fn from(cycle: Cycle) -> Self {
        Self {
            id: cycle.id.uuid(),
            run_at: rfc3339(cycle.run_at),
            recorded_by_name: cycle.recorded_by_name,
            load_note: cycle.load_note,
        }
    }
}

/// A cycle to record: it ran now.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewSterilisationCycle {
    /// What was in the load, up to 120 characters.
    pub load_note: Option<String>,
}

/// The cycles of one clinic day.
#[derive(Debug, Serialize, ToSchema)]
pub struct SterilisationCycleList {
    /// The clinic day.
    pub date: String,
    /// The cycles, latest first.
    pub items: Vec<SterilisationCycle>,
}

/// Which day to list.
#[derive(Debug, Deserialize)]
pub struct CycleParams {
    /// The clinic day, `YYYY-MM-DD` (default: today).
    pub date: Option<String>,
}

/// Records a sterilisation cycle that ran now.
#[utoipa::path(
    post,
    path = "/api/v1/sterilisation-cycles",
    operation_id = "recordSterilisationCycle",
    tag = "tasks",
    request_body = NewSterilisationCycle,
    security(("bearer" = [])),
    responses(
        (status = 201, body = SterilisationCycle),
        (status = 400, description = "The note is too long"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.use"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksUse>,
    ApiJson(body): ApiJson<NewSterilisationCycle>,
) -> Result<(StatusCode, Json<SterilisationCycle>), ApiFailure> {
    let cycle = app::record(
        state.db(),
        &request.actor,
        request.request_id,
        body.load_note.as_deref(),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::SterilisationCycleRecorded.as_str(),
        cycle_id = %cycle.id.uuid(),
        "sterilisation cycle recorded"
    );
    Ok((StatusCode::CREATED, Json(cycle.into())))
}

/// The sterilisation cycles of a clinic day, latest first.
#[utoipa::path(
    get,
    path = "/api/v1/sterilisation-cycles",
    operation_id = "listSterilisationCycles",
    tag = "tasks",
    params(("date" = Option<String>, Query, description = "The clinic day, YYYY-MM-DD (default: today)")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = SterilisationCycleList),
        (status = 400, description = "A bad date"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.use"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksUse>,
    ApiQuery(params): ApiQuery<CycleParams>,
) -> Result<Json<SterilisationCycleList>, ApiFailure> {
    let date = params
        .date
        .as_deref()
        .map(|text| parse_day("date", text))
        .transpose()?;
    let (date, cycles) = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        date,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(SterilisationCycleList {
        date: date.to_string(),
        items: cycles.into_iter().map(Into::into).collect(),
    }))
}
