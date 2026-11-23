//! The App Store review clinic's daily refresh (`app.refresh_review_demo`, migration 0746): it
//! acts only on the synthetic `review` clinic and adds what is missing. Counts only.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::Date;
use uuid::Uuid;

/// What one refresh added.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Refreshed {
    /// The review clinic.
    pub org_id: Uuid,
    /// Patients added.
    pub patients: i32,
    /// Past visits added.
    pub visits: i32,
    /// Queue tokens added.
    pub tokens: i32,
    /// Appointments added.
    pub appointments: i32,
}

impl Refreshed {
    /// Whether anything was added.
    #[must_use]
    pub fn any(&self) -> bool {
        self.patients + self.visits + self.tokens + self.appointments > 0
    }
}

#[derive(sqlx::FromRow)]
struct Row {
    org: Option<Uuid>,
    patients: Option<i32>,
    visits: Option<i32>,
    tokens: Option<i32>,
    appointments: Option<i32>,
}

/// Tops up the review clinic for the clinic-local day `today`. `None` when there is no such
/// clinic (or it is not the synthetic one), or it cannot be refreshed yet.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn refresh(pool: &PgPool, today: Date) -> Result<Option<Refreshed>, DbError> {
    let row: Option<Row> = sqlx::query_as(
        "select (r->>'org_id')::uuid as org, (r->>'patients')::int as patients,
                (r->>'visits')::int as visits, (r->>'tokens')::int as tokens,
                (r->>'appointments')::int as appointments
         from app.refresh_review_demo($1) r",
    )
    .bind(today)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| {
        Some(Refreshed {
            org_id: r.org?,
            patients: r.patients?,
            visits: r.visits?,
            tokens: r.tokens?,
            appointments: r.appointments?,
        })
    }))
}
