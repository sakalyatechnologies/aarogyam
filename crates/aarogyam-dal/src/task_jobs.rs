//! Cross-clinic job steps for tasks (migration 0662): making each day's occurrences and the
//! standard tasks of new clinics. Both are definer functions run on the pool, since the job acts
//! for no one clinic; the reminder, escalation and missed-sweep step is migration 0663.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// Makes every occurrence that fell due in the 24 hours up to `now`, for active templates at
/// clinics in use whose assignee can still act, and writes each one's first `task_due` notice
/// (`app.materialize_task_occurrences`). Safe to run twice at once. Returns how many were made.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn materialize(pool: &PgPool, now: OffsetDateTime, limit: i32) -> Result<i32, DbError> {
    let made = sqlx::query_scalar!(
        r#"select app.materialize_task_occurrences($1, $2) as "made!""#,
        now,
        limit
    )
    .fetch_one(pool)
    .await?;
    Ok(made)
}

/// Adds the standard tasks that clinics in use are missing, `limit` clinics at a time
/// (`app.seed_missing_default_tasks`). A standard task switched off is never added back.
/// Returns how many tasks were added.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn seed_missing_defaults(pool: &PgPool, limit: i32) -> Result<i32, DbError> {
    let added = sqlx::query_scalar!(
        r#"select app.seed_missing_default_tasks($1) as "added!""#,
        limit
    )
    .fetch_one(pool)
    .await?;
    Ok(added)
}

/// Adds the standard tasks one clinic is missing (`app.seed_default_tasks`). Returns how many.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn seed_defaults(pool: &PgPool, org_id: Uuid) -> Result<i32, DbError> {
    let added = sqlx::query_scalar!(r#"select app.seed_default_tasks($1) as "added!""#, org_id)
        .fetch_one(pool)
        .await?;
    Ok(added)
}

/// What one run of [`run_reminders`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReminderCounts {
    /// Reminders sent.
    pub reminded: i32,
    /// Tasks escalated to the owners.
    pub escalated: i32,
    /// Open tasks marked missed.
    pub missed: i32,
}

/// Marks overdue tasks missed, sends the reminders that fell due and escalates the tasks that
/// have used up their reminders (`app.run_task_reminders`), at most `limit` tasks per step. Each
/// reminder is taken with a conditional update, so overlapping runs send it once.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn run_reminders(
    pool: &PgPool,
    now: OffsetDateTime,
    limit: i32,
) -> Result<ReminderCounts, DbError> {
    let (reminded, escalated, missed): (i32, i32, i32) =
        sqlx::query_as("select reminded, escalated, missed from app.run_task_reminders($1, $2)")
            .bind(now)
            .bind(limit)
            .fetch_one(pool)
            .await?;
    Ok(ReminderCounts {
        reminded,
        escalated,
        missed,
    })
}
