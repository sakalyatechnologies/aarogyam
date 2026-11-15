//! A person's own sign-in sessions: listing where they are signed in, and signing one out.

use aarogyam_dal::sessions::{self as dal, MySession};
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;

/// The person's active sessions, most recently used first, with the asking one marked.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn mine(
    db: &Db,
    auth_uid: Uuid,
    current_session: Uuid,
) -> Result<Vec<MySession>, AppError> {
    Ok(dal::mine(db.pool(), auth_uid, current_session).await?)
}

/// Revokes one of the person's sessions; its next request is refused. Returns the provider
/// session id, so the caller can drop anything cached for it.
///
/// # Errors
/// [`AppError::NotFound`] when the session isn't the person's; [`AppError::Db`] on failures.
pub async fn revoke(db: &Db, auth_uid: Uuid, session_id: Uuid) -> Result<Uuid, AppError> {
    dal::revoke(db.pool(), auth_uid, session_id)
        .await?
        .ok_or(AppError::NotFound("session"))
}

/// Revokes every other session of the person, keeping the one asking. Returns the provider
/// session ids, so the caller can drop anything cached for them.
///
/// # Errors
/// [`AppError::Db`] on failures.
pub async fn revoke_others(
    db: &Db,
    auth_uid: Uuid,
    current_session: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    Ok(dal::revoke_others(db.pool(), auth_uid, current_session).await?)
}

/// Signs out the session of the token asking (the app's sign-out in one call): it is refused from
/// now on, and the push tokens of the devices it registered are cleared.
///
/// # Errors
/// [`AppError::NotFound`] when the person has no account; [`AppError::Db`] on failures.
pub async fn revoke_current(
    db: &Db,
    auth_uid: Uuid,
    provider_session: Uuid,
    expires_at: Option<OffsetDateTime>,
) -> Result<(), AppError> {
    if dal::revoke_current(db.pool(), auth_uid, provider_session, expires_at).await? {
        Ok(())
    } else {
        Err(AppError::NotFound("account"))
    }
}
