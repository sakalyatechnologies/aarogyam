//! The signed-in person's own devices for push notifications: the staff app registers its
//! install after sign-in and removes it on sign-out. Theirs, whatever the role, so no clinic
//! permission and no clinic host. The push token is never logged or echoed back.

use aarogyam_app::devices::{self as app, Registration};
use aarogyam_app::error::AppError;
use aarogyam_domain::device::{DeviceApp, DevicePlatform};
use aarogyam_domain::event::Event;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::Deserialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;
use crate::extract::SignedIn;
use crate::failure::ApiFailure;

/// An install of the app and where to push to it.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DeviceRegistration {
    /// `ios` or `android`; anything else is `400`.
    pub platform: String,
    /// The push provider's token for this install (APNs or FCM), 1 to 4096 characters.
    pub token: String,
    /// `staff`; `patient` is reserved (`422 unsupported_app`); anything else is `400`.
    pub app: String,
    /// The phone's language, such as `en-IN`.
    pub locale: String,
    /// The app's version, up to 40 characters.
    pub app_version: Option<String>,
}

/// Registers this install of the staff app for push notifications, or refreshes it (the token
/// changes now and then). It is an upsert by the person and `installation_id`, a UUID the app
/// makes once per install. A token already registered for another person or install moves to
/// this one, since the phone changed hands. A notification is pushed to the devices of the
/// members who see it in their feed, as IDs and kind codes only. Signing the session out
/// stops pushes to the devices it registered.
#[utoipa::path(
    put,
    path = "/api/v1/me/devices/{installation_id}",
    operation_id = "registerMyDevice",
    tag = "session",
    params(("installation_id" = String, Path, description = "The app's id for this install, a UUID")),
    request_body = DeviceRegistration,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Registered"),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 422, description = "The patient app can't register devices yet (`unsupported_app`)")
    )
)]
pub(crate) async fn register(
    State(state): State<AppState>,
    signed_in: SignedIn,
    ApiPath(installation_id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<DeviceRegistration>,
) -> Result<StatusCode, ApiFailure> {
    let claims = &signed_in.claims;
    app::register(
        state.db(),
        Registration {
            auth_uid: claims.subject().uuid(),
            provider_session: claims.session_id(),
            session_expires_at: OffsetDateTime::from_unix_timestamp(claims.expires_at()).ok(),
            installation_id,
            platform: DevicePlatform::parse(&body.platform)
                .ok_or_else(|| AppError::invalid("platform", "must be ios or android"))?,
            token: body.token,
            app: DeviceApp::parse(&body.app)
                .ok_or_else(|| AppError::invalid("app", "must be staff or patient"))?,
            locale: body.locale,
            app_version: body.app_version,
        },
    )
    .await?;
    tracing::info!(
        event = Event::DeviceRegistered.as_str(),
        installation_id = %installation_id,
        "device registered"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// Stops pushes to this install; the app calls it on sign-out. Removing an install that is
/// already removed, unknown, or someone else's is `204` and changes nothing: an install id is
/// only ever looked up among the caller's own.
#[utoipa::path(
    delete,
    path = "/api/v1/me/devices/{installation_id}",
    operation_id = "removeMyDevice",
    tag = "session",
    params(("installation_id" = String, Path, description = "The app's id for this install, a UUID")),
    security(("bearer" = [])),
    responses((status = 204, description = "Removed, or there was nothing to remove"), (status = 401, description = "Not signed in"))
)]
pub(crate) async fn remove(
    State(state): State<AppState>,
    signed_in: SignedIn,
    ApiPath(installation_id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::remove(
        state.db(),
        signed_in.claims.subject().uuid(),
        installation_id,
    )
    .await?;
    tracing::info!(
        event = Event::DeviceRemoved.as_str(),
        installation_id = %installation_id,
        "device removed"
    );
    Ok(StatusCode::NO_CONTENT)
}
