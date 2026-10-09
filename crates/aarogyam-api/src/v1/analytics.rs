//! The owner's Analytics page: chair utilization, income and expenses, and patients, by month
//! or week, in one request.

use aarogyam_app::analytics::{self as app, Period};
use aarogyam_domain::analytics::{AgeBand, Bucket, ReferralKind};
use aarogyam_domain::permission::require::AnalyticsView;
use aarogyam_domain::schedule::AppointmentKind;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiQuery;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_day};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// How the report groups days.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AnalyticsBucket {
    /// Calendar months.
    Month,
    /// Weeks starting on Monday.
    Week,
}

impl From<Bucket> for AnalyticsBucket {
    fn from(bucket: Bucket) -> Self {
        match bucket {
            Bucket::Month => Self::Month,
            Bucket::Week => Self::Week,
        }
    }
}

/// A chair in the report.
#[derive(Debug, Serialize, ToSchema)]
pub struct AnalyticsChair {
    /// The chair (a room of kind `chair`).
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its name.
    pub name: String,
    /// Whether its open minutes come from its branch's opening hours (`GET /clinic-hours`);
    /// otherwise `open_minutes_per_day` is assumed on every day.
    pub uses_clinic_hours: bool,
}

/// One chair's use in a period.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChairUtilization {
    /// The chair.
    #[schema(value_type = String)]
    pub room_id: Uuid,
    /// Minutes booked: appointments not cancelled and not unconfirmed online requests
    /// (no-shows count).
    pub booked_minutes: i64,
    /// Minutes open on the days of the period inside the range: from the chair's branch opening
    /// hours (closed days count zero), or `open_minutes_per_day` a day without them.
    pub open_minutes: i64,
    /// Appointments.
    pub appointments: i64,
    /// Booked over open, in basis points (10000 is fully booked; can be more).
    pub utilization_bps: i64,
}

/// Spent in one category in a period.
#[derive(Debug, Serialize, ToSchema)]
pub struct CategorySpend {
    /// `salary`, `material`, `electricity`, `lab`, `rent` or `other`.
    pub category: super::expenses::ExpenseCategory,
    /// Paise; for `material`, includes stock received at cost.
    pub amount_paise: i64,
}

/// New and returning patients in a period.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientMix {
    /// Patients whose first visit ever was in this period.
    pub new: i64,
    /// Patients seen who had visited before this period.
    pub returning: i64,
}

/// One month or week. Money fields are null without `finance.view`.
#[derive(Debug, Serialize, ToSchema)]
pub struct AnalyticsBucketRow {
    /// The period's first day (the 1st, or a Monday), `YYYY-MM-DD`.
    pub start: String,
    /// The first day counted: `start`, or the report's `from` if later.
    pub first_day: String,
    /// The last day counted: the period's end, or the report's `to` if earlier.
    pub last_day: String,
    /// Every chair in `chairs`, in that order.
    pub chair_utilization: Vec<ChairUtilization>,
    /// Payments received (not void), in paise.
    pub income_paise: Option<i64>,
    /// How many payments.
    pub payments: Option<i64>,
    /// Every category, zero when nothing was spent.
    pub expenses: Option<Vec<CategorySpend>>,
    /// All expenses, in paise.
    pub expenses_paise: Option<i64>,
    /// Stock received at cost, in paise; already inside `material`.
    pub stock_purchases_paise: Option<i64>,
    /// New and returning patients.
    pub patients: PatientMix,
}

/// A count under a key.
#[derive(Debug, Serialize, ToSchema)]
pub struct KeyCount {
    /// The key.
    pub key: String,
    /// How many.
    pub count: i64,
}

/// Who the patients in the range are.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientBreakdown {
    /// Patients seen, by age on the last day: `0_12`, `13_17`, `18_34`, `35_49`, `50_64`,
    /// `65_plus`, `unknown`. Every band listed.
    pub age_bands: Vec<KeyCount>,
    /// Visits by appointment kind: `new`, `follow_up`, `procedure`, `emergency`. Every kind
    /// listed.
    pub visit_kinds: Vec<KeyCount>,
    /// Patients whose first visit was in the range, by referral source kind: `patient`,
    /// `doctor`, `online`, `walk_in`, `camp`, `insurance`, `other`, `unknown` (none recorded).
    /// Every kind listed.
    pub referral_sources: Vec<KeyCount>,
}

/// Visits starting in an hour of a weekday.
#[derive(Debug, Serialize, ToSchema)]
pub struct BusyHour {
    /// ISO weekday: 1 Monday to 7 Sunday.
    pub weekday: u8,
    /// Hour of the day in clinic time, 0 to 23.
    pub hour: u8,
    /// Visits.
    pub visits: i64,
}

/// The Analytics report.
#[derive(Debug, Serialize, ToSchema)]
pub struct Analytics {
    /// First day, `YYYY-MM-DD`.
    pub from: String,
    /// Last day, included.
    pub to: String,
    /// Months or weeks.
    pub bucket: AnalyticsBucket,
    /// Minutes a chair is assumed open each day when its branch has no opening hours (540).
    pub open_minutes_per_day: i64,
    /// Whether the money fields are filled (the caller has `finance.view`).
    pub money_visible: bool,
    /// Chairs: the active ones, and any other with bookings in the range, by name.
    pub chairs: Vec<AnalyticsChair>,
    /// Every period in the range, oldest first.
    pub buckets: Vec<AnalyticsBucketRow>,
    /// Who the patients are.
    pub patients: PatientBreakdown,
    /// Visits by weekday and hour; only non-zero cells.
    pub busy_hours: Vec<BusyHour>,
    /// Lab work received back in the range.
    pub lab_turnaround: LabTurnaround,
}

/// How long labs take: orders received back in the range, and their average days from sent to
/// received.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabTurnaround {
    /// Orders received back.
    pub orders_received: i64,
    /// Average days at the lab, to one decimal; absent when none were received.
    pub average_days: Option<f64>,
}

/// The range and grouping of the report.
#[derive(Debug, Deserialize)]
pub struct AnalyticsParams {
    /// First clinic day.
    pub from: Option<String>,
    /// Last clinic day.
    pub to: Option<String>,
    /// `month` or `week`.
    pub bucket: Option<String>,
}

fn bucket_row(period: Period) -> AnalyticsBucketRow {
    let money = period.money;
    AnalyticsBucketRow {
        start: period.start.to_string(),
        first_day: period.first_day.to_string(),
        last_day: period.last_day.to_string(),
        chair_utilization: period
            .chairs
            .into_iter()
            .map(|chair| ChairUtilization {
                room_id: chair.room_id.uuid(),
                booked_minutes: chair.booked_minutes,
                open_minutes: chair.open_minutes,
                appointments: chair.appointments,
                utilization_bps: chair.utilization_bps,
            })
            .collect(),
        income_paise: money.as_ref().map(|m| m.income.get()),
        payments: money.as_ref().map(|m| m.payments),
        expenses: money.as_ref().map(|m| {
            m.expenses
                .iter()
                .map(|e| CategorySpend {
                    category: e.category.into(),
                    amount_paise: e.amount.get(),
                })
                .collect()
        }),
        expenses_paise: money.as_ref().map(|m| m.expenses_total.get()),
        stock_purchases_paise: money.as_ref().map(|m| m.stock_purchases.get()),
        patients: PatientMix {
            new: period.new_patients,
            returning: period.returning_patients,
        },
    }
}

fn counts<K>(rows: Vec<(K, i64)>, key: impl Fn(K) -> &'static str) -> Vec<KeyCount> {
    rows.into_iter()
        .map(|(k, count)| KeyCount {
            key: key(k).to_owned(),
            count,
        })
        .collect()
}

/// Chair utilization, income, expenses (stock received counts as material) and patients by
/// month or week. The last twelve months by default; at most 731 days. Money fields are null
/// unless the caller also has `finance.view`.
#[utoipa::path(
    get,
    path = "/api/v1/reports/analytics",
    operation_id = "getAnalyticsReport",
    tag = "reports",
    params(
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD (default: the 1st of the month eleven months before to)"),
        ("to" = Option<String>, Query, description = "Last clinic day, included (default: today)"),
        ("bucket" = Option<String>, Query, description = "month (default) or week")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Analytics),
        (status = 400, description = "A bad date, bucket, or a backwards or too long range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks analytics.view")
    )
)]
pub(crate) async fn analytics(
    State(state): State<AppState>,
    Require { request, .. }: Require<AnalyticsView>,
    ApiQuery(params): ApiQuery<AnalyticsParams>,
) -> Result<Json<Analytics>, ApiFailure> {
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
    let bucket = params
        .bucket
        .as_deref()
        .map(|t| Bucket::parse(t).map_err(|_| bad("bucket", "must be month or week")))
        .transpose()?;
    let report = app::report(
        state.db(),
        &request.actor,
        request.request_id,
        from,
        to,
        bucket,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(Analytics {
        from: report.from.to_string(),
        to: report.to.to_string(),
        bucket: report.bucket.into(),
        open_minutes_per_day: report.open_minutes_per_day,
        money_visible: report.money_visible,
        chairs: report
            .chairs
            .into_iter()
            .map(|chair| AnalyticsChair {
                id: chair.id.uuid(),
                uses_clinic_hours: chair.week.is_some(),
                name: chair.name,
            })
            .collect(),
        buckets: report.periods.into_iter().map(bucket_row).collect(),
        patients: PatientBreakdown {
            age_bands: counts(report.age_bands, AgeBand::as_str),
            visit_kinds: counts(report.visit_kinds, AppointmentKind::as_str),
            referral_sources: counts(report.referral_sources, ReferralKind::as_str),
        },
        busy_hours: report
            .busy_hours
            .into_iter()
            .map(|(weekday, hour, visits)| BusyHour {
                weekday,
                hour,
                visits,
            })
            .collect(),
        lab_turnaround: LabTurnaround {
            orders_received: report.lab_orders_received,
            average_days: report.lab_turnaround_days,
        },
    }))
}
