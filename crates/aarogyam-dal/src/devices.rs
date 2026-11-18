//! Phones the staff app signs in from, and the push job's reads and writes on them (migration
//! 0714): `app.register_device`, `app.unregister_device`, `app.claim_staff_push`,
//! `app.push_devices`, `app.clear_device_token`. A person's own devices are written before any
//! clinic is known, so these are lookup functions like the session ones (`sessions.rs`). Push
//! tokens are secrets of a kind: no type here prints one.

use std::fmt;

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// One registration, as the staff app sends it.
#[derive(Debug, Clone, Copy)]
pub struct NewDevice<'a> {
    /// The person's sign-in (the token's subject).
    pub auth_uid: Uuid,
    /// The session making the request (the token's `session_id`), if it has one.
    pub provider_session: Option<Uuid>,
    /// When that session's token expires, for recording a session not seen before.
    pub session_expires_at: Option<OffsetDateTime>,
    /// The app's own id for this install.
    pub installation_id: Uuid,
    /// `ios` or `android`.
    pub platform: &'a str,
    /// The provider's push token, when the install has one yet. Never logged.
    pub token: Option<&'a str>,
    /// `staff` (or `patient`, reserved).
    pub app: &'a str,
    /// The device's language, such as `en-IN`.
    pub locale: &'a str,
    /// The app's version.
    pub app_version: Option<&'a str>,
}

/// Registers or refreshes the install's device; a token held by another user or install moves to
/// this one. `false` when the person has no active user record.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn register(pool: &PgPool, device: &NewDevice<'_>) -> Result<bool, DbError> {
    let registered = sqlx::query_scalar!(
        r#"select app.register_device($1, $2, $3, $4, $5, $6, $7, $8, $9) as "registered!""#,
        device.auth_uid,
        device.provider_session,
        device.session_expires_at,
        device.installation_id,
        device.platform,
        device.token,
        device.app,
        device.locale,
        device.app_version
    )
    .fetch_one(pool)
    .await?;
    Ok(registered)
}

/// Clears the push token of the person's own install. Nothing changes when it isn't theirs or
/// isn't known, so doing it twice is fine.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn unregister(
    pool: &PgPool,
    auth_uid: Uuid,
    installation_id: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        "select app.unregister_device($1, $2)",
        auth_uid,
        installation_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A staff notification the push job claimed.
#[derive(Debug, Clone)]
pub struct Claimed {
    /// Its clinic.
    pub org_id: Uuid,
    /// The notification.
    pub id: Uuid,
    /// `booking_requested`, `arrival`, `collect_payment`...
    pub kind: String,
    /// The portal path the feed shows for it.
    pub href: Option<String>,
    /// Whether it is recent enough to push (else it is only marked pushed).
    pub fresh: bool,
}

/// Claims staff notifications not pushed yet across clinics (newest first, at most `limit`) and
/// marks them pushed at `now`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn claim_push(
    pool: &PgPool,
    now: OffsetDateTime,
    limit: i32,
) -> Result<Vec<Claimed>, DbError> {
    let rows = sqlx::query_as!(
        Claimed,
        r#"select org_id as "org_id!", id as "id!", kind as "kind!", href,
                  fresh as "fresh!"
           from app.claim_staff_push($1, $2)"#,
        now,
        limit
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A staff-app device that can be pushed to.
#[derive(Clone)]
pub struct Device {
    /// The device row.
    pub id: Uuid,
    /// Whose it is.
    pub user_id: Uuid,
    /// `ios` or `android`.
    pub platform: String,
    /// The provider's push token.
    pub push_token: String,
}

impl fmt::Debug for Device {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Device")
            .field("id", &self.id)
            .field("user_id", &self.user_id)
            .field("platform", &self.platform)
            .finish_non_exhaustive()
    }
}

/// The staff-app devices of these users with a token, leaving out those registered by a session
/// that was revoked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn push_devices(pool: &PgPool, user_ids: &[Uuid]) -> Result<Vec<Device>, DbError> {
    let rows = sqlx::query_as!(
        Device,
        r#"select id as "id!", user_id as "user_id!", platform as "platform!",
                  push_token as "push_token!"
           from app.push_devices($1)"#,
        user_ids
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Forgets a token the provider said is dead, unless the device registered another since.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clear_token(pool: &PgPool, device_id: Uuid, token: &str) -> Result<(), DbError> {
    sqlx::query!("select app.clear_device_token($1, $2)", device_id, token)
        .execute(pool)
        .await?;
    Ok(())
}
