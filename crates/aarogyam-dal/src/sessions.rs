//! A person's own sign-in sessions, before any clinic is known (`app.my_sessions`,
//! `app.revoke_my_session`, `app.session_revoked` in `db/migrations/0016_my_sessions.sql`).

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// One of the person's active sessions.
#[derive(Debug, Clone)]
pub struct MySession {
    /// Identifier.
    pub id: Uuid,
    /// `clinic`, `patient` or `platform`.
    pub audience: String,
    /// When it was first seen.
    pub created_at: OffsetDateTime,
    /// When it was last used, to within a few minutes.
    pub last_active_at: OffsetDateTime,
    /// When its token expires.
    pub expires_at: OffsetDateTime,
    /// Whether this is the session asking.
    pub is_current: bool,
}

/// The active sessions of the person with `auth_uid`, most recently used first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mine(
    pool: &PgPool,
    auth_uid: Uuid,
    current_session: Uuid,
) -> Result<Vec<MySession>, DbError> {
    let rows = sqlx::query_as!(
        MySession,
        r#"select id as "id!", audience as "audience!", created_at as "created_at!",
                  last_active_at as "last_active_at!", expires_at as "expires_at!",
                  is_current as "is_current!"
           from app.my_sessions($1, $2)"#,
        auth_uid,
        current_session
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Revokes the person's session `session_id`. Returns its provider session id, or `None` when
/// it isn't theirs.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn revoke(
    pool: &PgPool,
    auth_uid: Uuid,
    session_id: Uuid,
) -> Result<Option<Uuid>, DbError> {
    let provider = sqlx::query_scalar!(
        r#"select provider_session_id as "provider_session_id!"
           from app.revoke_my_session($1, $2)"#,
        auth_uid,
        session_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(provider)
}

/// Whether the token's session was revoked (or is recorded for someone else).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn is_revoked(
    pool: &PgPool,
    auth_uid: Uuid,
    provider_session_id: Uuid,
) -> Result<bool, DbError> {
    let revoked = sqlx::query_scalar!(
        r#"select app.session_revoked($1, $2) as "revoked!""#,
        auth_uid,
        provider_session_id
    )
    .fetch_one(pool)
    .await?;
    Ok(revoked)
}
