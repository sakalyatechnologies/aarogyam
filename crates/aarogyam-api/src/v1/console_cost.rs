//! The console's cost estimate (docs/plans/console-insights-design.md, Phase 3). Console host
//! only, Sakalya staff only.
//!
//! Cloud Run's month-to-date usage from Cloud Monitoring (cached 15 minutes) times the list prices
//! in `[cost]`, less the free tier; Supabase and Cloudflare are free plans, shown against their
//! limits. Off Google Cloud there is nothing to read, and the answer says so.

use aarogyam_app::cloud_cost::{self, CostLine, CostPrices};
use aarogyam_app::cloud_monitoring::month_start;
use axum::Json;
use axum::extract::State;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;

use super::rfc3339;
use crate::AppState;
use crate::extract::PlatformRequest;
use crate::failure::ApiFailure;

/// What the estimate covers, shown with it.
const LABEL: &str =
    "Estimate — this project only; the free tier is shared across the billing account";
/// Where the real bill is.
const BILLING_URL: &str = "https://console.cloud.google.com/billing";

/// This month's estimated cost: Cloud Run usage after the free tier, and free plans.
#[derive(Debug, Serialize, ToSchema)]
pub struct CostInsights {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The start of the month, midnight UTC (RFC 3339).
    pub period_start: String,
    /// When usage was read up to (RFC 3339); now when `source` is `unavailable`.
    pub period_end: String,
    /// Share of the month that has passed, above 0 and at most 1.
    pub elapsed_fraction: f64,
    /// `cloud_monitoring` (Cloud Run usage read) or `unavailable` (not on Google Cloud, or the
    /// read failed; see `error`). Cloud Run lines and totals are missing when unavailable.
    pub source: String,
    /// Why usage could not be read, such as `Cloud Monitoring: 403`; `null` when read or not set up.
    pub error: Option<String>,
    /// Cloud Run lines (service first, then the drain job), then Supabase and Cloudflare.
    pub items: Vec<CostItem>,
    /// USD so far, Cloud Run only; `null` when unavailable.
    pub total_usd: Option<f64>,
    /// USD for the whole month at this month's pace; `null` when unavailable.
    pub forecast_usd: Option<f64>,
    /// The configured rupees per dollar.
    pub inr_per_usd: f64,
    /// The configured GST rate, percent.
    pub gst_percent: f64,
    /// `total_usd` in rupees, before GST.
    pub total_inr: Option<f64>,
    /// GST on `total_inr`.
    pub total_gst_inr: Option<f64>,
    /// `forecast_usd` in rupees, before GST.
    pub forecast_inr: Option<f64>,
    /// GST on `forecast_inr`.
    pub forecast_gst_inr: Option<f64>,
    /// What the estimate covers, to show with it.
    pub label: String,
    /// The Google Cloud Billing console, for the real bill.
    pub billing_url: String,
}

/// One line of the estimate.
#[derive(Debug, Serialize, ToSchema)]
pub struct CostItem {
    /// A stable key: `service_cpu`, `service_memory`, `service_requests`, `service_egress`,
    /// `service_billable`, `job_cpu`, `job_memory`, `job_billable`, `job_runs`, `supabase_db`,
    /// `cloudflare`.
    pub key: String,
    /// `cloud_run`, `supabase` or `cloudflare`.
    pub provider: String,
    /// What it belongs to: `service` (the API), `job` (the outbox drain), `database` or `edge`.
    pub resource: String,
    /// What it is, in plain words.
    pub label: String,
    /// The unit of `used` and `free`: `vCPU-s`, `GiB-s`, `requests`, `GiB`, `s`, `runs` or `bytes`.
    pub unit: String,
    /// Used this month so far (the database: its size now); `null` when not known.
    pub used: Option<f64>,
    /// Used by the end of the month at the same pace; `null` for plan limits and unknowns.
    pub forecast_used: Option<f64>,
    /// The monthly free amount, or the free plan's limit; `null` when the line has none.
    pub free: Option<f64>,
    /// What is left of `free`; `null` when either is unknown.
    pub free_left: Option<f64>,
    /// USD per unit beyond the free amount; `null` when not billed on its own.
    pub unit_price_usd: Option<f64>,
    /// USD so far after the free amount; `0` on free plans and context lines.
    pub cost_usd: f64,
    /// USD for the month at the same pace after the free amount.
    pub forecast_usd: f64,
    /// One line of context, such as `Free plan; usage isn't read here`.
    pub note: Option<String>,
}

impl From<&CostLine> for CostItem {
    fn from(line: &CostLine) -> Self {
        let note = match (line.key, line.unit_price_usd) {
            (_, None) => Some("Context only; billed through vCPU and memory time".to_owned()),
            ("service_egress", _) => {
                Some("Everything the API sends, priced as internet egress".to_owned())
            }
            _ => None,
        };
        Self {
            key: line.key.to_owned(),
            provider: "cloud_run".to_owned(),
            resource: line.resource.as_str().to_owned(),
            label: line.label.to_owned(),
            unit: line.unit.to_owned(),
            used: Some(line.used),
            forecast_used: Some(line.forecast_used),
            free: line.free,
            free_left: line.free.map(|free| (free - line.used).max(0.0)),
            unit_price_usd: line.unit_price_usd,
            cost_usd: line.cost_usd,
            forecast_usd: line.forecast_usd,
            note,
        }
    }
}

/// The free plans: the database against its size limit, and Cloudflare, whose usage isn't read.
fn free_plans(db_bytes: Option<f64>, limit_bytes: u64) -> [CostItem; 2] {
    #[expect(
        clippy::cast_precision_loss,
        reason = "a plan limit in bytes, far below 2^52"
    )]
    let limit = limit_bytes as f64;
    [
        CostItem {
            key: "supabase_db".to_owned(),
            provider: "supabase".to_owned(),
            resource: "database".to_owned(),
            label: "Supabase database size".to_owned(),
            unit: "bytes".to_owned(),
            used: db_bytes,
            forecast_used: None,
            free: Some(limit),
            free_left: db_bytes.map(|used| (limit - used).max(0.0)),
            unit_price_usd: None,
            cost_usd: 0.0,
            forecast_usd: 0.0,
            note: Some("Free plan: the size now against the plan's limit".to_owned()),
        },
        CostItem {
            key: "cloudflare".to_owned(),
            provider: "cloudflare".to_owned(),
            resource: "edge".to_owned(),
            label: "Cloudflare (DNS, Workers, Pages)".to_owned(),
            unit: "requests".to_owned(),
            used: None,
            forecast_used: None,
            free: None,
            free_left: None,
            unit_price_usd: None,
            cost_usd: 0.0,
            forecast_usd: 0.0,
            note: Some(
                "Free plan; usage isn't read here (Workers: 100,000 requests a day)".to_owned(),
            ),
        },
    ]
}

/// The month without Cloud Run usage: free plans only, no totals.
fn unavailable(
    now: OffsetDateTime,
    prices: &CostPrices,
    error: Option<String>,
    plans: [CostItem; 2],
) -> CostInsights {
    let start = month_start(now);
    let next = month_start(start + time::Duration::days(32));
    let fraction = ((now - start).as_seconds_f64() / (next - start).as_seconds_f64())
        .clamp(f64::MIN_POSITIVE, 1.0);
    CostInsights {
        generated_at: rfc3339(now),
        period_start: rfc3339(start),
        period_end: rfc3339(now),
        elapsed_fraction: fraction,
        source: "unavailable".to_owned(),
        error,
        items: plans.into(),
        total_usd: None,
        forecast_usd: None,
        inr_per_usd: prices.inr_per_usd,
        gst_percent: prices.gst_percent,
        total_inr: None,
        total_gst_inr: None,
        forecast_inr: None,
        forecast_gst_inr: None,
        label: LABEL.to_owned(),
        billing_url: BILLING_URL.to_owned(),
    }
}

/// This month's estimated cost: Cloud Run's service and drain job after the free tier, month to
/// date and forecast, in USD and INR with GST apart; Supabase and Cloudflare free plans against
/// their limits.
#[utoipa::path(
    get,
    path = "/api/v1/console/insights/cost",
    operation_id = "getConsoleCostInsights",
    tag = "console",
    security(("bearer" = [])),
    responses((status = 200, body = CostInsights), (status = 403, description = "Not Sakalya staff"))
)]
pub(crate) async fn cost_insights(
    State(state): State<AppState>,
    _staff: PlatformRequest,
) -> Result<Json<CostInsights>, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    let insights = state.insights();
    let prices = insights.cost;
    let db = aarogyam_dal::console::db_health(state.db().pool()).await?;
    let plans = free_plans(db["size_bytes"].as_f64(), insights.db_limit_bytes);
    let Some(cloud) = &insights.cloud else {
        return Ok(Json(unavailable(now, &prices, None, plans)));
    };
    let usage = match cloud.month_usage(now).await {
        Ok(usage) => usage,
        Err(error) => {
            tracing::warn!(error = %error, "could not read Cloud Run usage");
            return Ok(Json(unavailable(
                now,
                &prices,
                Some(error.to_string()),
                plans,
            )));
        }
    };
    let estimate = cloud_cost::estimate(&usage, &prices);
    let mut items: Vec<CostItem> = estimate.lines.iter().map(CostItem::from).collect();
    items.extend(plans);
    Ok(Json(CostInsights {
        generated_at: rfc3339(now),
        period_start: rfc3339(usage.start),
        period_end: rfc3339(usage.end),
        elapsed_fraction: estimate.elapsed_fraction,
        source: "cloud_monitoring".to_owned(),
        error: None,
        items,
        total_usd: Some(estimate.total_usd),
        forecast_usd: Some(estimate.forecast_usd),
        inr_per_usd: prices.inr_per_usd,
        gst_percent: prices.gst_percent,
        total_inr: Some(estimate.total_inr),
        total_gst_inr: Some(estimate.total_gst_inr),
        forecast_inr: Some(estimate.forecast_inr),
        forecast_gst_inr: Some(estimate.forecast_gst_inr),
        label: LABEL.to_owned(),
        billing_url: BILLING_URL.to_owned(),
    }))
}

#[cfg(test)]
mod tests {
    use aarogyam_app::cloud_monitoring::{JobUsage, MonthUsage, ServiceUsage};
    use time::macros::datetime;

    use super::*;

    #[test]
    fn lines_show_what_is_left_of_the_free_tier() {
        let usage = MonthUsage {
            start: datetime!(2026-11-01 00:00 UTC),
            end: datetime!(2026-11-16 00:00 UTC),
            service: ServiceUsage {
                vcpu_seconds: 200_000.0,
                gib_seconds: 60_000.0,
                ..ServiceUsage::default()
            },
            job: JobUsage::default(),
        };
        let estimate = cloud_cost::estimate(&usage, &CostPrices::default());
        let items: Vec<CostItem> = estimate.lines.iter().map(CostItem::from).collect();
        let cpu = items.iter().find(|item| item.key == "service_cpu").unwrap();
        assert_eq!(cpu.free_left, Some(0.0));
        let memory = items
            .iter()
            .find(|item| item.key == "service_memory")
            .unwrap();
        assert_eq!(memory.free_left, Some(300_000.0));
        let runs = items.iter().find(|item| item.key == "job_runs").unwrap();
        assert_eq!(runs.free_left, None);
        assert!(runs.note.is_some());
    }

    #[test]
    fn without_cloud_run_only_the_free_plans_show() {
        let plans = free_plans(Some(100.0 * 1024.0 * 1024.0), 500 * 1024 * 1024);
        let answer = unavailable(
            datetime!(2026-11-16 00:00 UTC),
            &CostPrices::default(),
            None,
            plans,
        );
        assert_eq!(answer.source, "unavailable");
        assert_eq!(answer.total_usd, None);
        assert_eq!(answer.items.len(), 2);
        assert_eq!(answer.items[0].free_left, Some(400.0 * 1024.0 * 1024.0));
        assert!((answer.elapsed_fraction - 0.5).abs() < 1e-9);
        assert_eq!(answer.period_start, "2026-11-01T00:00:00Z");
    }
}
