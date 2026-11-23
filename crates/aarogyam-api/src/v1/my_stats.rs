//! `/me/stats`: a doctor's own day.

use aarogyam_app::my_stats as app;
use aarogyam_domain::permission::require::ClinicalRead;
use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use super::parse_day;
use crate::AppState;
use crate::extract::Require;

/// What to read.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct StatsQuery {
    /// A clinic day, `YYYY-MM-DD`; today in the clinic's time zone by default.
    pub date: Option<String>,
}

/// The caller's own day.
#[derive(Debug, Serialize, ToSchema)]
pub struct MyStats {
    /// The clinic day, `YYYY-MM-DD`.
    pub date: String,
    /// Visits finished that day.
    pub patients_seen: i64,
    /// Procedures done.
    pub procedures_done: i64,
    /// Prescriptions issued.
    pub prescriptions_issued: i64,
    /// Paise received that day on invoices of the caller's visits; left out without
    /// billing.read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collected_paise: Option<i64>,
}

/// The caller's own figures for a day; zeros for a member who is not a doctor.
#[utoipa::path(
    get,
    path = "/api/v1/me/stats",
    operation_id = "getMyStats",
    tag = "clinical",
    params(StatsQuery),
    security(("bearer" = [])),
    responses(
        (status = 200, body = MyStats),
        (status = 400, description = "A bad date"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read")
    )
)]
pub(crate) async fn get_stats(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    Query(query): Query<StatsQuery>,
) -> Result<Json<MyStats>, crate::ApiFailure> {
    let date = query
        .date
        .as_deref()
        .map(|d| parse_day("date", d))
        .transpose()?;
    let figures = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
        date,
    )
    .await?;
    Ok(Json(MyStats {
        date: figures.date.to_string(),
        patients_seen: figures.patients_seen,
        procedures_done: figures.procedures_done,
        prescriptions_issued: figures.prescriptions_issued,
        collected_paise: figures.collected_paise,
    }))
}
