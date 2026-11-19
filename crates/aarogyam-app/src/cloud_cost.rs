//! The console's cost estimate (docs/plans/console-insights-design.md, Phase 3): what the Cloud
//! Run service and drain job used this month, times list prices, less the free tier.
//!
//! Plain arithmetic over [`MonthUsage`]; the numbers are an estimate shown to Sakalya staff, never
//! stored or billed, so they are `f64`. The free tier belongs to the billing account, which other
//! projects may share, so the real bill can be higher. No clinic concept: this moves to
//! `sakalya-backend` with [`crate::cloud_monitoring`].

use serde::Deserialize;

use crate::cloud_monitoring::{MonthUsage, month_start};

const BYTES_PER_GIB: f64 = 1_073_741_824.0;

/// List prices in USD and monthly free amounts, with separate entries for the service
/// (request-based billing: CPU and memory only while serving, plus a fee per request) and the job
/// (instance-based billing). Settings `[cost]`, `ARO_COST__*`.
///
/// The defaults are Cloud Run's published tier-1 prices (asia-south1 is tier 1) as known on
/// 19 Nov 2026; check <https://cloud.google.com/run/pricing> before relying on them.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CostPrices {
    /// Service, per vCPU second. Default $0.000024.
    pub service_vcpu_second_usd: f64,
    /// Service, per GiB second of memory. Default $0.0000025.
    pub service_gib_second_usd: f64,
    /// Service, per million requests. Default $0.40.
    pub service_million_requests_usd: f64,
    /// Service, free vCPU seconds a month. Default 180,000.
    pub service_free_vcpu_seconds: f64,
    /// Service, free GiB seconds a month. Default 360,000.
    pub service_free_gib_seconds: f64,
    /// Service, free requests a month. Default 2 million.
    pub service_free_requests: f64,
    /// Job, per vCPU second. Default $0.000018.
    pub job_vcpu_second_usd: f64,
    /// Job, per GiB second of memory. Default $0.000002.
    pub job_gib_second_usd: f64,
    /// Job, free vCPU seconds a month. Default 240,000.
    pub job_free_vcpu_seconds: f64,
    /// Job, free GiB seconds a month. Default 450,000.
    pub job_free_gib_seconds: f64,
    /// Internet egress from the region, per GiB (premium tier, first TiB). Default $0.12.
    pub egress_gib_usd: f64,
    /// Free egress a month. Default 0: Cloud Run's free GiB is for North America only.
    pub egress_free_gib: f64,
    /// Rupees per dollar for the INR figures. Default 88.
    pub inr_per_usd: f64,
    /// GST on the bill, shown separately. Default 18.
    pub gst_percent: f64,
}

impl Default for CostPrices {
    fn default() -> Self {
        Self {
            service_vcpu_second_usd: 0.000_024,
            service_gib_second_usd: 0.000_002_5,
            service_million_requests_usd: 0.40,
            service_free_vcpu_seconds: 180_000.0,
            service_free_gib_seconds: 360_000.0,
            service_free_requests: 2_000_000.0,
            job_vcpu_second_usd: 0.000_018,
            job_gib_second_usd: 0.000_002,
            job_free_vcpu_seconds: 240_000.0,
            job_free_gib_seconds: 450_000.0,
            egress_gib_usd: 0.12,
            egress_free_gib: 0.0,
            inr_per_usd: 88.0,
            gst_percent: 18.0,
        }
    }
}

/// Which Cloud Run resource a line is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resource {
    /// The API service.
    Service,
    /// The outbox drain job.
    Job,
}

impl Resource {
    /// `service` or `job`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Job => "job",
        }
    }
}

/// One line of the estimate. Lines without a price (billable time, job runs) are context only.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CostLine {
    /// A stable key, such as `service_cpu`.
    pub key: &'static str,
    /// The service or the job.
    pub resource: Resource,
    /// What it is, in plain words.
    pub label: &'static str,
    /// The unit of `used` and `free`: `vCPU-s`, `GiB-s`, `requests`, `GiB`, `s` or `runs`.
    pub unit: &'static str,
    /// Used this month so far.
    pub used: f64,
    /// Used by the end of the month at the same pace.
    pub forecast_used: f64,
    /// The monthly free amount; `None` when the line has no price.
    pub free: Option<f64>,
    /// USD per unit beyond the free amount; `None` when not billed on its own.
    pub unit_price_usd: Option<f64>,
    /// USD so far, after the free amount.
    pub cost_usd: f64,
    /// USD for the month at the same pace, after the free amount.
    pub forecast_usd: f64,
}

/// The estimate for the month so far and the whole month.
#[derive(Debug, Clone, PartialEq)]
pub struct Estimate {
    /// Share of the month (UTC) that has passed, above 0 and at most 1.
    pub elapsed_fraction: f64,
    /// Billed and context lines, the service's first.
    pub lines: Vec<CostLine>,
    /// USD so far.
    pub total_usd: f64,
    /// USD for the month: usage extended linearly, then priced after the free tier.
    pub forecast_usd: f64,
    /// `total_usd` in rupees, before GST.
    pub total_inr: f64,
    /// GST on `total_inr`.
    pub total_gst_inr: f64,
    /// `forecast_usd` in rupees, before GST.
    pub forecast_inr: f64,
    /// GST on `forecast_inr`.
    pub forecast_gst_inr: f64,
}

/// Share of `usage`'s month that has passed by its end, at least one minute's worth.
fn elapsed_fraction(usage: &MonthUsage) -> f64 {
    let next = month_start(usage.start + time::Duration::days(32));
    let month = (next - usage.start).as_seconds_f64();
    let elapsed = (usage.end - usage.start).as_seconds_f64().max(60.0);
    (elapsed / month).clamp(f64::MIN_POSITIVE, 1.0)
}

/// Prices `usage` with `prices`.
#[must_use]
pub fn estimate(usage: &MonthUsage, prices: &CostPrices) -> Estimate {
    let fraction = elapsed_fraction(usage);
    let lines: Vec<CostLine> = rows(usage, prices)
        .into_iter()
        .map(|(key, resource, label, unit, used, billed)| {
            let forecast_used = used / fraction;
            let over =
                |amount: f64| billed.map_or(0.0, |(free, price)| (amount - free).max(0.0) * price);
            CostLine {
                key,
                resource,
                label,
                unit,
                used,
                forecast_used,
                free: billed.map(|(free, _)| free),
                unit_price_usd: billed.map(|(_, price)| price),
                cost_usd: over(used),
                forecast_usd: over(forecast_used),
            }
        })
        .collect();
    let total_usd: f64 = lines.iter().map(|line| line.cost_usd).sum();
    let forecast_usd: f64 = lines.iter().map(|line| line.forecast_usd).sum();
    let inr = |usd: f64| usd * prices.inr_per_usd;
    let gst = |inr: f64| inr * prices.gst_percent / 100.0;
    Estimate {
        elapsed_fraction: fraction,
        lines,
        total_usd,
        forecast_usd,
        total_inr: inr(total_usd),
        total_gst_inr: gst(inr(total_usd)),
        forecast_inr: inr(forecast_usd),
        forecast_gst_inr: gst(inr(forecast_usd)),
    }
}

/// The lines before pricing, the service's first.
fn rows(usage: &MonthUsage, p: &CostPrices) -> [Row; 9] {
    let (service, job) = (&usage.service, &usage.job);
    [
        (
            "service_cpu",
            Resource::Service,
            "API vCPU time",
            "vCPU-s",
            service.vcpu_seconds,
            Some((p.service_free_vcpu_seconds, p.service_vcpu_second_usd)),
        ),
        (
            "service_memory",
            Resource::Service,
            "API memory time",
            "GiB-s",
            service.gib_seconds,
            Some((p.service_free_gib_seconds, p.service_gib_second_usd)),
        ),
        (
            "service_requests",
            Resource::Service,
            "API requests",
            "requests",
            service.requests,
            Some((
                p.service_free_requests,
                p.service_million_requests_usd / 1_000_000.0,
            )),
        ),
        (
            "service_egress",
            Resource::Service,
            "API data sent",
            "GiB",
            service.sent_bytes / BYTES_PER_GIB,
            Some((p.egress_free_gib, p.egress_gib_usd)),
        ),
        (
            "service_billable",
            Resource::Service,
            "API billable instance time",
            "s",
            service.billable_seconds,
            None,
        ),
        (
            "job_cpu",
            Resource::Job,
            "Drain job vCPU time",
            "vCPU-s",
            job.vcpu_seconds,
            Some((p.job_free_vcpu_seconds, p.job_vcpu_second_usd)),
        ),
        (
            "job_memory",
            Resource::Job,
            "Drain job memory time",
            "GiB-s",
            job.gib_seconds,
            Some((p.job_free_gib_seconds, p.job_gib_second_usd)),
        ),
        (
            "job_billable",
            Resource::Job,
            "Drain job billable time",
            "s",
            job.billable_seconds,
            None,
        ),
        (
            "job_runs",
            Resource::Job,
            "Drain job runs",
            "runs",
            job.executions,
            None,
        ),
    ]
}

/// One line before pricing: key, resource, label, unit, used, and (free, USD per unit) if billed.
type Row = (
    &'static str,
    Resource,
    &'static str,
    &'static str,
    f64,
    Option<(f64, f64)>,
);

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;
    use crate::cloud_monitoring::{JobUsage, ServiceUsage};

    /// Half of November gone (15 of 30 days).
    fn usage(service: ServiceUsage, job: JobUsage) -> MonthUsage {
        MonthUsage {
            start: datetime!(2026-11-01 00:00 UTC),
            end: datetime!(2026-11-16 00:00 UTC),
            service,
            job,
        }
    }

    fn line<'a>(estimate: &'a Estimate, key: &str) -> &'a CostLine {
        estimate
            .lines
            .iter()
            .find(|line| line.key == key)
            .unwrap_or_else(|| panic!("{key}"))
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn usage_inside_the_free_tier_costs_nothing() {
        let estimate = estimate(
            &usage(
                ServiceUsage {
                    vcpu_seconds: 50_000.0,
                    gib_seconds: 25_000.0,
                    requests: 300_000.0,
                    ..ServiceUsage::default()
                },
                JobUsage {
                    vcpu_seconds: 20_000.0,
                    executions: 10_800.0,
                    ..JobUsage::default()
                },
            ),
            &CostPrices::default(),
        );
        assert!(close(estimate.elapsed_fraction, 0.5));
        assert!(close(estimate.total_usd, 0.0));
        assert!(close(estimate.forecast_usd, 0.0));
        let cpu = line(&estimate, "service_cpu");
        assert!(close(cpu.forecast_used, 100_000.0));
        assert_eq!(cpu.free, Some(180_000.0));
        assert_eq!(line(&estimate, "job_runs").unit_price_usd, None);
        assert!(close(line(&estimate, "job_runs").forecast_used, 21_600.0));
    }

    #[test]
    fn the_service_and_the_job_have_their_own_prices_and_free_tiers() {
        let estimate = estimate(
            &usage(
                ServiceUsage {
                    vcpu_seconds: 200_000.0,
                    requests: 3_000_000.0,
                    sent_bytes: 2.0 * BYTES_PER_GIB,
                    ..ServiceUsage::default()
                },
                JobUsage {
                    vcpu_seconds: 200_000.0,
                    ..JobUsage::default()
                },
            ),
            &CostPrices::default(),
        );
        // Service: 20,000 vCPU-s over 180,000 at $0.000024.
        assert!(close(line(&estimate, "service_cpu").cost_usd, 0.48));
        // 1 million requests over 2 million at $0.40 a million.
        assert!(close(line(&estimate, "service_requests").cost_usd, 0.40));
        // No free egress in asia-south1: 2 GiB at $0.12.
        assert!(close(line(&estimate, "service_egress").cost_usd, 0.24));
        // Job: still inside its own 240,000 vCPU-s.
        assert!(close(line(&estimate, "job_cpu").cost_usd, 0.0));
        // At the same pace the job ends at 400,000: 160,000 over at $0.000018.
        assert!(close(line(&estimate, "job_cpu").forecast_usd, 2.88));
        assert!(close(estimate.total_usd, 1.12));
    }

    #[test]
    fn rupees_and_gst_follow_the_configured_rate() {
        let prices = CostPrices {
            inr_per_usd: 80.0,
            ..CostPrices::default()
        };
        let estimate = estimate(
            &usage(
                ServiceUsage {
                    vcpu_seconds: 180_000.0 + 1_000_000.0 / 24.0,
                    ..ServiceUsage::default()
                },
                JobUsage::default(),
            ),
            &prices,
        );
        assert!(close(estimate.total_usd, 1.0));
        assert!(close(estimate.total_inr, 80.0));
        assert!(close(estimate.total_gst_inr, 14.4));
        assert!(estimate.forecast_inr > estimate.total_inr);
        assert!(close(
            estimate.forecast_gst_inr,
            estimate.forecast_inr * 0.18
        ));
    }

    #[test]
    fn the_first_minutes_of_a_month_do_not_divide_by_zero() {
        let mut early = usage(ServiceUsage::default(), JobUsage::default());
        early.end = early.start;
        let estimate = estimate(&early, &CostPrices::default());
        assert!(estimate.elapsed_fraction > 0.0);
        assert!(estimate.forecast_usd.is_finite());
    }
}
