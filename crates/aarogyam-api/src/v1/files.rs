//! Patient files: upload (multipart), list, and download through a five-minute signed link.

use aarogyam_app::files::{self as app, AttachmentView, DownloadRefusal, Upload};
use aarogyam_domain::event::Event;
use aarogyam_domain::files::MAX_BYTES;
use aarogyam_domain::ids::{AttachmentId, EncounterId, PatientId};
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartError, MultipartRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiPath, ApiQuery, ErrorKind};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{client_id, rfc3339};
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::{ApiFailure, not_found};

/// Largest upload body: the file plus room for the other form fields.
pub(crate) const MAX_UPLOAD_BODY: usize = MAX_BYTES + 64 * 1024;

/// A patient file's details. The bytes come from its download link.
#[derive(Debug, Serialize, ToSchema)]
pub struct Attachment {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The visit it belongs to.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// `photo`, `xray`, `report`, `document`, `audio` or `consent`.
    pub kind: String,
    /// `image/jpeg`, `image/png`, `application/pdf`, `application/dicom`, `audio/webm`,
    /// `audio/mp4` or `audio/ogg`, from the content.
    pub mime_type: String,
    /// Size in bytes.
    pub size_bytes: i64,
    /// SHA-256 of the content, hex.
    pub sha256: String,
    /// A caption.
    pub caption: Option<String>,
    /// Its label, such as `OPG`, `Intraoral - upper`, `X-ray`, `Consent` or the clinic's own.
    pub label: Option<String>,
    /// FDI number of the tooth it shows.
    pub tooth: Option<u8>,
    /// When it was taken (RFC 3339).
    pub taken_at: Option<String>,
    /// When it was uploaded (RFC 3339).
    pub created_at: String,
    /// The note a recording belongs to.
    #[schema(value_type = Option<String>)]
    pub note_id: Option<Uuid>,
    /// The addendum a recording belongs to, when its note is signed.
    #[schema(value_type = Option<String>)]
    pub addendum_id: Option<Uuid>,
    /// A recording's length in seconds.
    pub duration_seconds: Option<i32>,
    /// A recording's spoken language: `en-IN`, `hi-IN`, `mr-IN` or `gu-IN`.
    pub language: Option<String>,
    /// Whether the clinic shares it with the patient in the patient app
    /// (`PUT /attachments/{id}/sharing`). Optional in the schema, so apps built before it read on.
    #[schema(required = false)]
    pub shared_with_patient: bool,
}

impl From<AttachmentView> for Attachment {
    fn from(view: AttachmentView) -> Self {
        Self {
            id: view.id.uuid(),
            visit_id: view.visit_id.map(EncounterId::uuid),
            kind: view.kind.as_str().to_owned(),
            mime_type: view.file_type.mime_type().to_owned(),
            size_bytes: view.size_bytes,
            sha256: view.sha256,
            caption: view.caption,
            label: view.label,
            tooth: view.tooth.map(aarogyam_domain::dental::Tooth::number),
            taken_at: view.taken_at.map(rfc3339),
            created_at: rfc3339(view.created_at),
            note_id: view.note_id.map(aarogyam_domain::ids::ClinicalNoteId::uuid),
            addendum_id: view
                .addendum_id
                .map(aarogyam_domain::ids::NoteAddendumId::uuid),
            duration_seconds: view.duration_seconds,
            language: view.language.map(|l| l.as_str().to_owned()),
            shared_with_patient: view.shared_with_patient,
        }
    }
}

/// A patient's files, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct AttachmentList {
    /// The files.
    pub items: Vec<Attachment>,
}

/// The form an upload sends (`multipart/form-data`).
#[derive(Debug, ToSchema)]
#[expect(
    dead_code,
    reason = "documents the multipart form; fields are read from the stream"
)]
pub struct UploadForm {
    /// A version 7 UUID the client made. A retry with the same `id` and the same content returns the record that exists instead of making another; `id_conflict` (`409`) when the id belongs to a different record. The server makes one when left out.
    id: Option<String>,
    /// The file: JPEG, PNG, PDF, DICOM or a `WebM`, `MP4` or `Ogg` recording, up to 10 MB. Its type is
    /// read from its content.
    #[schema(value_type = String, format = Binary)]
    file: Vec<u8>,
    /// `photo`, `xray`, `report`, `document` (default), `audio` or `consent`.
    kind: Option<String>,
    /// The visit it belongs to.
    visit_id: Option<String>,
    /// A caption, up to 300 characters.
    caption: Option<String>,
    /// A label, 1 to 60 characters: `OPG`, `Intraoral - upper`, `X-ray`, `Consent` or your own.
    label: Option<String>,
    /// FDI number of the tooth it shows.
    tooth: Option<i64>,
    /// A recording's note (a draft of the uploader, or a signed note together with `addendum_id`).
    note_id: Option<String>,
    /// The uploader's addendum to a signed note, which the recording belongs to.
    addendum_id: Option<String>,
    /// A recording's length in seconds, 1 to 600; required for audio.
    duration_seconds: Option<i32>,
    /// A recording's spoken language: `en-IN`, `hi-IN`, `mr-IN` or `gu-IN`.
    language: Option<String>,
}

pub(super) fn bad_form(message: &'static str) -> ApiFailure {
    ApiFailure::Error(ApiError::bad_request("invalid_request", message))
}

pub(super) fn too_large() -> ApiFailure {
    ApiFailure::Error(ApiError::new(
        ErrorKind::PayloadTooLarge,
        "too_large",
        "file: must be at most 10 MB",
    ))
}

pub(super) fn form_error(error: &MultipartError) -> ApiFailure {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        too_large()
    } else {
        bad_form("the form could not be read")
    }
}

async fn read_form(mut form: Multipart) -> Result<Upload, ApiFailure> {
    let mut upload = Upload::default();
    let mut has_file = false;
    while let Some(field) = form.next_field().await.map_err(|e| form_error(&e))? {
        let name = field.name().unwrap_or_default().to_owned();
        if name == "file" {
            upload.bytes = field.bytes().await.map_err(|e| form_error(&e))?.to_vec();
            if upload.bytes.len() > MAX_BYTES {
                return Err(too_large());
            }
            has_file = true;
            continue;
        }
        let text = field.text().await.map_err(|e| form_error(&e))?;
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        match name.as_str() {
            "id" => {
                upload.id = Some(client_id("id", text).map_err(|_| {
                    bad_form("id: must be a version 7 UUID, such as 0192f1c4-7b3a-7c2e-8f10-3a5d9e1b2c4d")
                })?);
            }
            "kind" => upload.kind = Some(text.to_owned()),
            "caption" => upload.caption = Some(text.to_owned()),
            "label" => upload.label = Some(text.to_owned()),
            "visit_id" => {
                upload.visit_id =
                    Some(Uuid::try_parse(text).map_err(|_| bad_form("visit_id: must be a UUID"))?);
            }
            "note_id" => {
                upload.note_id =
                    Some(Uuid::try_parse(text).map_err(|_| bad_form("note_id: must be a UUID"))?);
            }
            "addendum_id" => {
                upload.addendum_id = Some(
                    Uuid::try_parse(text).map_err(|_| bad_form("addendum_id: must be a UUID"))?,
                );
            }
            "duration_seconds" => {
                upload.duration_seconds = Some(
                    text.parse()
                        .map_err(|_| bad_form("duration_seconds: must be a number"))?,
                );
            }
            "language" => upload.language = Some(text.to_owned()),
            "tooth" => {
                upload.tooth = Some(
                    text.parse()
                        .map_err(|_| bad_form("tooth: must be a number"))?,
                );
            }
            _ => return Err(bad_form("unknown form field")),
        }
    }
    if has_file {
        Ok(upload)
    } else {
        Err(bad_form("file: is required"))
    }
}

/// Uploads a patient file (`multipart/form-data`, field `file` up to 10 MB). Its type is read
/// from its content; anything but JPEG, PNG, PDF, DICOM or a `WebM`, `MP4` or `Ogg` recording is
/// refused. A recording (kind `audio`, with `duration_seconds` and optionally `language`) may be
/// linked to a note with `note_id`; a signed note takes it only together with the uploader's own
/// `addendum_id`.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/attachments",
    operation_id = "uploadAttachment",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    request_body(content = UploadForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 201, body = Attachment),
        (status = 400, description = "Not an accepted file, a bad field, a visit of another patient, or a signed note without an addendum"),
        (status = 409, description = "The note is not the uploader's draft, or is entered in error, or `id_conflict`: the id belongs to a different file"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 413, description = "Larger than 10 MB")
    )
)]
pub(crate) async fn upload(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<(StatusCode, Json<Attachment>), ApiFailure> {
    let form = form.map_err(|_| bad_form("send the file as multipart/form-data"))?;
    let upload = read_form(form).await?;
    let view = app::upload(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        upload,
    )
    .await?;
    tracing::info!(event = Event::AttachmentUploaded.as_str(), attachment_id = %view.id.uuid(), "file uploaded");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// A patient's files, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/attachments",
    operation_id = "listAttachments",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = AttachmentList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<AttachmentList>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(AttachmentList {
        items: rows.into_iter().map(Attachment::from).collect(),
    }))
}

/// A short-lived link to a file.
#[derive(Debug, Serialize, ToSchema)]
pub struct DownloadLink {
    /// Path to fetch on the same clinic host, with the signed token; no sign-in header needed.
    pub url: String,
    /// When the link stops working (RFC 3339), five minutes from now.
    pub expires_at: String,
}

/// Issues a five-minute download link for a file. Opening the link writes the access record.
#[utoipa::path(
    get,
    path = "/api/v1/attachments/{id}/download",
    operation_id = "getAttachmentDownloadLink",
    tag = "clinical",
    params(("id" = String, Path, description = "The file")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = DownloadLink),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such file in this clinic")
    )
)]
pub(crate) async fn link(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<DownloadLink>, ApiFailure> {
    let link = app::link(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        AttachmentId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(DownloadLink {
        url: format!(
            "/api/v1/attachments/{}/content?token={}",
            link.attachment_id.uuid(),
            link.token
        ),
        expires_at: rfc3339(link.expires_at),
    }))
}

/// The signed token from a download link.
#[derive(Debug, Deserialize)]
pub struct ContentQuery {
    /// The token.
    #[serde(default)]
    pub token: String,
}

/// Streams a file through a signed link from `GET /attachments/{id}/download`. The link is the
/// proof of access, so no sign-in header is needed (an `<img>` can use it); it works on the
/// clinic's own host for five minutes, and every use is written to the access record.
#[utoipa::path(
    get,
    path = "/api/v1/attachments/{id}/content",
    operation_id = "getAttachmentContent",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The file"),
        ("token" = String, Query, description = "The signed token from the download link")
    ),
    responses(
        (status = 200, description = "The file, with its media type"),
        (status = 403, description = "The link has expired; ask for a new one"),
        (status = 404, description = "Not a valid link for this file on this host")
    )
)]
pub(crate) async fn content(
    State(state): State<AppState>,
    host: ClinicHost,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ContentQuery>,
) -> Result<Response, ApiFailure> {
    let download = app::download(
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
        DownloadRefusal::Expired => ApiFailure::Error(ApiError::forbidden(
            "link_expired",
            "This link has expired; ask for a new one.",
        )),
        DownloadRefusal::NotFound => ApiFailure::Error(not_found()),
        DownloadRefusal::Failed(error) => error.into(),
    })?;
    tracing::info!(event = Event::AttachmentDownloaded.as_str(), attachment_id = %id, "file downloaded");
    let disposition = format!(
        "inline; filename=\"file-{}.{}\"",
        id.simple(),
        download.file_type.extension()
    );
    let mut response = download.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(download.file_type.mime_type()),
    );
    if let Ok(value) = HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
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
