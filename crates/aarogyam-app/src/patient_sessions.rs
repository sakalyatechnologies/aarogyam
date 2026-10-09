//! A patient's own app sessions: list where they are signed in and sign one out. A signed-out
//! session is refused on its next request (`app.patient_access` checks every request).

use aarogyam_dal::patient_sessions::{self as dal, SessionRow};
use aarogyam_domain::ids::{PatientAccountId, PatientSessionId};
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;

/// The account's live sessions, most recently used first; `current` is the asking session's
/// provider id.
///
/// # Errors
/// [`AppError::Db`] on a database failure.
pub async fn list(
    db: &Db,
    account: PatientAccountId,
    current: Uuid,
) -> Result<Vec<SessionRow>, AppError> {
    Ok(dal::list(db.pool(), account.uuid(), current).await?)
}

/// Signs out one of the account's sessions.
///
/// # Errors
/// [`AppError::NotFound`] when the session isn't the account's.
pub async fn revoke(
    db: &Db,
    account: PatientAccountId,
    session: PatientSessionId,
) -> Result<(), AppError> {
    dal::revoke(db.pool(), account.uuid(), session.uuid())
        .await?
        .map(|_| ())
        .ok_or(AppError::NotFound("session"))
}
