//! Aggregate-only collection for the console's Insights page
//! (docs/plans/console-insights-design.md, Phase 2): per-route API counters flushed by the API,
//! and the web apps' page counters, page speed and error classes. Counts only; no patient,
//! person, path or message reaches it.

use aarogyam_dal::telemetry as dal;
use aarogyam_domain::telemetry::{BUCKETS, Batch, MIN_SAMPLES, UiApp, Vital};
use sakalya_db::{Db, DbError};
use time::{Date, OffsetDateTime};

pub use dal::{ApiRouteRow, ClinicPagesRow, ErrorRow, PageRow, RoleRow, RouteHourColumns, Sender};

/// Most batches one clinic may add in a day; later ones are dropped. A busy clinic of 20 staff
/// hiding a tab 50 times a day sends about 1 000.
pub const DAILY_CAP: i32 = 5_000;

/// Adds a flush of per-route API counters. The caller drops a flush that fails.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn add_route_hours(db: &Db, rows: &RouteHourColumns) -> Result<i32, DbError> {
    dal::add_route_hours(db.pool(), rows).await
}

/// Every method and route with requests since `since`, busiest first, from the durable counters.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn api_routes(db: &Db, since: OffsetDateTime) -> Result<Vec<ApiRouteRow>, DbError> {
    dal::api_routes(db.pool(), since).await
}

/// Adds a checked batch from `sender` in `app`. Returns false when the clinic is over its
/// [`DAILY_CAP`] today and nothing was added.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record(
    db: &Db,
    sender: Sender<'_>,
    app: UiApp,
    batch: &Batch,
) -> Result<bool, DbError> {
    let mut columns = dal::TelemetryColumns::default();
    for page in &batch.pages {
        columns.routes.push(page.route.to_owned());
        columns.views.push(page.views);
        columns.visible_ms.push(page.visible_ms);
    }
    for vital in &batch.vitals {
        columns.vital_routes.push(vital.route.to_owned());
        columns.vital_names.push(vital.vital.as_str().to_owned());
        columns.vital_buckets.extend_from_slice(&vital.buckets);
    }
    for error in &batch.errors {
        columns.error_routes.push(error.route.to_owned());
        columns.error_classes.push(error.class.as_str().to_owned());
        columns.error_counts.push(error.count);
    }
    dal::record_telemetry(db.pool(), sender, app, DAILY_CAP, &columns).await
}

/// What one drain run's clean-up did.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct CleanupReport {
    /// API hour rows folded into day rows.
    pub folded: i32,
    /// Front-end rows past their retention, deleted.
    pub purged: i32,
}

/// For the drain job: folds API hours older than 30 days into days and deletes counters past
/// their retention (clinic pages 90 days, the rest 400).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clean_up(db: &Db) -> Result<CleanupReport, DbError> {
    Ok(CleanupReport {
        folded: dal::fold_api_routes(db.pool()).await?,
        purged: dal::purge_telemetry(db.pool()).await?,
    })
}

/// One vital on one page, summarised.
#[derive(Debug, Clone, PartialEq)]
pub struct VitalSummary {
    /// The app.
    pub app: String,
    /// The route template, or `other`.
    pub route: String,
    /// The vital.
    pub vital: Vital,
    /// Readings.
    pub samples: u64,
    /// The 75th percentile; `None` below [`MIN_SAMPLES`] readings.
    pub p75: Option<f64>,
    /// Readings that were good.
    pub good: u64,
    /// Readings that needed work.
    pub needs_work: u64,
    /// Readings that were poor.
    pub poor: u64,
}

/// The front end over a window: page speed and error classes.
#[derive(Debug, Clone, PartialEq)]
pub struct FrontEnd {
    /// Each app, page and vital with readings.
    pub vitals: Vec<VitalSummary>,
    /// Error counts per app, page and class, most first.
    pub errors: Vec<ErrorRow>,
}

/// Page speed and errors from `from` to `to`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn front_end(db: &Db, from: Date, to: Date) -> Result<FrontEnd, DbError> {
    let rows = dal::vitals(db.pool(), from, to).await?;
    let vitals = rows
        .into_iter()
        .filter_map(|row| {
            let vital = Vital::parse(&row.vital).ok()?;
            let mut buckets = [0_u64; BUCKETS];
            for (slot, count) in buckets.iter_mut().zip(&row.buckets) {
                *slot = u64::try_from(*count).unwrap_or(0);
            }
            let (good, needs_work, poor) = vital.ratings(&buckets);
            Some(VitalSummary {
                app: row.app,
                route: row.route,
                vital,
                samples: buckets.iter().sum(),
                p75: vital.percentile(&buckets, 0.75),
                good,
                needs_work,
                poor,
            })
        })
        .collect();
    Ok(FrontEnd {
        vitals,
        errors: dal::errors(db.pool(), from, to).await?,
    })
}

/// Pages, roles and clinics over a window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageUsage {
    /// Pages per app, all clinics together, most visible time first.
    pub pages: Vec<PageRow>,
    /// Roles per app across all clinics; never per clinic.
    pub roles: Vec<RoleRow>,
    /// Each clinic's totals, no role and no page.
    pub clinics: Vec<ClinicPagesRow>,
}

impl PageUsage {
    /// Whether a timing from `views` views may be shown: [`MIN_SAMPLES`] or more.
    #[must_use]
    pub fn timing_shown(views: i64) -> bool {
        u64::try_from(views).is_ok_and(|views| views >= MIN_SAMPLES)
    }
}

/// Pages, roles across clinics and clinic totals from `from` to `to`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn page_usage(db: &Db, from: Date, to: Date) -> Result<PageUsage, DbError> {
    Ok(PageUsage {
        pages: dal::pages(db.pool(), from, to).await?,
        roles: dal::page_roles(db.pool(), from, to).await?,
        clinics: dal::clinic_pages(db.pool(), from, to).await?,
    })
}
