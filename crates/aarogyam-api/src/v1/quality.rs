//! The console's Quality dashboard: recent suite runs recorded by `scripts/quality-run.sh`.
//! Console host only, Sakalya staff only. No patient data: test names and failure messages only.

use aarogyam_app::quality as app;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiQuery;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::AppState;
use crate::extract::PlatformRequest;
use crate::failure::ApiFailure;

/// Most runs returned when `limit` is absent.
const DEFAULT_LIMIT: u32 = 30;
/// Largest `limit` accepted, so a bad query can't force a huge directory scan.
const MAX_LIMIT: u32 = 200;

/// One test that failed within a suite.
#[derive(Debug, Serialize, ToSchema)]
pub struct QualityFailure {
    /// The test's name, as its runner reports it.
    pub test: String,
    /// Why it failed. Never patient data.
    pub message: String,
}

impl From<app::QualityFailure> for QualityFailure {
    fn from(failure: app::QualityFailure) -> Self {
        Self {
            test: failure.test,
            message: failure.message,
        }
    }
}

/// One suite's result within a run.
#[derive(Debug, Serialize, ToSchema)]
pub struct QualitySuite {
    /// The suite's name, such as `aarogyam-dal (db)` or `portal e2e`.
    pub name: String,
    /// `unit`, `db`, `web` or `e2e`.
    pub kind: String,
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
    pub duration_ms: u64,
    pub failures: Vec<QualityFailure>,
}

impl From<app::QualitySuite> for QualitySuite {
    fn from(suite: app::QualitySuite) -> Self {
        Self {
            name: suite.name,
            kind: suite.kind,
            passed: suite.passed,
            failed: suite.failed,
            skipped: suite.skipped,
            duration_ms: suite.duration_ms,
            failures: suite.failures.into_iter().map(Into::into).collect(),
        }
    }
}

/// One recorded run.
#[derive(Debug, Serialize, ToSchema)]
pub struct QualityRun {
    /// Identifies the run; also its file name's stem.
    pub run_id: String,
    /// RFC 3339.
    pub started_at: String,
    /// RFC 3339.
    pub finished_at: String,
    /// `local`, `staging` or another environment name.
    pub environment: String,
    /// The git commit the suites ran at.
    pub commit: String,
    pub suites: Vec<QualitySuite>,
}

impl From<app::QualityRun> for QualityRun {
    fn from(run: app::QualityRun) -> Self {
        Self {
            run_id: run.run_id,
            started_at: run.started_at,
            finished_at: run.finished_at,
            environment: run.environment,
            commit: run.commit,
            suites: run.suites.into_iter().map(Into::into).collect(),
        }
    }
}

/// A point on a suite's pass-rate trend.
#[derive(Debug, Serialize, ToSchema)]
pub struct QualityTrendPoint {
    pub run_id: String,
    pub started_at: String,
    /// Passed over (passed + failed); `1.0` when nothing was graded.
    pub pass_rate: f64,
}

impl From<app::TrendPoint> for QualityTrendPoint {
    fn from(point: app::TrendPoint) -> Self {
        Self {
            run_id: point.run_id,
            started_at: point.started_at,
            pass_rate: point.pass_rate,
        }
    }
}

/// A suite's pass-rate history across the returned runs, oldest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct QualityTrend {
    pub name: String,
    pub kind: String,
    pub points: Vec<QualityTrendPoint>,
}

impl From<app::SuiteTrend> for QualityTrend {
    fn from(trend: app::SuiteTrend) -> Self {
        Self {
            name: trend.name,
            kind: trend.kind,
            points: trend.points.into_iter().map(Into::into).collect(),
        }
    }
}

/// A test failing in the newest run that recorded it.
#[derive(Debug, Serialize, ToSchema)]
pub struct QualityFailingTest {
    pub suite: String,
    pub test: String,
    pub message: String,
    pub run_id: String,
}

impl From<app::FailingTest> for QualityFailingTest {
    fn from(failing: app::FailingTest) -> Self {
        Self {
            suite: failing.suite,
            test: failing.test,
            message: failing.message,
            run_id: failing.run_id,
        }
    }
}

/// The Quality dashboard.
#[derive(Debug, Serialize, ToSchema)]
pub struct QualityReport {
    /// Newest first.
    pub runs: Vec<QualityRun>,
    /// Each suite seen across `runs`.
    pub trend: Vec<QualityTrend>,
    /// Tests failing in the newest run.
    pub failing: Vec<QualityFailingTest>,
}

/// How many runs to return.
#[derive(Debug, Deserialize)]
pub struct QualityParams {
    /// Most recent runs to return (default 30, at most 200).
    pub limit: Option<u32>,
}

/// Recent quality runs, each suite's pass-rate trend, and the currently failing tests.
#[utoipa::path(
    get,
    path = "/api/v1/console/quality",
    tag = "console",
    params(("limit" = Option<u32>, Query, description = "Most recent runs to return (default 30, at most 200)")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = QualityReport),
        (status = 403, description = "Not Sakalya staff"),
        (status = 404, description = "Not the console host")
    )
)]
pub(crate) async fn quality(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<QualityParams>,
) -> Result<Json<QualityReport>, ApiFailure> {
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let report = app::list_runs(state.quality_dir(), limit as usize).await?;
    Ok(Json(QualityReport {
        runs: report.runs.into_iter().map(Into::into).collect(),
        trend: report.trend.into_iter().map(Into::into).collect(),
        failing: report.failing.into_iter().map(Into::into).collect(),
    }))
}
