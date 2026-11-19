//! Queries behind the console's Insights page: database history, clinic journeys, active staff
//! and the onboarding funnel. Each call is one `SECURITY DEFINER` function
//! (`db/migrations/0729_db_samples.sql` to `0731_onboarding_funnel.sql`) that returns counts,
//! timings and dates only, never a patient, a member or a record. The writers run in the outbox
//! drain job; the API checks the caller's platform role before calling the readers.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// Takes a database sample unless one was taken in the last 5 minutes, and deletes samples
/// older than 90 days. Returns whether it took one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_db_sample(pool: &PgPool) -> Result<bool, DbError> {
    let taken = sqlx::query_scalar!(r#"select app.record_db_sample() as "taken!""#)
        .fetch_one(pool)
        .await?;
    Ok(taken)
}

/// One point of the database history: a bucket of samples.
#[derive(Debug, Clone, PartialEq)]
pub struct DbSample {
    /// When the bucket starts.
    pub at: OffsetDateTime,
    /// The most connections seen.
    pub connections: i32,
    /// The connection limit.
    pub max_connections: i32,
    /// The latest cache hit ratio, 0 to 1.
    pub cache_hit_ratio: Option<f64>,
    /// The latest database size.
    pub db_bytes: i64,
    /// Committed transactions per minute; `None` for the first sample.
    pub commits_per_min: Option<f64>,
    /// Rolled back transactions per minute.
    pub rollbacks_per_min: Option<f64>,
    /// Rows read per minute.
    pub rows_read_per_min: Option<f64>,
    /// Rows inserted, updated or deleted per minute.
    pub rows_written_per_min: Option<f64>,
    /// Deadlocks in the bucket.
    pub deadlocks: i64,
    /// Bytes spilled to temporary files in the bucket.
    pub temp_bytes: i64,
}

/// Database samples since `since`, one point per `bucket_seconds`, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn db_history(
    pool: &PgPool,
    since: OffsetDateTime,
    bucket_seconds: i32,
) -> Result<Vec<DbSample>, DbError> {
    let rows = sqlx::query_as!(
        DbSample,
        r#"select at as "at!", connections as "connections!", max_connections as "max_connections!",
                  cache_hit_ratio::float8 as cache_hit_ratio, db_bytes as "db_bytes!",
                  commits_per_min::float8 as commits_per_min,
                  rollbacks_per_min::float8 as rollbacks_per_min,
                  rows_read_per_min::float8 as rows_read_per_min,
                  rows_written_per_min::float8 as rows_written_per_min,
                  deadlocks as "deadlocks!", temp_bytes as "temp_bytes!"
           from app.db_history($1, make_interval(secs => $2::int))"#,
        since,
        bucket_seconds
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A clinic whose journey row for its yesterday is missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JourneyDue {
    /// The clinic.
    pub org_id: Uuid,
    /// Its yesterday, in clinic time.
    pub day: Date,
}

/// Up to `limit` clinics with no journey row for their yesterday, oldest clinic first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn journey_days_due(pool: &PgPool, limit: i32) -> Result<Vec<JourneyDue>, DbError> {
    let rows = sqlx::query_as!(
        JourneyDue,
        r#"select org_id as "org_id!", day as "day!" from app.journey_days_due($1)"#,
        limit
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Writes the clinic's journey row and active-staff rows for `day` in one transaction. Returns
/// false when the row was already there.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_journey_day(pool: &PgPool, org_id: Uuid, day: Date) -> Result<bool, DbError> {
    let written = sqlx::query_scalar!(
        r#"select app.record_journey_day($1, $2) as "written!""#,
        org_id,
        day
    )
    .fetch_one(pool)
    .await?;
    Ok(written)
}

/// One clinic's day. Timings are minutes (lead time is days); `None` where fewer than 5 visits
/// made it.
#[derive(Debug, Clone, PartialEq)]
pub struct JourneyDay {
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// The day, in clinic time.
    pub day: Date,
    /// Visits started.
    pub visits: i32,
    /// Arrived to seated, median.
    pub arrive_to_seat_p50: Option<f64>,
    /// Arrived to seated, 90th percentile.
    pub arrive_to_seat_p90: Option<f64>,
    /// Seated to visit started, median.
    pub seat_to_start_p50: Option<f64>,
    /// Seated to visit started, 90th percentile.
    pub seat_to_start_p90: Option<f64>,
    /// Visit length, median.
    pub visit_minutes_p50: Option<f64>,
    /// Visit length, 90th percentile.
    pub visit_minutes_p90: Option<f64>,
    /// Visit ended to first payment, median.
    pub end_to_paid_p50: Option<f64>,
    /// Visit ended to first payment, 90th percentile.
    pub end_to_paid_p90: Option<f64>,
    /// Appointments that day, not cancelled or still requested.
    pub booked: i32,
    /// Appointments marked no-show.
    pub no_shows: i32,
    /// Days between booking and appointment, median.
    pub booking_lead_days_p50: Option<f64>,
    /// Members active that day, all roles together.
    pub active_staff: i32,
}

/// Every clinic's journey rows from `from` to `to` (included), by day then clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn journeys(pool: &PgPool, from: Date, to: Date) -> Result<Vec<JourneyDay>, DbError> {
    let rows = sqlx::query_as!(
        JourneyDay,
        r#"select org_id as "org_id!", slug as "slug!", name as "name!", day as "day!",
                  visits as "visits!",
                  arrive_to_seat_p50::float8 as arrive_to_seat_p50,
                  arrive_to_seat_p90::float8 as arrive_to_seat_p90,
                  seat_to_start_p50::float8 as seat_to_start_p50,
                  seat_to_start_p90::float8 as seat_to_start_p90,
                  visit_minutes_p50::float8 as visit_minutes_p50,
                  visit_minutes_p90::float8 as visit_minutes_p90,
                  end_to_paid_p50::float8 as end_to_paid_p50,
                  end_to_paid_p90::float8 as end_to_paid_p90,
                  booked as "booked!", no_shows as "no_shows!",
                  booking_lead_days_p50::float8 as booking_lead_days_p50,
                  active_staff as "active_staff!"
           from app.console_journeys($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Active members of one role across every clinic on one day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleDay {
    /// The day.
    pub day: Date,
    /// A standard role key, or `custom`.
    pub role_key: String,
    /// Members active, summed over clinics.
    pub members: i32,
    /// Clinics with at least one.
    pub clinics: i32,
}

/// Active staff by role across clinics from `from` to `to`, by day then role.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn active_roles(pool: &PgPool, from: Date, to: Date) -> Result<Vec<RoleDay>, DbError> {
    let rows = sqlx::query_as!(
        RoleDay,
        r#"select day as "day!", role_key as "role_key!", members as "members!",
                  clinics as "clinics!"
           from app.console_active_roles($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// One clinic's active members of one role on one day, only where there were 3 or more.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicRoleDay {
    /// The clinic.
    pub org_id: Uuid,
    /// The day.
    pub day: Date,
    /// A standard role key, or `custom`.
    pub role_key: String,
    /// Members active, 3 or more.
    pub members: i32,
}

/// Clinics' active staff by role from `from` to `to`, rows with 3 or more members only.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_roles(
    pool: &PgPool,
    from: Date,
    to: Date,
) -> Result<Vec<ClinicRoleDay>, DbError> {
    let rows = sqlx::query_as!(
        ClinicRoleDay,
        r#"select org_id as "org_id!", day as "day!", role_key as "role_key!",
                  members as "members!"
           from app.console_clinic_roles($1, $2)"#,
        from,
        to
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Where one clinic stands in onboarding: dates and a count, nothing else.
#[derive(Debug, Clone, PartialEq)]
pub struct OnboardingRow {
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// `trial`, `active`, `suspended` or `churned`.
    pub status: String,
    /// When it was created.
    pub created_at: OffsetDateTime,
    /// When its first owner joined.
    pub owner_joined_at: Option<OffsetDateTime>,
    /// Setup steps marked done.
    pub setup_steps_done: i32,
    /// When setup was completed.
    pub setup_completed_at: Option<OffsetDateTime>,
    /// The first patient added.
    pub first_patient_at: Option<OffsetDateTime>,
    /// The first visit started.
    pub first_visit_at: Option<OffsetDateTime>,
    /// The first bill issued.
    pub first_bill_at: Option<OffsetDateTime>,
    /// The Monday of the first week with 5 or more visits, in clinic time.
    pub first_busy_week: Option<Date>,
}

/// Every clinic's onboarding, newest clinic first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn onboarding(pool: &PgPool) -> Result<Vec<OnboardingRow>, DbError> {
    let rows = sqlx::query_as!(
        OnboardingRow,
        r#"select org_id as "org_id!", slug as "slug!", name as "name!", status as "status!",
                  created_at as "created_at!", owner_joined_at, setup_steps_done as "setup_steps_done!",
                  setup_completed_at, first_patient_at, first_visit_at, first_bill_at,
                  first_busy_week
           from app.console_onboarding()"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
