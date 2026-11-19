//! The console's durable Insights from Phase 2 (docs/plans/console-insights-design.md): API
//! routes from the flushed per-route counters, the front end's page speed and error classes, and
//! page usage. Sakalya staff on the console host only; counts and timings only. Per clinic only
//! totals are shown; roles only across all clinics; a timing from fewer than 5 views is empty.

use std::str::FromStr;

use aarogyam_app::telemetry as app;
use aarogyam_domain::telemetry::Vital;
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use sakalya_http::{ApiError, ApiQuery};
use serde::Serialize;
use time::{Date, OffsetDateTime};
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::console::MetricsParams;
use super::rfc3339;
use crate::AppState;
use crate::extract::PlatformRequest;
use crate::failure::ApiFailure;
use crate::metrics::{BUCKETS, Range, percentile_ms};

/// The routes of this module.
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/console/insights/routes", get(route_insights))
        .route("/console/insights/frontend", get(front_end_insights))
        .route("/console/insights/pages", get(page_insights))
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths(route_insights, front_end_insights, page_insights))]
pub(crate) struct Doc;

fn parse_range(range: Option<&str>) -> Result<Range, ApiError> {
    Range::from_str(range.unwrap_or("1h")).map_err(|_| {
        ApiError::bad_request("invalid_request", "range: must be 1h, 6h, 24h, 7d or 30d")
    })
}

const fn range_seconds(range: Range) -> i64 {
    match range {
        Range::LastHour => 3_600,
        Range::LastSixHours => 21_600,
        Range::LastDay => 86_400,
        Range::LastWeek => 604_800,
        Range::LastMonth => 2_592_000,
    }
}

/// The days a daily counter covers for `range`: yesterday and today for up to a day, otherwise
/// the last 7 or 30 days, today included.
fn range_days(range: Range, today: Date) -> (Date, Date) {
    let back = match range {
        Range::LastHour | Range::LastSixHours | Range::LastDay => 1,
        Range::LastWeek => 6,
        Range::LastMonth => 29,
    };
    (today - time::Duration::days(back), today)
}

/// API routes over a window, from the counters every instance flushes each minute.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiRouteInsights {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The window: `1h`, `6h`, `24h`, `7d` or `30d`.
    pub range: String,
    /// The start of the first hour counted (RFC 3339); counters are kept per hour.
    pub since: String,
    /// Each method and route with requests, busiest first.
    pub routes: Vec<ApiRouteStat>,
}

/// One method and route over the window.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiRouteStat {
    /// `GET`, `POST` ... or `OTHER`.
    pub method: String,
    /// The route template, such as `/api/v1/patients/{id}`, or `unmatched` or `other`.
    pub route: String,
    /// Requests answered.
    pub requests: i64,
    /// Answered 4xx, not counting 429.
    pub errors_4xx: i64,
    /// Answered 5xx.
    pub errors_5xx: i64,
    /// Answered 429.
    pub errors_429: i64,
    /// Share that failed (5xx or 429), 0 to 1.
    pub error_rate: f64,
    /// Median latency in milliseconds, estimated from the buckets.
    pub p50_ms: f64,
    /// 95th percentile latency in milliseconds.
    pub p95_ms: f64,
}

/// API routes by traffic, latency and errors, durable across instances.
#[utoipa::path(
    get,
    path = "/api/v1/console/insights/routes",
    operation_id = "getConsoleRouteInsights",
    tag = "console",
    params(("range" = Option<String>, Query, description = "1h (default), 6h, 24h, 7d or 30d")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ApiRouteInsights),
        (status = 400, description = "Unknown range"),
        (status = 403, description = "Not Sakalya staff")
    )
)]
pub(crate) async fn route_insights(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<MetricsParams>,
) -> Result<Json<ApiRouteInsights>, ApiFailure> {
    let range = parse_range(params.range.as_deref())?;
    let now = OffsetDateTime::now_utc();
    let since = now - time::Duration::seconds(range_seconds(range));
    let since = since
        .replace_minute(0)
        .and_then(|at| at.replace_second(0))
        .and_then(|at| at.replace_nanosecond(0))
        .unwrap_or(since);
    let rows = app::api_routes(state.db(), since).await?;
    Ok(Json(ApiRouteInsights {
        generated_at: rfc3339(now),
        range: range.as_str().to_owned(),
        since: rfc3339(since),
        routes: rows
            .into_iter()
            .map(|row| {
                let mut buckets = [0_u64; BUCKETS];
                for (slot, count) in buckets.iter_mut().zip(&row.buckets) {
                    *slot = u64::try_from(*count).unwrap_or(0);
                }
                let failed = row.err_5xx + row.err_429;
                ApiRouteStat {
                    error_rate: ratio(failed, row.requests),
                    p50_ms: percentile_ms(&buckets, 0.50),
                    p95_ms: percentile_ms(&buckets, 0.95),
                    method: row.method,
                    route: row.route,
                    requests: row.requests,
                    errors_4xx: row.err_4xx,
                    errors_5xx: row.err_5xx,
                    errors_429: row.err_429,
                }
            })
            .collect(),
    }))
}

/// The front end over a window: page speed per page and error classes.
#[derive(Debug, Serialize, ToSchema)]
pub struct FrontEndInsights {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The window: `1h`, `6h`, `24h`, `7d` or `30d`. Counters are daily, so up to a day shows
    /// yesterday and today.
    pub range: String,
    /// First day (`YYYY-MM-DD`).
    pub from: String,
    /// Last day, included.
    pub to: String,
    /// The good and poor thresholds of each vital.
    pub thresholds: Vec<VitalThreshold>,
    /// Each app, page and vital with readings.
    pub vitals: Vec<VitalStat>,
    /// Errors per app, page and class, most first.
    pub errors: Vec<ErrorStat>,
}

/// Where a vital turns from good to needs work, and from needs work to poor.
#[derive(Debug, Serialize, ToSchema)]
pub struct VitalThreshold {
    /// `lcp`, `inp`, `cls` or `ttfb`.
    pub vital: String,
    /// Readings up to this are good.
    pub good: f64,
    /// Readings above this are poor.
    pub poor: f64,
    /// `ms`, or empty for `cls`.
    pub unit: String,
}

/// One vital on one page of one app.
#[derive(Debug, Serialize, ToSchema)]
pub struct VitalStat {
    /// `portal` or `console`.
    pub app: String,
    /// The route template, or `other`.
    pub route: String,
    /// `lcp`, `inp`, `cls` or `ttfb`.
    pub vital: String,
    /// Readings.
    pub samples: i64,
    /// The 75th percentile; `null` with fewer than 5 readings.
    pub p75: Option<f64>,
    /// `good`, `needs_work` or `poor` for the 75th percentile; `null` with it.
    pub rating: Option<String>,
    /// Readings that were good.
    pub good: i64,
    /// Readings that needed work.
    pub needs_work: i64,
    /// Readings that were poor.
    pub poor: i64,
}

/// Errors of one class on one page of one app.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorStat {
    /// `portal` or `console`.
    pub app: String,
    /// The route template, or `other`.
    pub route: String,
    /// `type_error`, `reference_error`, `range_error`, `syntax_error`, `chunk_load`, `network`,
    /// `unhandled_rejection` or `other`.
    pub class: String,
    /// How many.
    pub count: i64,
}

fn rating(vital: Vital, p75: f64) -> &'static str {
    let (good, poor) = vital.thresholds();
    if p75 <= good {
        "good"
    } else if p75 <= poor {
        "needs_work"
    } else {
        "poor"
    }
}

fn count(n: u64) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

/// Page speed (LCP, INP, CLS, TTFB at the 75th percentile) and front-end error classes.
#[utoipa::path(
    get,
    path = "/api/v1/console/insights/frontend",
    operation_id = "getConsoleFrontEndInsights",
    tag = "console",
    params(("range" = Option<String>, Query, description = "1h (default), 6h, 24h, 7d or 30d; up to a day shows yesterday and today")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = FrontEndInsights),
        (status = 400, description = "Unknown range"),
        (status = 403, description = "Not Sakalya staff")
    )
)]
pub(crate) async fn front_end_insights(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<MetricsParams>,
) -> Result<Json<FrontEndInsights>, ApiFailure> {
    let range = parse_range(params.range.as_deref())?;
    let now = OffsetDateTime::now_utc();
    let (from, to) = range_days(range, now.date());
    let front = app::front_end(state.db(), from, to).await?;
    Ok(Json(FrontEndInsights {
        generated_at: rfc3339(now),
        range: range.as_str().to_owned(),
        from: from.to_string(),
        to: to.to_string(),
        thresholds: Vital::ALL
            .iter()
            .map(|vital| {
                let (good, poor) = vital.thresholds();
                VitalThreshold {
                    vital: vital.as_str().to_owned(),
                    good,
                    poor,
                    unit: if *vital == Vital::Cls { "" } else { "ms" }.to_owned(),
                }
            })
            .collect(),
        vitals: front
            .vitals
            .into_iter()
            .map(|stat| VitalStat {
                app: stat.app,
                route: stat.route,
                vital: stat.vital.as_str().to_owned(),
                samples: count(stat.samples),
                rating: stat.p75.map(|p75| rating(stat.vital, p75).to_owned()),
                p75: stat.p75,
                good: count(stat.good),
                needs_work: count(stat.needs_work),
                poor: count(stat.poor),
            })
            .collect(),
        errors: front
            .errors
            .into_iter()
            .map(|row| ErrorStat {
                app: row.app,
                route: row.route,
                class: row.class,
                count: row.count,
            })
            .collect(),
    }))
}

/// Pages over a window: where staff spend time, per app, per role across all clinics, and each
/// clinic's totals.
#[derive(Debug, Serialize, ToSchema)]
pub struct PageInsights {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The window: `1h`, `6h`, `24h`, `7d` or `30d`; up to a day shows yesterday and today.
    pub range: String,
    /// First day (`YYYY-MM-DD`).
    pub from: String,
    /// Last day, included.
    pub to: String,
    /// Each app's pages, all clinics together, most visible time first.
    pub pages: Vec<PageStat>,
    /// Each app's roles across all clinics; never per clinic.
    pub roles: Vec<RolePages>,
    /// Each clinic's totals across its staff and pages, most visible time first.
    pub clinics: Vec<ClinicPages>,
}

/// One page of one app, all clinics together.
#[derive(Debug, Serialize, ToSchema)]
pub struct PageStat {
    /// `portal` or `console`.
    pub app: String,
    /// The route template, or `other`.
    pub route: String,
    /// Views.
    pub views: i64,
    /// Visible time in milliseconds; `null` with fewer than 5 views.
    pub visible_ms: Option<i64>,
    /// Visible time per view in milliseconds; `null` with fewer than 5 views.
    pub avg_visible_ms: Option<f64>,
}

/// One role in one app, across all clinics.
#[derive(Debug, Serialize, ToSchema)]
pub struct RolePages {
    /// `portal` or `console`.
    pub app: String,
    /// A standard role key, `custom` for a clinic's own roles, or a console role.
    pub role_key: String,
    /// Views.
    pub views: i64,
    /// Visible time in milliseconds; `null` with fewer than 5 views.
    pub visible_ms: Option<i64>,
}

/// One clinic's totals: no role, no page.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicPages {
    /// The clinic.
    #[schema(value_type = String)]
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// Page views by all its staff.
    pub views: i64,
    /// Visible time in milliseconds; `null` with fewer than 5 views.
    pub visible_ms: Option<i64>,
}

fn shown(views: i64, visible_ms: i64) -> Option<i64> {
    app::PageUsage::timing_shown(views).then_some(visible_ms)
}

/// Top pages by time and views per app, roles across all clinics, and each clinic's totals.
#[utoipa::path(
    get,
    path = "/api/v1/console/insights/pages",
    operation_id = "getConsolePageInsights",
    tag = "console",
    params(("range" = Option<String>, Query, description = "1h (default), 6h, 24h, 7d or 30d; up to a day shows yesterday and today")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PageInsights),
        (status = 400, description = "Unknown range"),
        (status = 403, description = "Not Sakalya staff")
    )
)]
pub(crate) async fn page_insights(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<MetricsParams>,
) -> Result<Json<PageInsights>, ApiFailure> {
    let range = parse_range(params.range.as_deref())?;
    let now = OffsetDateTime::now_utc();
    let (from, to) = range_days(range, now.date());
    let usage = app::page_usage(state.db(), from, to).await?;
    Ok(Json(PageInsights {
        generated_at: rfc3339(now),
        range: range.as_str().to_owned(),
        from: from.to_string(),
        to: to.to_string(),
        pages: usage
            .pages
            .into_iter()
            .map(|row| PageStat {
                visible_ms: shown(row.views, row.visible_ms),
                avg_visible_ms: app::PageUsage::timing_shown(row.views)
                    .then(|| ratio(row.visible_ms, row.views)),
                app: row.app,
                route: row.route,
                views: row.views,
            })
            .collect(),
        roles: usage
            .roles
            .into_iter()
            .map(|row| RolePages {
                visible_ms: shown(row.views, row.visible_ms),
                app: row.app,
                role_key: row.role_key,
                views: row.views,
            })
            .collect(),
        clinics: usage
            .clinics
            .into_iter()
            .map(|row| ClinicPages {
                visible_ms: shown(row.views, row.visible_ms),
                org_id: row.org_id,
                slug: row.slug,
                name: row.name,
                views: row.views,
            })
            .collect(),
    }))
}

/// `part / whole`, or 0.0 when `whole` is zero.
#[expect(
    clippy::cast_precision_loss,
    reason = "counts stay far below 2^53, where f64 is exact"
)]
fn ratio(part: i64, whole: i64) -> f64 {
    if whole <= 0 {
        0.0
    } else {
        part as f64 / whole as f64
    }
}
