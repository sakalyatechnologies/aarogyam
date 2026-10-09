//! A patient account's own app sessions: where it is signed in, and signing one out. Before any
//! clinic is known, through definer functions (`db/migrations/0343_patient_sessions.sql`).

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// A session as listed.
#[derive(Debug, Clone)]
pub struct SessionRow {
    /// Identifier.
    pub id: Uuid,
    /// When it signed in.
    pub created_at: OffsetDateTime,
    /// When it was last used (to within five minutes).
    pub last_active_at: OffsetDateTime,
    /// When its sign-in expires.
    pub expires_at: OffsetDateTime,
    /// The session making the request.
    pub is_current: bool,
}

/// The account's live sessions, most recently used first (at most 50).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(pool: &PgPool, account: Uuid, current: Uuid) -> Result<Vec<SessionRow>, DbError> {
    let rows = sqlx::query_as!(
        SessionRow,
        r#"select id as "id!", created_at as "created_at!", last_active_at as "last_active_at!",
                  expires_at as "expires_at!", is_current as "is_current!"
           from app.patient_sessions($1, $2)"#,
        account,
        current
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Signs out one of the account's sessions; its provider session id, or `None` when it isn't
/// theirs.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn revoke(pool: &PgPool, account: Uuid, session: Uuid) -> Result<Option<Uuid>, DbError> {
    let row = sqlx::query_scalar!(
        r#"select provider_session_id as "id!" from app.revoke_patient_session($1, $2)"#,
        account,
        session
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
