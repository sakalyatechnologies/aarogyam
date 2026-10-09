//! Records past retention, per class and clinic. Read-only: nothing here changes or deletes.
//!
//! These queries run over the schema owner's connection, across every clinic, like the outbox
//! worker; they are never reachable from a request. They return counts, the oldest anchor and
//! a few identifiers, never names or contact details.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// Records of one class in one clinic that are past retention.
#[derive(Debug, Clone)]
pub struct Group {
    /// The clinic; absent for records that belong to none (a clinic's request for access).
    pub org_id: Option<Uuid>,
    /// How many records.
    pub count: i64,
    /// The oldest anchor date among them.
    pub oldest: Option<OffsetDateTime>,
    /// The oldest few identifiers.
    pub sample: Vec<Uuid>,
}

/// Patients whose last activity is before `cutoff`, except children: a patient born after
/// `adult_born_on` (not yet 21) stays.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn patient_records(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    adult_born_on: Date,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"with last_activity as (
             select p.org_id, p.id,
                    greatest(p.created_at, p.last_visit_at,
                             (select max(a.starts_at) from aarogyam.appointments a
                              where a.org_id = p.org_id and a.patient_id = p.id),
                             (select max(i.issued_at) from aarogyam.invoices i
                              where i.org_id = p.org_id and i.patient_id = p.id)) as anchor
             from aarogyam.patients p
             where p.date_of_birth is null or p.date_of_birth <= $2)
           select org_id as "org_id?", count(*) as "count!", min(anchor) as "oldest?",
                  (array_agg(id order by anchor))[1:$3] as "sample!: Vec<Uuid>"
           from last_activity where anchor < $1
           group by org_id order by org_id"#,
        cutoff,
        adult_born_on,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Bills issued before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn invoices(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(issued_at) as "oldest?",
                  (array_agg(id order by issued_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.invoices where issued_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Messages sent or abandoned before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn outbox(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(processed_at) as "oldest?",
                  (array_agg(id order by processed_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.outbox_events where status <> 'pending' and processed_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Patient messages queued before `cutoff`, whatever their outcome.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn messages(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(created_at) as "oldest?",
                  (array_agg(id order by created_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.messages where created_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Patient links that expired before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn share_links(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(expires_at) as "oldest?",
                  (array_agg(id order by expires_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.share_links where expires_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Import uploads made before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn import_sessions(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(created_at) as "oldest?",
                  (array_agg(id order by created_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.import_sessions where created_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Access-record entries written before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn access_log(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(at) as "oldest?",
                  (array_agg(id order by at))[1:$2] as "sample!: Vec<Uuid>"
           from audit.access_log where at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Change-history entries written before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn audit_events(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(at) as "oldest?",
                  (array_agg(id order by at))[1:$2] as "sample!: Vec<Uuid>"
           from audit.audit_events where at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Requests for access, never approved, decided (or made) before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_applications(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select null::uuid as "org_id?", count(*) as "count!",
                  min(coalesce(decided_at, created_at)) as "oldest?",
                  (array_agg(id order by coalesce(decided_at, created_at)))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.clinic_applications
           where status <> 'approved' and coalesce(decided_at, created_at) < $1
           having count(*) > 0"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Lab orders recorded before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lab_work(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(created_at) as "oldest?",
                  (array_agg(id order by created_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.lab_orders where created_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Lab contacts removed before `cutoff`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lab_contacts(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(deleted_at) as "oldest?",
                  (array_agg(id order by deleted_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.lab_contacts where deleted_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Chat messages posted before `cutoff`, per clinic (the retention report; owner's pool).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn chat_messages(
    pool: &PgPool,
    cutoff: OffsetDateTime,
    sample: i32,
) -> Result<Vec<Group>, DbError> {
    let rows = sqlx::query_as!(
        Group,
        r#"select org_id as "org_id?", count(*) as "count!", min(created_at) as "oldest?",
                  (array_agg(id order by created_at))[1:$2] as "sample!: Vec<Uuid>"
           from aarogyam.chat_messages where created_at < $1
           group by org_id order by org_id"#,
        cutoff,
        sample
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
