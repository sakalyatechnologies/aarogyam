//! Sakalya's console: clinics and service health. Console host only, Sakalya staff only.

use std::time::SystemTime;

use aarogyam_app::cloud_monitoring::Window;
use aarogyam_app::console::{self as app, CreateClinic};
use aarogyam_app::insights;
use aarogyam_domain::edge::AddressStatus;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::PlatformRequest;
use crate::failure::ApiFailure;
use crate::metrics::Range;

/// A clinic, with counts only.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsoleClinic {
    /// The clinic.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// `dental` or `general`.
    pub specialty: String,
    /// `trial`, `active`, `suspended` or `churned`.
    pub status: String,
    /// When it was created (RFC 3339).
    pub created_at: String,
    /// The portal host name.
    pub portal_host: Option<String>,
    /// Whether the edge serves the portal host yet: `pending`, `ready` or `failed`.
    #[schema(value_type = Option<String>)]
    pub address_status: Option<&'static str>,
    /// Members with an active membership.
    pub active_members: i64,
    /// Patients, excluding deleted records.
    pub patients: i64,
}

/// The stored address status as the API sends it; unknown values are left out.
pub(crate) fn address_status(stored: Option<&str>) -> Option<&'static str> {
    stored
        .and_then(|text| AddressStatus::parse(text).ok())
        .map(AddressStatus::as_str)
}

/// Every clinic.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsoleClinics {
    /// Newest first.
    pub items: Vec<ConsoleClinic>,
}

/// Lists every clinic with member and patient counts.
#[utoipa::path(
    get,
    path = "/api/v1/console/clinics",
    operation_id = "listClinics",
    tag = "console",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ConsoleClinics),
        (status = 403, description = "Not Sakalya staff"),
        (status = 404, description = "Not the console host")
    )
)]
pub(crate) async fn clinics(
    State(state): State<AppState>,
    _staff: PlatformRequest,
) -> Result<Json<ConsoleClinics>, ApiFailure> {
    let rows = app::clinics(state.db()).await?;
    Ok(Json(ConsoleClinics {
        items: rows
            .into_iter()
            .map(|row| ConsoleClinic {
                id: row.id,
                slug: row.slug,
                name: row.name,
                specialty: row.specialty,
                status: row.status,
                created_at: rfc3339(row.created_at),
                portal_host: row.portal_host,
                address_status: address_status(row.address_status.as_deref()),
                active_members: row.active_members,
                patients: row.patients,
            })
            .collect(),
    }))
}

/// A clinic to create.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewClinic {
    /// The clinic's name.
    pub name: String,
    /// The subdomain; derived from the name when absent.
    pub slug: Option<String>,
    /// `dental` (default) or `general`.
    pub specialty: Option<String>,
    /// The owner's email; they are invited as the clinic owner.
    pub owner_email: String,
}

/// A clinic just created. `invite_token` is shown once; only its hash is stored.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreatedClinic {
    /// The clinic.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its portal host name. Its address starts `pending`; the outbox job makes it work
    /// within a couple of minutes (see `address_status` on the clinic).
    pub portal_host: String,
    /// The owner's invitation.
    #[schema(value_type = String)]
    pub invitation_id: Uuid,
    /// The invitation secret, for the link sent to the owner.
    pub invite_token: String,
    /// When the invitation expires (RFC 3339).
    pub invite_expires_at: String,
}

/// Creates a clinic and invites its owner: the invitation is emailed and its secret returned once
/// for the console to show. Owner and onboarding staff only.
#[utoipa::path(
    post,
    path = "/api/v1/console/clinics",
    operation_id = "createClinic",
    tag = "console",
    request_body = NewClinic,
    security(("bearer" = [])),
    responses(
        (status = 201, body = CreatedClinic),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 403, description = "Not allowed to create clinics"),
        (status = 409, description = "The subdomain is taken"),
        (status = 503, description = "Supabase could not create the owner's sign-in account")
    )
)]
pub(crate) async fn create_clinic(
    State(state): State<AppState>,
    request: PlatformRequest,
    ApiJson(body): ApiJson<NewClinic>,
) -> Result<(StatusCode, Json<CreatedClinic>), ApiFailure> {
    if !request
        .staff
        .role
        .is_some_and(aarogyam_domain::access::PlatformRole::can_create_clinics)
    {
        return Err(
            ApiError::forbidden("forbidden", "Your console role can't create clinics.").into(),
        );
    }
    let created = app::create_clinic(
        state.db(),
        &request.staff,
        state.accounts(),
        CreateClinic {
            name: body.name,
            slug: body.slug,
            specialty: body.specialty.unwrap_or_else(|| "dental".to_owned()),
            owner_email: body.owner_email,
        },
        &state.hosts().portal_host_template,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(CreatedClinic {
            id: created.id,
            slug: created.slug,
            portal_host: created.portal_host,
            invitation_id: created.invitation_id,
            invite_token: created.invite_token,
            invite_expires_at: rfc3339(created.invite_expires_at),
        }),
    ))
}

/// What to check: a typed address, or the one derived from the clinic's name.
#[derive(Debug, Deserialize)]
pub struct SlugParams {
    /// The clinic's name.
    pub name: String,
    /// The typed subdomain; derived from the name when absent.
    pub slug: Option<String>,
    /// The clinic's city, for a `<name>-<city>` suggestion.
    pub city: Option<String>,
}

/// Whether an address is free, with free alternatives when it isn't.
#[derive(Debug, Serialize, ToSchema)]
pub struct SlugCheck {
    /// The subdomain checked.
    pub slug: String,
    /// Its portal host.
    pub portal_host: String,
    /// Free to use now (creating the clinic still checks).
    pub available: bool,
    /// Why it can't be used, when malformed or reserved.
    pub problem: Option<String>,
    /// Free alternatives, best first.
    pub suggestions: Vec<String>,
}

/// Checks a clinic address as it is typed, suggesting free ones (`<name>-<city>`, or a short
/// suffix) when it is taken. Sakalya staff only.
#[utoipa::path(
    get,
    path = "/api/v1/console/slugs",
    operation_id = "checkSlug",
    tag = "console",
    params(
        ("name" = String, Query, description = "The clinic's name"),
        ("slug" = Option<String>, Query, description = "The typed subdomain"),
        ("city" = Option<String>, Query, description = "The clinic's city")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = SlugCheck),
        (status = 403, description = "Not Sakalya staff"),
        (status = 404, description = "Not the console host")
    )
)]
pub(crate) async fn check_slug(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<SlugParams>,
) -> Result<Json<SlugCheck>, ApiFailure> {
    let checked = app::check_slug(
        state.db(),
        &params.name,
        params.slug.as_deref(),
        params.city.as_deref(),
    )
    .await?;
    Ok(Json(SlugCheck {
        portal_host: state
            .hosts()
            .portal_host_template
            .replace("{slug}", &checked.slug),
        slug: checked.slug,
        available: checked.available,
        problem: checked.problem,
        suggestions: checked.suggestions,
    }))
}

/// Which window of service metrics to show.
#[derive(Debug, Deserialize)]
pub struct MetricsParams {
    /// `1h` (default), `6h`, `24h`, `7d` or `30d`.
    pub range: Option<String>,
}

const RANGE_PROBLEM: &str = "range: must be 1h, 6h, 24h, 7d or 30d";

fn parse_range(range: Option<&str>) -> Result<Range, ApiError> {
    range
        .unwrap_or("1h")
        .parse()
        .map_err(|_| ApiError::bad_request("invalid_request", RANGE_PROBLEM))
}

/// Service health for the console dashboard.
#[derive(Debug, Serialize, ToSchema)]
pub struct ServiceMetrics {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The window: `1h`, `6h`, `24h`, `7d` or `30d`.
    pub range: String,
    /// This instance's API requests, error rates and latency.
    #[schema(value_type = Option<Object>)]
    pub api: Option<serde_json::Value>,
    /// Database connections, cache hit ratio, size, tables and slow statements.
    #[schema(value_type = Object)]
    pub db: serde_json::Value,
    /// Edge and front-end numbers from Cloudflare; `null` until connected.
    #[schema(value_type = Option<Object>)]
    pub edge: Option<serde_json::Value>,
    /// Where the service charts come from: `cloud_monitoring` (Cloud Run, every instance, in
    /// `cloud`) or `instance` (only the instance that answered, since it started, in `api`).
    pub source: String,
    /// Cloud Run's numbers from Cloud Monitoring: `interval_seconds`, `service` (requests by
    /// class, latency percentiles, instances, cold starts, CPU and memory) and `job` (drain
    /// executions, billable, CPU and memory time). `null` when `source` is `instance`.
    #[schema(value_type = Option<Object>)]
    pub cloud: Option<serde_json::Value>,
    /// Why Cloud Monitoring could not be read, such as `Cloud Monitoring: 403`; `null` when it was
    /// read or is not set up.
    pub cloud_error: Option<String>,
}

/// Service health: API, database and edge.
#[utoipa::path(
    get,
    path = "/api/v1/console/metrics",
    operation_id = "getConsoleMetrics",
    tag = "console",
    params(("range" = Option<String>, Query, description = "1h (default), 6h, 24h, 7d or 30d")),
    security(("bearer" = [])),
    responses((status = 200, body = ServiceMetrics), (status = 403, description = "Not Sakalya staff"))
)]
pub(crate) async fn metrics(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<MetricsParams>,
) -> Result<Json<ServiceMetrics>, ApiFailure> {
    let range = parse_range(params.range.as_deref())?;
    let db = aarogyam_dal::console::db_health(state.db().pool()).await?;
    let api = serde_json::to_value(state.metrics().snapshot(range, SystemTime::now()))
        .map_err(ApiError::internal)?;
    let (source, cloud, cloud_error) = cloud_metrics(&state, range).await;
    Ok(Json(ServiceMetrics {
        generated_at: rfc3339(OffsetDateTime::now_utc()),
        range: range.as_str().to_owned(),
        api: Some(api),
        db,
        edge: None,
        source: source.to_owned(),
        cloud,
        cloud_error,
    }))
}

/// The Cloud Monitoring window for `range`: its length and one point per minute (`1h`), five
/// minutes (`6h`), fifteen minutes (`24h`), hour (`7d`) or six hours (`30d`).
const fn cloud_window(range: Range) -> Window {
    let (seconds, step_seconds) = match range {
        Range::LastHour => (3_600, 60),
        Range::LastSixHours => (21_600, 300),
        Range::LastDay => (86_400, 900),
        Range::LastWeek => (604_800, 3_600),
        Range::LastMonth => (2_592_000, 21_600),
    };
    Window {
        key: range.as_str(),
        seconds,
        step_seconds,
    }
}

/// Cloud Run's metrics when Cloud Monitoring is set up and answers; otherwise the instance's own.
async fn cloud_metrics(
    state: &AppState,
    range: Range,
) -> (&'static str, Option<serde_json::Value>, Option<String>) {
    let Some(cloud) = &state.insights().cloud else {
        return ("instance", None, None);
    };
    match cloud
        .snapshot(cloud_window(range), OffsetDateTime::now_utc())
        .await
    {
        Ok(snapshot) => match serde_json::to_value(&*snapshot) {
            Ok(value) => ("cloud_monitoring", Some(value), None),
            Err(error) => ("instance", None, Some(error.to_string())),
        },
        Err(error) => {
            tracing::warn!(error = %error, "could not read Cloud Monitoring");
            ("instance", None, Some(error.to_string()))
        }
    }
}

/// The database over a window: one point per bucket of the drain job's samples.
#[derive(Debug, Serialize, ToSchema)]
pub struct DbInsights {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The window: `1h`, `6h`, `24h`, `7d` or `30d`.
    pub range: String,
    /// Seconds per point: 300 (`1h`, `6h`), 900 (`24h`), 7200 (`7d`) or 21 600 (`30d`).
    pub interval_seconds: i32,
    /// The database plan's size limit in bytes, drawn on the size chart.
    pub size_limit_bytes: u64,
    /// Connections, cache hit ratio, size, the biggest tables and the slowest statements now
    /// (as `db` in `/console/metrics`).
    #[schema(value_type = Object)]
    pub current: serde_json::Value,
    /// Oldest first; empty until the drain job has taken samples (at most one every 5 minutes).
    pub samples: Vec<DbSamplePoint>,
}

/// One point of the database history.
#[derive(Debug, Serialize, ToSchema)]
pub struct DbSamplePoint {
    /// When the interval starts (RFC 3339).
    pub at: String,
    /// The most connections in use.
    pub connections: i32,
    /// The connection limit.
    pub max_connections: i32,
    /// Share of reads served from memory, 0 to 1.
    pub cache_hit_ratio: Option<f64>,
    /// Database size in bytes.
    pub db_bytes: i64,
    /// Committed transactions per minute.
    pub commits_per_min: Option<f64>,
    /// Rolled back transactions per minute.
    pub rollbacks_per_min: Option<f64>,
    /// Rows read per minute.
    pub rows_read_per_min: Option<f64>,
    /// Rows inserted, updated or deleted per minute.
    pub rows_written_per_min: Option<f64>,
    /// Deadlocks in the interval.
    pub deadlocks: i64,
    /// Bytes spilled to temporary files in the interval.
    pub temp_bytes: i64,
}

/// The database over time: connections, size, cache, transactions, rows, deadlocks and spills.
#[utoipa::path(
    get,
    path = "/api/v1/console/insights/db",
    operation_id = "getConsoleDbInsights",
    tag = "console",
    params(("range" = Option<String>, Query, description = "1h (default), 6h, 24h, 7d or 30d")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = DbInsights),
        (status = 400, description = "Unknown range"),
        (status = 403, description = "Not Sakalya staff")
    )
)]
pub(crate) async fn db_insights(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<MetricsParams>,
) -> Result<Json<DbInsights>, ApiFailure> {
    let range = parse_range(params.range.as_deref())?;
    let (window, bucket) = match range {
        Range::LastHour => (3_600, 300),
        Range::LastSixHours => (21_600, 300),
        Range::LastDay => (86_400, 900),
        Range::LastWeek => (604_800, 7_200),
        Range::LastMonth => (2_592_000, 21_600),
    };
    let now = OffsetDateTime::now_utc();
    let since = now - time::Duration::seconds(window);
    let current = aarogyam_dal::console::db_health(state.db().pool()).await?;
    let samples = insights::db_history(state.db(), since, bucket).await?;
    Ok(Json(DbInsights {
        generated_at: rfc3339(now),
        range: range.as_str().to_owned(),
        interval_seconds: bucket,
        size_limit_bytes: state.insights().db_limit_bytes,
        current,
        samples: samples
            .into_iter()
            .map(|sample| DbSamplePoint {
                at: rfc3339(sample.at),
                connections: sample.connections,
                max_connections: sample.max_connections,
                cache_hit_ratio: sample.cache_hit_ratio,
                db_bytes: sample.db_bytes,
                commits_per_min: sample.commits_per_min,
                rollbacks_per_min: sample.rollbacks_per_min,
                rows_read_per_min: sample.rows_read_per_min,
                rows_written_per_min: sample.rows_written_per_min,
                deadlocks: sample.deadlocks,
                temp_bytes: sample.temp_bytes,
            })
            .collect(),
    }))
}

/// How clinics are used over a window: daily totals, each clinic, active staff by role and the
/// onboarding funnel. Counts, timings and dates only.
#[derive(Debug, Serialize, ToSchema)]
pub struct UsageInsights {
    /// When this was produced (RFC 3339).
    pub generated_at: String,
    /// The window: `1h`, `6h`, `24h`, `7d` or `30d`. Usage is daily, so the first three show
    /// yesterday.
    pub range: String,
    /// First day (`YYYY-MM-DD`), each clinic's own calendar.
    pub from: String,
    /// Last day, included.
    pub to: String,
    /// All clinics together per day, oldest first.
    pub days: Vec<UsageDay>,
    /// Each clinic over the window, busiest first.
    pub clinics: Vec<ClinicUsage>,
    /// People signed in by role across all clinics, per day.
    pub roles: Vec<RoleUsage>,
    /// Each clinic's onboarding, newest clinic first.
    pub onboarding: Vec<OnboardingClinic>,
}

/// Typical timings: the visit-weighted mean of daily medians. `null` where every day had fewer
/// than 5 visits.
#[derive(Debug, Serialize, ToSchema)]
pub struct JourneyTimings {
    /// Arrived to seated, minutes.
    pub arrive_to_seat_minutes: Option<f64>,
    /// Seated to visit started, minutes.
    pub seat_to_start_minutes: Option<f64>,
    /// Visit length, minutes.
    pub visit_minutes: Option<f64>,
    /// Visit ended to first payment, minutes.
    pub end_to_paid_minutes: Option<f64>,
    /// Days between booking and appointment.
    pub booking_lead_days: Option<f64>,
}

impl From<insights::Timings> for JourneyTimings {
    fn from(timings: insights::Timings) -> Self {
        Self {
            arrive_to_seat_minutes: timings.arrive_to_seat_p50,
            seat_to_start_minutes: timings.seat_to_start_p50,
            visit_minutes: timings.visit_minutes_p50,
            end_to_paid_minutes: timings.end_to_paid_p50,
            booking_lead_days: timings.booking_lead_days_p50,
        }
    }
}

/// All clinics together on one day.
#[derive(Debug, Serialize, ToSchema)]
pub struct UsageDay {
    /// The day (`YYYY-MM-DD`).
    pub day: String,
    /// Clinics with a row that day.
    pub clinics: i32,
    /// Visits started.
    pub visits: i64,
    /// Appointments for the day, not cancelled or still requested.
    pub booked: i64,
    /// No-shows.
    pub no_shows: i64,
    /// People signed in (any clinic, web or phone), summed over clinics.
    pub active_staff: i64,
    /// Typical timings across clinics.
    pub timings: JourneyTimings,
}

/// People signed in in one role.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoleCount {
    /// A standard role key (`owner`, `doctor`, `front_desk` ...) or `custom`.
    pub role_key: String,
    /// People, 3 or more (smaller numbers are not shown per clinic).
    pub members: i32,
}

/// One clinic over the window.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicUsage {
    /// The clinic.
    #[schema(value_type = String)]
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// Days recorded.
    pub days: i32,
    /// Visits started.
    pub visits: i64,
    /// Appointments booked.
    pub booked: i64,
    /// No-shows.
    pub no_shows: i64,
    /// People signed in on the latest day, all roles together.
    pub active_staff: i32,
    /// Typical timings.
    pub timings: JourneyTimings,
    /// People signed in by role on the latest day, only roles with 3 or more.
    pub roles: Vec<RoleCount>,
}

/// People signed in in one role across all clinics on one day.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoleUsage {
    /// The day (`YYYY-MM-DD`).
    pub day: String,
    /// A standard role key or `custom`.
    pub role_key: String,
    /// People, summed over clinics (a person in two clinics counts in each).
    pub members: i32,
    /// Clinics with at least one.
    pub clinics: i32,
}

/// Where one clinic stands in onboarding. Times are RFC 3339; `null` means not yet.
#[derive(Debug, Serialize, ToSchema)]
pub struct OnboardingClinic {
    /// The clinic.
    #[schema(value_type = String)]
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// `trial`, `active`, `suspended` or `churned`.
    pub status: String,
    /// Created.
    pub created_at: String,
    /// The first owner joined.
    pub owner_joined_at: Option<String>,
    /// Setup steps marked done.
    pub setup_steps_done: i32,
    /// Setup completed.
    pub setup_completed_at: Option<String>,
    /// The first patient added.
    pub first_patient_at: Option<String>,
    /// The first visit started.
    pub first_visit_at: Option<String>,
    /// The first bill issued.
    pub first_bill_at: Option<String>,
    /// The Monday (`YYYY-MM-DD`) of the first week with 5 or more visits.
    pub first_busy_week: Option<String>,
}

/// How clinics are used: visits, timings, people signed in by role and onboarding.
#[utoipa::path(
    get,
    path = "/api/v1/console/insights/usage",
    operation_id = "getConsoleUsageInsights",
    tag = "console",
    params(("range" = Option<String>, Query, description = "1h (default), 6h, 24h, 7d or 30d; the first three show yesterday")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = UsageInsights),
        (status = 400, description = "Unknown range"),
        (status = 403, description = "Not Sakalya staff")
    )
)]
pub(crate) async fn usage_insights(
    State(state): State<AppState>,
    _staff: PlatformRequest,
    ApiQuery(params): ApiQuery<MetricsParams>,
) -> Result<Json<UsageInsights>, ApiFailure> {
    let range = parse_range(params.range.as_deref())?;
    let days = match range {
        Range::LastHour | Range::LastSixHours | Range::LastDay => 1,
        Range::LastWeek => 7,
        Range::LastMonth => 30,
    };
    let now = OffsetDateTime::now_utc();
    let to = now.date();
    let from = to - time::Duration::days(days);
    let usage = insights::usage(state.db(), from, to).await?;
    let optional = |at: Option<OffsetDateTime>| at.map(rfc3339);
    Ok(Json(UsageInsights {
        generated_at: rfc3339(now),
        range: range.as_str().to_owned(),
        from: usage.from.to_string(),
        to: usage.to.to_string(),
        days: usage
            .days
            .into_iter()
            .map(|day| UsageDay {
                day: day.day.to_string(),
                clinics: day.clinics,
                visits: day.visits,
                booked: day.booked,
                no_shows: day.no_shows,
                active_staff: day.active_staff,
                timings: day.timings.into(),
            })
            .collect(),
        clinics: usage
            .clinics
            .into_iter()
            .map(|clinic| ClinicUsage {
                org_id: clinic.org_id,
                slug: clinic.slug,
                name: clinic.name,
                days: clinic.days,
                visits: clinic.visits,
                booked: clinic.booked,
                no_shows: clinic.no_shows,
                active_staff: clinic.active_staff,
                timings: clinic.timings.into(),
                roles: clinic
                    .roles
                    .into_iter()
                    .map(|(role_key, members)| RoleCount { role_key, members })
                    .collect(),
            })
            .collect(),
        roles: usage
            .roles
            .into_iter()
            .map(|role| RoleUsage {
                day: role.day.to_string(),
                role_key: role.role_key,
                members: role.members,
                clinics: role.clinics,
            })
            .collect(),
        onboarding: usage
            .onboarding
            .into_iter()
            .map(|row| OnboardingClinic {
                org_id: row.org_id,
                slug: row.slug,
                name: row.name,
                status: row.status,
                created_at: rfc3339(row.created_at),
                owner_joined_at: optional(row.owner_joined_at),
                setup_steps_done: row.setup_steps_done,
                setup_completed_at: optional(row.setup_completed_at),
                first_patient_at: optional(row.first_patient_at),
                first_visit_at: optional(row.first_visit_at),
                first_bill_at: optional(row.first_bill_at),
                first_busy_week: row.first_busy_week.map(|week| week.to_string()),
            })
            .collect(),
    }))
}
