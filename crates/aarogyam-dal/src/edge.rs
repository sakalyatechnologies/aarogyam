//! Portal addresses at the edge: the queue of portal hosts the outbox job makes work, kept on
//! `org_domains` (`db/migrations/0160_portal_addresses.sql`). The job acts for no one clinic, so
//! it claims and settles hosts through definer functions, as the outbox does.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// A portal or site host claimed for provisioning.
#[derive(Debug, Clone)]
pub struct ClaimedHost {
    /// Its clinic.
    pub org_id: Uuid,
    /// The `org_domains` row.
    pub domain_id: Uuid,
    /// The clinic's slug, as stored; parse it before use.
    pub slug: String,
    /// The host name, as stored.
    pub hostname: String,
    /// Attempts so far, this one included.
    pub attempts: i32,
    /// `portal` or `site`.
    pub kind: String,
    /// The host is to be removed (a site taken down), not made to work.
    pub removing: bool,
}

/// Claims up to `limit` due portal and site hosts across clinics for `lease_seconds`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn claim(
    pool: &PgPool,
    limit: i32,
    lease_seconds: i32,
) -> Result<Vec<ClaimedHost>, DbError> {
    let rows = sqlx::query_as!(
        ClaimedHost,
        r#"select org_id as "org_id!", domain_id as "domain_id!", slug as "slug!",
                  hostname as "hostname!", attempts as "attempts!",
                  kind as "kind!", removing as "removing!"
           from app.edge_hosts_work($1, $2)"#,
        limit,
        lease_seconds
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Records that the edge serves a claimed host.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_ready(pool: &PgPool, domain_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(r#"select app.edge_host_ready($1)"#, domain_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Forgets a taken-down site host whose Worker is gone.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_removed(pool: &PgPool, domain_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(r#"select app.edge_host_removed($1)"#, domain_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Records a failed attempt: retried at `retry_at`, or failed for good when it is `None`.
/// `error` is a short reason without secrets.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_failed(
    pool: &PgPool,
    domain_id: Uuid,
    error: &str,
    retry_at: Option<OffsetDateTime>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"select app.edge_host_failed($1, $2, $3)"#,
        domain_id,
        error,
        retry_at
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Queues every clinic's portal and site host again, or one clinic's (by slug); returns how many.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn requeue(pool: &PgPool, slug: Option<&str>) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(r#"select app.edge_hosts_requeue($1) as "count!""#, slug)
        .fetch_one(pool)
        .await?;
    Ok(count)
}
