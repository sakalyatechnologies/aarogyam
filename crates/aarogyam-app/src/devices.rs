//! A person's own devices for push notifications: the staff app registers its install after
//! sign-in and removes it on sign-out. Before any clinic is known, like sessions: a device
//! belongs to the person, not to a clinic, and needs no clinic permission. Tokens are never
//! logged and never echoed in an error.

use aarogyam_dal::devices::{self as dal, NewDevice};
use aarogyam_domain::device::{
    APP_VERSION_MAX, DeviceApp, DevicePlatform, valid_locale, valid_token,
};
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;

/// What the app sends to register an install.
#[derive(Debug)]
pub struct Registration {
    /// The person (the token's subject).
    pub auth_uid: Uuid,
    /// The session making the request, if its token names one; a revoked session stops pushes
    /// to the devices it registered.
    pub provider_session: Option<Uuid>,
    /// When that session's token expires.
    pub session_expires_at: Option<OffsetDateTime>,
    /// The app's own id for this install, from the path.
    pub installation_id: Uuid,
    /// The phone's operating system.
    pub platform: DevicePlatform,
    /// The push provider's token for this install. Never logged.
    pub token: String,
    /// Which app this is.
    pub app: DeviceApp,
    /// The phone's language, such as `en-IN`.
    pub locale: String,
    /// The app's version.
    pub app_version: Option<String>,
}

/// Registers or refreshes the install, replacing its token. A token held by another person or
/// install moves here, since the phone changed hands.
///
/// # Errors
/// [`AppError::UnsupportedApp`] for the patient app (reserved); [`AppError::Invalid`] for a bad
/// token, locale or version; [`AppError::NotFound`] when the person has no active account;
/// [`AppError::Db`] on failures.
pub async fn register(db: &Db, registration: Registration) -> Result<(), AppError> {
    if !registration.app.supported() {
        return Err(AppError::UnsupportedApp);
    }
    if !valid_token(registration.platform, &registration.token) {
        return Err(AppError::invalid(
            "token",
            "is not a push token for this platform",
        ));
    }
    if !valid_locale(&registration.locale) {
        return Err(AppError::invalid("locale", "must look like en-IN"));
    }
    if registration
        .app_version
        .as_ref()
        .is_some_and(|version| version.chars().count() > APP_VERSION_MAX)
    {
        return Err(AppError::invalid("app_version", "is too long"));
    }
    let registered = dal::register(
        db.pool(),
        &NewDevice {
            auth_uid: registration.auth_uid,
            provider_session: registration.provider_session,
            session_expires_at: registration.session_expires_at,
            installation_id: registration.installation_id,
            platform: registration.platform.as_str(),
            token: &registration.token,
            app: registration.app.as_str(),
            locale: &registration.locale,
            app_version: registration.app_version.as_deref(),
        },
    )
    .await?;
    if registered {
        Ok(())
    } else {
        Err(AppError::NotFound("account"))
    }
}

/// Stops pushes to the person's own install (they signed out). Removing an install that isn't
/// theirs or isn't known changes nothing, so the answer never says which.
///
/// # Errors
/// [`AppError::Db`] on failures.
pub async fn remove(db: &Db, auth_uid: Uuid, installation_id: Uuid) -> Result<(), AppError> {
    Ok(dal::unregister(db.pool(), auth_uid, installation_id).await?)
}
