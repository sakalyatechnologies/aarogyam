//! Per-route API counters and the web apps' page counters, page speed and error classes for the
//! console's Insights page (`db/migrations/0732_api_route_counters.sql` to
//! `0735_telemetry_functions.sql`). Every call is one `SECURITY DEFINER` function that adds or
//! sums counts: no clinic row, person, path or message passes through here.

use aarogyam_domain::telemetry::UiApp;
use sakalya_db::DbError;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// One finished minute's worth of numbers for a method and route, in column form: row `i` is
/// every vector's element `i`, and its twelve latency buckets are `buckets[12i .. 12i + 12]`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RouteHourColumns {
    /// The UTC hour each row adds to.
    pub hours: Vec<OffsetDateTime>,
    /// `GET`, `POST` ... or `OTHER`.
    pub methods: Vec<String>,
    /// Route templates.
    pub routes: Vec<String>,
    /// Requests answered.
    pub requests: Vec<i32>,
    /// Answered 4xx, not counting 429.
    pub err_4xx: Vec<i32>,
    /// Answered 5xx.
    pub err_5xx: Vec<i32>,
    /// Answered 429.
    pub err_429: Vec<i32>,
    /// Latency buckets, twelve per row.
    pub buckets: Vec<i32>,
}

/// Adds a flush to the hour rows in one autocommit statement, in key order. Returns the rows
/// written.
///
/// # Errors
/// [`DbError`] on a database failure; the caller drops the flush rather than retry it.
pub async fn add_route_hours(pool: &PgPool, rows: &RouteHourColumns) -> Result<i32, DbError> {
    let written = sqlx::query_scalar!(
        r#"select app.add_route_hours($1, $2, $3, $4, $5, $6, $7, $8) as "written!""#,
        &rows.hours,
        &rows.methods,
        &rows.routes,
        &rows.requests,
        &rows.err_4xx,
        &rows.err_5xx,
        &rows.err_429,
        &rows.buckets
    )
    .fetch_one(pool)
    .await?;
    Ok(written)
}

/// Folds hour rows older than 30 days into day rows and deletes day rows older than 400 days.
/// Returns the hour rows folded.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn fold_api_routes(pool: &PgPool) -> Result<i32, DbError> {
    let folded = sqlx::query_scalar!(r#"select app.fold_api_routes() as "folded!""#)
        .fetch_one(pool)
        .await?;
    Ok(folded)
}

/// One method and route summed over a window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiRouteRow {
    /// `GET`, `POST` ... or `OTHER`.
    pub method: String,
    /// The route template.
    pub route: String,
    /// Requests answered.
    pub requests: i64,
    /// Answered 4xx, not counting 429.
    pub err_4xx: i64,
    /// Answered 5xx.
    pub err_5xx: i64,
    /// Answered 429.
    pub err_429: i64,
    /// Latency buckets.
    pub buckets: Vec<i64>,
}

/// Every method and route with requests since `since`, busiest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn api_routes(pool: &PgPool, since: OffsetDateTime) -> Result<Vec<ApiRouteRow>, DbError> {
    let rows = sqlx::query_as!(
        ApiRouteRow,
        r#"select method as "method!", route as "route!", requests as "requests!",
                  err_4xx as "err_4xx!", err_5xx as "err_5xx!", err_429 as "err_429!",
                  buckets as "buckets!"
           from app.console_api_routes($1)"#,
        since
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Who sent a batch: a clinic member (the clinic and their role key) or Sakalya staff on the
/// console (their console role).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sender<'a> {
    /// A member of the clinic named by the host.
    Clinic {
        /// The clinic.
        org_id: Uuid,
        /// The member's role key; the database counts a clinic's own roles as `custom`.
        role_key: &'a str,
    },
    /// Sakalya staff on the console host.
    Console {
        /// Their console role (`owner`, `support` ...).
        role: &'a str,
    },
}

/// A checked batch in column form (see [`RouteHourColumns`] for the layout).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TelemetryColumns {
    /// Page routes.
    pub routes: Vec<String>,
    /// Views per page.
    pub views: Vec<i32>,
    /// Visible milliseconds per page.
    pub visible_ms: Vec<i64>,
    /// Vital routes.
    pub vital_routes: Vec<String>,
    /// Vital names.
    pub vital_names: Vec<String>,
    /// Vital buckets, twelve per row.
    pub vital_buckets: Vec<i32>,
    /// Error routes.
    pub error_routes: Vec<String>,
    /// Error classes.
    pub error_classes: Vec<String>,
    /// Errors per row.
    pub error_counts: Vec<i32>,
}

/// Adds one batch for `app`. Returns false when the clinic was over `daily_cap` batches today
/// and nothing was added.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_telemetry(
    pool: &PgPool,
    sender: Sender<'_>,
    app: UiApp,
    daily_cap: i32,
    batch: &TelemetryColumns,
) -> Result<bool, DbError> {
    let (org_id, role) = match sender {
        Sender::Clinic { org_id, role_key } => (Some(org_id), role_key),
        Sender::Console { role } => (None, role),
    };
    let added = sqlx::query_scalar!(
        r#"select app.record_telemetry($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             as "added!""#,
        org_id,
        role,
        app.as_str(),
        daily_cap,
        &batch.routes,
        &batch.views,
        &batch.visible_ms,
        &batch.vital_routes,
        &batch.vital_names,
        &batch.vital_buckets,
        &batch.error_routes,
        &batch.error_classes,
        &batch.error_counts
    )
    .fetch_one(pool)
    .await?;
    Ok(added)
}

/// Deletes clinic page rows after 90 days, the other counters after 400 and quotas after 2.
/// Returns the rows deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn purge_telemetry(pool: &PgPool) -> Result<i32, DbError> {
    let deleted = sqlx::query_scalar!(r#"select app.purge_telemetry() as "deleted!""#)
        .fetch_one(pool)
        .await?;
    Ok(deleted)
}

/// Views and visible time for one page of one app, all clinics together.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageRow {
    /// `portal` or `console`.
    pub app: String,
    /// The route template, or `other`.
    pub route: String,
    /// Views.
    pub views: i64,
    /// Visible milliseconds.
    pub visible_ms: i64,
}

/// Pages per app from `from` to `to` (included), most visible time first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn pages(pool: &PgPool, from: Date, to: Date) -> Result<Vec<PageRow>, DbError> {
    let rows = sqlx::query_as!(
        PageRow,
        r#"select app as "app!", route as "route!", views as "views!",
                  visible_ms as "visible_ms!"
           from app.console_ui_pages($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Views and visible time for one role in one app, across all clinics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleRow {
    /// `portal` or `console`.
    pub app: String,
    /// A standard role key, `custom`, or a console role.
    pub role_key: String,
    /// Views.
    pub views: i64,
    /// Visible milliseconds.
    pub visible_ms: i64,
}

/// Roles per app from `from` to `to`, across all clinics, most visible time first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn page_roles(pool: &PgPool, from: Date, to: Date) -> Result<Vec<RoleRow>, DbError> {
    let rows = sqlx::query_as!(
        RoleRow,
        r#"select app as "app!", role_key as "role_key!", views as "views!",
                  visible_ms as "visible_ms!"
           from app.console_ui_roles($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// One clinic's page totals across its staff and pages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicPagesRow {
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// Views.
    pub views: i64,
    /// Visible milliseconds.
    pub visible_ms: i64,
}

/// Each clinic's totals from `from` to `to` (clinic days), most visible time first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_pages(
    pool: &PgPool,
    from: Date,
    to: Date,
) -> Result<Vec<ClinicPagesRow>, DbError> {
    let rows = sqlx::query_as!(
        ClinicPagesRow,
        r#"select org_id as "org_id!", slug as "slug!", name as "name!", views as "views!",
                  visible_ms as "visible_ms!"
           from app.console_ui_clinics($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A vital's histogram for one page of one app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VitalRow {
    /// `portal` or `console`.
    pub app: String,
    /// The route template, or `other`.
    pub route: String,
    /// `lcp`, `inp`, `cls` or `ttfb`.
    pub vital: String,
    /// Readings per bucket.
    pub buckets: Vec<i64>,
}

/// Vital histograms from `from` to `to`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn vitals(pool: &PgPool, from: Date, to: Date) -> Result<Vec<VitalRow>, DbError> {
    let rows = sqlx::query_as!(
        VitalRow,
        r#"select app as "app!", route as "route!", vital as "vital!", buckets as "buckets!"
           from app.console_vitals($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Errors of one class on one page of one app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorRow {
    /// `portal` or `console`.
    pub app: String,
    /// The route template, or `other`.
    pub route: String,
    /// The error class.
    pub class: String,
    /// How many.
    pub count: i64,
}

/// Error counts from `from` to `to`, most first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn errors(pool: &PgPool, from: Date, to: Date) -> Result<Vec<ErrorRow>, DbError> {
    let rows = sqlx::query_as!(
        ErrorRow,
        r#"select app as "app!", route as "route!", class as "class!", count as "count!"
           from app.console_errors($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
