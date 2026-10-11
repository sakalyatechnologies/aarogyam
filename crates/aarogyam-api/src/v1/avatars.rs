//! A staff member's own avatar: a preset id or a photo, set by the member themself and shown on
//! `/session`, `/me` and the staff list. Photos come through signed links on the clinic's host.

use aarogyam_app::avatars::{self as app, Choice};
use aarogyam_app::letterhead::ImageRefusal;
use aarogyam_domain::ids::{AttachmentId, ClinicId};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::files::{bad_form, form_error};
use super::rfc3339;
use crate::AppState;
use crate::extract::{ClinicHost, ClinicRequest};
use crate::failure::{ApiFailure, not_found};

/// A member's avatar: a preset the apps draw, or a photo to fetch.
#[derive(Debug, Serialize, ToSchema)]
pub struct Avatar {
    /// The preset id, such as `tooth_3`; the apps ship the pictures.
    pub preset: Option<String>,
    /// A signed path on the clinic's host for the photo (`GET /api/v1/avatars/{id}/content`).
    pub photo_url: Option<String>,
    /// When `photo_url` stops working (RFC 3339); load the list again for a new link.
    pub photo_expires_at: Option<String>,
}

impl From<app::Avatar> for Avatar {
    fn from(avatar: app::Avatar) -> Self {
        Self {
            preset: avatar.preset,
            photo_url: avatar
                .photo
                .as_ref()
                .map(|photo| format!("/api/v1/avatars/{}/content?token={}", photo.id, photo.token)),
            photo_expires_at: avatar.photo.map(|photo| rfc3339(photo.expires_at)),
        }
    }
}

/// The avatar of a membership with this stored preset and photo, with a fresh photo link.
pub(crate) fn of(
    state: &AppState,
    clinic: ClinicId,
    preset: Option<String>,
    file_id: Option<Uuid>,
) -> Option<Avatar> {
    app::view(
        state.files().ok(),
        clinic,
        preset,
        file_id,
        OffsetDateTime::now_utc(),
    )
    .map(Avatar::from)
}

/// Largest avatar upload body: the photo plus room for the form.
pub(crate) const MAX_UPLOAD_BODY: usize = aarogyam_domain::letterhead::MAX_IMAGE_BYTES + 64 * 1024;

/// The avatar form: exactly one of `file` and `preset`.
#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "documents the multipart form for OpenAPI")]
pub struct AvatarForm {
    /// A PNG or JPEG photo of at most 2 MB.
    #[schema(value_type = Option<String>, format = Binary)]
    file: Option<String>,
    /// A preset id: 1 to 32 lower-case letters, digits or underscores, starting with a letter.
    preset: Option<String>,
}

async fn read_choice(mut form: Multipart) -> Result<Choice, ApiFailure> {
    let (mut photo, mut preset) = (None, None);
    while let Some(field) = form.next_field().await.map_err(|e| form_error(&e))? {
        match field.name() {
            Some("file") => {
                photo = Some(field.bytes().await.map_err(|e| form_error(&e))?.to_vec());
            }
            Some("preset") => {
                preset = Some(field.text().await.map_err(|e| form_error(&e))?);
            }
            _ => {}
        }
    }
    match (photo, preset) {
        (Some(bytes), None) => Ok(Choice::Photo(bytes)),
        (None, Some(text)) => Ok(Choice::Preset(text)),
        _ => Err(bad_form("send exactly one of preset or file")),
    }
}

/// Sets the caller's own avatar for this clinic as `multipart/form-data` with either a `preset`
/// id or a `file` (PNG or JPEG, up to 2 MB, checked by content). Replaces the previous one. Any
/// member may do this; it changes only their own.
#[utoipa::path(
    put,
    path = "/api/v1/me/avatar",
    operation_id = "putMyAvatar",
    tag = "session",
    request_body(content = AvatarForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Avatar),
        (status = 400, description = "Not exactly one of preset and file, a bad preset, or not a PNG or JPEG"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it"),
        (status = 413, description = "Larger than 2 MB")
    )
)]
pub(crate) async fn put_avatar(
    State(state): State<AppState>,
    request: ClinicRequest,
    form: Result<Multipart, MultipartRejection>,
) -> Result<Json<Option<Avatar>>, ApiFailure> {
    let form = form.map_err(|_| bad_form("send the avatar as multipart/form-data"))?;
    let choice = read_choice(form).await?;
    let avatar = app::set(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        choice,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(avatar.map(Avatar::from)))
}

/// Removes the caller's avatar.
#[utoipa::path(
    delete,
    path = "/api/v1/me/avatar",
    operation_id = "deleteMyAvatar",
    tag = "session",
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed (also when there was none)"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn delete_avatar(
    State(state): State<AppState>,
    request: ClinicRequest,
) -> Result<StatusCode, ApiFailure> {
    app::clear(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The signed token from a photo link.
#[derive(Debug, Deserialize)]
pub struct PhotoQuery {
    #[serde(default)]
    pub token: String,
}

/// Streams an avatar photo through its signed link, which works on the clinic's own host for an
/// hour and is the proof of access (an `<img>` can use it).
#[utoipa::path(
    get,
    path = "/api/v1/avatars/{id}/content",
    operation_id = "getAvatarContent",
    tag = "public",
    params(
        ("id" = String, Path, description = "The photo"),
        ("token" = String, Query, description = "The signed token from the avatar's photo_url")
    ),
    responses(
        (status = 200, description = "The photo, with its media type"),
        (status = 403, description = "The link has expired; load the list again"),
        (status = 404, description = "Not a valid link for a photo of this clinic")
    )
)]
pub(crate) async fn photo_content(
    State(state): State<AppState>,
    host: ClinicHost,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<PhotoQuery>,
) -> Result<Response, ApiFailure> {
    let image = app::image(
        state.db(),
        state.files()?,
        host.clinic_id,
        host.request_id,
        AttachmentId::from_uuid(id),
        &query.token,
        OffsetDateTime::now_utc(),
    )
    .await
    .map_err(|refusal| match refusal {
        ImageRefusal::Expired => ApiFailure::Error(ApiError::forbidden(
            "link_expired",
            "This link has expired; load the list again.",
        )),
        ImageRefusal::NotFound => ApiFailure::Error(not_found()),
        ImageRefusal::Failed(error) => error.into(),
    })?;
    let mut response = image.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(image.mime_type),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=300"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    Ok(response)
}
