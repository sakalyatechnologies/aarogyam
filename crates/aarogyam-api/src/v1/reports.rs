//! Money reports: collections, revenue mix, unpaid bills, and Today's money widgets.

use aarogyam_app::reports::{self as app, MixTotal, PendingBill};
use aarogyam_domain::billing::AgingBucket;
use aarogyam_domain::permission::require::FinanceView;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiQuery;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::PatientRef;
use super::{parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Money received on a day, or in a week starting that Monday.
#[derive(Debug, Serialize, ToSchema)]
pub struct DayTotal {
    /// `YYYY-MM-DD`.
    pub date: String,
    /// Paise.
    pub amount_paise: i64,
    /// Payments.
    pub payments: i64,
}

impl From<app::DayTotal> for DayTotal {
    fn from(total: app::DayTotal) -> Self {
        Self {
            date: total.date.to_string(),
            amount_paise: total.amount.get(),
            payments: total.payments,
        }
    }
}

/// Money received by one method.
#[derive(Debug, Serialize, ToSchema)]
pub struct MethodTotal {
    /// `cash`, `upi`, `card` or `bank`.
    pub method: String,
    /// Paise.
    pub amount_paise: i64,
    /// Payments.
    pub payments: i64,
    /// Share of everything received, in basis points (10000 is all).
    pub share_bps: i64,
}

/// Billed revenue in one price list category.
#[derive(Debug, Serialize, ToSchema)]
pub struct MixItem {
    /// The category, or `other` for free-text lines.
    pub category: String,
    /// Paise, including GST.
    pub amount_paise: i64,
    /// Share of all billed, in basis points.
    pub share_bps: i64,
}

impl From<MixTotal> for MixItem {
    fn from(total: MixTotal) -> Self {
        Self {
            category: total.category,
            amount_paise: total.amount.get(),
            share_bps: total.share_bps,
        }
    }
}

/// Collections over clinic days `from` to `to`.
#[derive(Debug, Serialize, ToSchema)]
pub struct Collections {
    /// First day.
    pub from: String,
    /// Last day, included.
    pub to: String,
    /// Everything received, in paise.
    pub collected_paise: i64,
    /// Payments.
    pub payments: i64,
    /// Every day, zero when nothing came in.
    pub by_day: Vec<DayTotal>,
    /// Weeks starting Monday, for the weekly collections chart.
    pub by_week: Vec<DayTotal>,
    /// Every method, for the UPI share.
    pub by_method: Vec<MethodTotal>,
    /// Bills issued in the range by category, for the revenue mix.
    pub revenue_mix: Vec<MixItem>,
    /// Total of bills issued in the range.
    pub invoiced_paise: i64,
    /// Bills issued in the range.
    pub invoices: i64,
    /// Left to pay on every issued bill, now.
    pub outstanding_paise: i64,
}

/// The range of a collections report.
#[derive(Debug, Deserialize)]
pub struct RangeParams {
    /// First clinic day.
    pub from: Option<String>,
    /// Last clinic day.
    pub to: Option<String>,
}

/// Collections by day, week and method, and the revenue mix. The last seven days by default;
/// at most 366 days.
#[utoipa::path(
    get,
    path = "/api/v1/reports/collections",
    tag = "reports",
    params(
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD (default: six days before to)"),
        ("to" = Option<String>, Query, description = "Last clinic day, included (default: today)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Collections),
        (status = 400, description = "A bad or too long range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view")
    )
)]
pub(crate) async fn collections(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiQuery(params): ApiQuery<RangeParams>,
) -> Result<Json<Collections>, ApiFailure> {
    let from = params
        .from
        .as_deref()
        .map(|t| parse_day("from", t))
        .transpose()?;
    let to = params
        .to
        .as_deref()
        .map(|t| parse_day("to", t))
        .transpose()?;
    let report = app::collections(
        state.db(),
        &request.actor,
        request.request_id,
        from,
        to,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(Collections {
        from: report.from.to_string(),
        to: report.to.to_string(),
        collected_paise: report.collected.get(),
        payments: report.payments,
        by_day: report.by_day.into_iter().map(DayTotal::from).collect(),
        by_week: report.by_week.into_iter().map(DayTotal::from).collect(),
        by_method: report
            .by_method
            .into_iter()
            .map(|m| MethodTotal {
                method: m.method.as_str().to_owned(),
                amount_paise: m.amount.get(),
                payments: m.payments,
                share_bps: m.share_bps,
            })
            .collect(),
        revenue_mix: report.revenue_mix.into_iter().map(MixItem::from).collect(),
        invoiced_paise: report.invoiced.get(),
        invoices: report.invoices,
        outstanding_paise: report.outstanding.get(),
    }))
}

/// An issued bill with something left to pay.
#[derive(Debug, Serialize, ToSchema)]
pub struct PendingItem {
    /// The bill.
    #[schema(value_type = String)]
    pub invoice_id: Uuid,
    /// Its number.
    pub number: Option<String>,
    /// The patient.
    pub patient: PatientRef,
    /// When issued.
    pub issued_at: Option<String>,
    /// Total, in paise.
    pub total_paise: i64,
    /// Paid.
    pub paid_paise: i64,
    /// Left to pay.
    pub balance_paise: i64,
    /// Clinic days since issue.
    pub age_days: i64,
    /// `0_30`, `31_60`, `61_90` or `90_plus`.
    pub bucket: String,
}

impl From<PendingBill> for PendingItem {
    fn from(bill: PendingBill) -> Self {
        Self {
            invoice_id: bill.invoice_id.uuid(),
            number: bill.number,
            patient: bill.patient.into(),
            issued_at: bill.issued_at.map(rfc3339),
            total_paise: bill.total.get(),
            paid_paise: bill.paid.get(),
            balance_paise: bill.balance.get(),
            age_days: bill.age_days,
            bucket: match bill.bucket {
                AgingBucket::Days0To30 => "0_30",
                AgingBucket::Days31To60 => "31_60",
                AgingBucket::Days61To90 => "61_90",
                AgingBucket::Over90 => "90_plus",
            }
            .to_owned(),
        }
    }
}

/// Owed by age of the bill.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgingBuckets {
    /// Bills up to 30 days old.
    #[serde(rename = "0_30")]
    pub days_0_30: i64,
    /// 31 to 60 days.
    #[serde(rename = "31_60")]
    pub days_31_60: i64,
    /// 61 to 90 days.
    #[serde(rename = "61_90")]
    pub days_61_90: i64,
    /// Over 90 days.
    #[serde(rename = "90_plus")]
    pub over_90: i64,
}

/// Unpaid bills.
#[derive(Debug, Serialize, ToSchema)]
pub struct PendingReport {
    /// Oldest first.
    pub items: Vec<PendingItem>,
    /// Left to pay on all of them, in paise.
    pub outstanding_paise: i64,
    /// Patients who owe.
    pub patients: usize,
    /// Owed by age.
    pub buckets: AgingBuckets,
}

/// Issued bills with a balance, oldest first, with aging buckets.
#[utoipa::path(
    get,
    path = "/api/v1/reports/pending",
    tag = "reports",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PendingReport),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view")
    )
)]
pub(crate) async fn pending(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
) -> Result<Json<PendingReport>, ApiFailure> {
    let report = app::pending(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    let [a, b, c, d] = report.buckets;
    Ok(Json(PendingReport {
        items: report.bills.into_iter().map(PendingItem::from).collect(),
        outstanding_paise: report.outstanding.get(),
        patients: report.patients,
        buckets: AgingBuckets {
            days_0_30: a.get(),
            days_31_60: b.get(),
            days_61_90: c.get(),
            over_90: d.get(),
        },
    }))
}

/// The Today screen's money widgets.
#[derive(Debug, Serialize, ToSchema)]
pub struct TodayMoney {
    /// The clinic day.
    pub date: String,
    /// Received today, in paise (the revenue tile).
    pub collected_paise: i64,
    /// Payments today.
    pub payments_today: i64,
    /// Billed today.
    pub invoiced_paise: i64,
    /// Bills issued today.
    pub invoices_today: i64,
    /// Received this month so far.
    pub collected_this_month_paise: i64,
    /// UPI's share of this month's collections, in basis points.
    pub upi_share_bps: i64,
    /// Left to pay on every issued bill (the pending dues tile).
    pub pending_dues_paise: i64,
    /// Patients who owe.
    pub pending_dues_patients: usize,
    /// This month's revenue mix, for the donut.
    pub revenue_mix: Vec<MixItem>,
    /// The five largest balances, for the pending payments table.
    pub pending: Vec<PendingItem>,
}

/// Money for the Today screen: today's collections, pending dues, this month's revenue mix
/// and the largest unpaid balances.
#[utoipa::path(
    get,
    path = "/api/v1/today/money",
    tag = "reports",
    security(("bearer" = [])),
    responses(
        (status = 200, body = TodayMoney),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view")
    )
)]
pub(crate) async fn today_money(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
) -> Result<Json<TodayMoney>, ApiFailure> {
    let money = app::today(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(TodayMoney {
        date: money.date.to_string(),
        collected_paise: money.collected_today.get(),
        payments_today: money.payments_today,
        invoiced_paise: money.invoiced_today.get(),
        invoices_today: money.invoices_today,
        collected_this_month_paise: money.collected_this_month.get(),
        upi_share_bps: money.upi_share_bps,
        pending_dues_paise: money.pending_dues.get(),
        pending_dues_patients: money.pending_dues_patients,
        revenue_mix: money.revenue_mix.into_iter().map(MixItem::from).collect(),
        pending: money
            .top_pending
            .into_iter()
            .map(PendingItem::from)
            .collect(),
    }))
}
