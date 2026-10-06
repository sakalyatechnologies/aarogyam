//! Session handoffs for central sign-in (`db/migrations/0161_auth_handoffs.sql`). Both happen
//! before any clinic is known, so they go through definer functions that check the host.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// What a handoff needs. Values are validated by the caller.
#[derive(Debug, Clone, Copy)]
pub struct NewHandoff<'a> {
    /// The signed-in person's Supabase id.
    pub auth_uid: Uuid,
    /// SHA-256 (hex) of the code; the code itself is never stored.
    pub code_hash: &'a str,
    /// Where it may be redeemed.
    pub host: &'a str,
    /// The console host, which needs Sakalya staff instead of a membership.
    pub console_host: &'a str,
    /// How long it is valid, at most 60 seconds.
    pub ttl_seconds: i32,
}

/// Stores a handoff if the person may go to the host; when it expires, or `None` if not.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn create(
    pool: &PgPool,
    new: &NewHandoff<'_>,
) -> Result<Option<OffsetDateTime>, DbError> {
    let expires = sqlx::query_scalar!(
        r#"select app.auth_handoff_create($1, $2, $3, $4, $5) as "expires_at""#,
        new.auth_uid,
        new.code_hash,
        new.host,
        new.console_host,
        new.ttl_seconds
    )
    .fetch_one(pool)
    .await?;
    Ok(expires)
}

/// The person a redeemed handoff signs in.
#[derive(Debug, Clone)]
pub struct Redeemed {
    /// Their Supabase id.
    pub auth_uid: Uuid,
    /// Their sign-in address.
    pub email: Option<String>,
}

/// Uses up the handoff with this code hash; the person only on the right host and in time.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn redeem(
    pool: &PgPool,
    code_hash: &str,
    host: &str,
) -> Result<Option<Redeemed>, DbError> {
    let row = sqlx::query_as!(
        Redeemed,
        r#"select auth_uid as "auth_uid!", email from app.auth_handoff_redeem($1, $2)"#,
        code_hash,
        host
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
