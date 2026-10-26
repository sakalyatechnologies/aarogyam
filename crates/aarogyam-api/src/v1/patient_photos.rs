//! A patient's own photo: set, read and remove. Patient data, so it is read through the API
//! with `patients.read` and never through a signed link.

use aarogyam_app::patient_photos as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiPath, ErrorKind};
use utoipa::ToSchema;
use uuid::Uuid;

use super::files::{bad_form, form_error};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Largest photo upload body: the photo plus room for the form.
pub(crate) const MAX_UPLOAD_BODY: usize = super::avatars::MAX_UPLOAD_BODY;

/// The photo form.
#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "documents the multipart form for OpenAPI")]
pub struct PhotoForm {
    /// A PNG or JPEG photo of at most 2 MB, checked by content.
    #[schema(value_type = String, format = Binary)]
    file: String,
}

fn too_large() -> ApiFailure {
    ApiFailure::Error(ApiError::new(
        ErrorKind::PayloadTooLarge,
        "too_large",
        "file: must be at most 2 MB",
    ))
}

async fn read_photo(mut form: Multipart) -> Result<Vec<u8>, ApiFailure> {
    let mut photo = None;
    while let Some(field) = form.next_field().await.map_err(|e| form_error(&e))? {
        if field.name() == Some("file") {
            let bytes = field.bytes().await.map_err(|e| {
                if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
                    too_large()
                } else {
                    form_error(&e)
                }
            })?;
            photo = Some(bytes.to_vec());
        }
    }
    photo.ok_or_else(|| bad_form("send the photo as the file field"))
}

/// Sets the patient's photo as `multipart/form-data` with a `file` (PNG or JPEG, up to 2 MB,
/// checked by content), replacing the old one. Needs `patients.write`.
#[utoipa::path(
    put,
    path = "/api/v1/patients/{id}/photo",
    operation_id = "putPatientPhoto",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body(content = PhotoForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Saved"),
        (status = 400, description = "Not a PNG or JPEG, or no file"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach"),
        (status = 413, description = "Larger than 2 MB")
    )
)]
pub(crate) async fn put(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<StatusCode, ApiFailure> {
    let form = form.map_err(|_| bad_form("send the photo as multipart/form-data"))?;
    let bytes = read_photo(form).await?;
    app::put(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        bytes,
    )
    .await?;
    tracing::info!(event = Event::PatientPhotoChanged.as_str(), patient_id = %id, "patient photo set");
    Ok(StatusCode::NO_CONTENT)
}

/// The patient's photo, with its media type. Needs `patients.read`; the response is private to
/// the caller's browser.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/photo",
    operation_id = "getPatientPhoto",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, description = "The photo, with its media type"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read, or Sakalya support"),
        (status = 404, description = "No photo, no such patient in this clinic, or out of the role's reach")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiFailure> {
    let photo = app::get(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    let mut response = photo.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(photo.mime_type),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
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

/// Removes the patient's photo (removing none is fine). Needs `patients.write`.
#[utoipa::path(
    delete,
    path = "/api/v1/patients/{id}/photo",
    operation_id = "deletePatientPhoto",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed (also when there was none)"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach")
    )
)]
pub(crate) async fn delete(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    tracing::info!(event = Event::PatientPhotoChanged.as_str(), patient_id = %id, "patient photo removed");
    Ok(StatusCode::NO_CONTENT)
}
