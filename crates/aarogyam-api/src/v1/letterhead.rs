//! The clinic's letterhead: image upload, and what a document prints. Documents on the clinic's
//! public pages get the same letterhead through the share link; images come through signed links.

use aarogyam_app::letterhead::{self as app, Document, ImageRefusal, Slot};
use aarogyam_app::share;
use aarogyam_domain::ids::AttachmentId;
use aarogyam_domain::letterhead::MAX_IMAGE_BYTES;
use aarogyam_domain::permission::require::{PatientsRead, SettingsManage};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartRejection};
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::files::{bad_form, form_error};
use super::rfc3339;
use super::settings::{Address, Letterhead};
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::{ApiFailure, not_found};

/// Largest image upload body: the image plus room for the form.
pub(crate) const MAX_UPLOAD_BODY: usize = MAX_IMAGE_BYTES + 64 * 1024;

/// A doctor as printed on the letterhead.
#[derive(Debug, Serialize, ToSchema)]
pub struct LetterheadDoctor {
    /// Name.
    pub name: String,
    /// Degrees, such as `BDS, MDS`.
    pub qualifications: Option<String>,
    /// Council registration number.
    pub registration_number: Option<String>,
    /// Specialty.
    pub specialty: Option<String>,
}

/// The clinic's details as printed.
#[derive(Debug, Serialize, ToSchema)]
pub struct LetterheadClinic {
    /// Display name.
    pub name: String,
    /// Registered legal name.
    pub legal_name: Option<String>,
    /// GSTIN.
    pub gstin: Option<String>,
    /// The main branch's address.
    pub address: Address,
    /// The main branch's phone.
    pub phone: Option<String>,
}

/// Everything a document needs to print the clinic's header and footer. No patient data.
#[derive(Debug, Serialize, ToSchema)]
pub struct LetterheadDocument {
    /// The clinic.
    pub clinic: LetterheadClinic,
    /// The portal's brand colour, for designs without their own accent.
    pub brand: Option<String>,
    /// The letterhead settings.
    pub letterhead: Letterhead,
    /// The doctors to print, in order.
    pub doctors: Vec<LetterheadDoctor>,
    /// The uploaded letterhead image in upload mode: a signed path on the same host.
    pub image_url: Option<String>,
    /// The logo: a signed path on the same host.
    pub logo_url: Option<String>,
    /// When the image links stop working (RFC 3339).
    pub expires_at: String,
}

fn image_url(link: &app::ImageLink) -> String {
    format!(
        "/api/v1/letterhead/images/{}/content?token={}",
        link.id, link.token
    )
}

fn view(document: Document, now: OffsetDateTime) -> LetterheadDocument {
    let expires_at = now + app::IMAGE_LINK_LIFETIME;
    LetterheadDocument {
        image_url: document.image.as_ref().map(image_url),
        logo_url: document.logo.as_ref().map(image_url),
        clinic: LetterheadClinic {
            name: document.name,
            legal_name: document.legal_name,
            gstin: document.gstin,
            address: Address {
                line1: document.address.line1,
                line2: document.address.line2,
                city: document.address.city,
                state: document.address.state,
                pincode: document.address.pincode,
            },
            phone: document.phone,
        },
        brand: document.brand,
        letterhead: document.letterhead.into(),
        doctors: document
            .doctors
            .into_iter()
            .map(|doctor| LetterheadDoctor {
                name: doctor.name,
                qualifications: doctor.qualifications,
                registration_number: doctor.registration_number,
                specialty: doctor.specialty,
            })
            .collect(),
        expires_at: rfc3339(expires_at),
    }
}

/// What a document prints for the signed-in member's clinic: the letterhead, clinic details,
/// doctors, and signed image links.
#[utoipa::path(
    get,
    path = "/api/v1/letterhead",
    operation_id = "getLetterhead",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = LetterheadDocument),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn document(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
) -> Result<Json<LetterheadDocument>, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    let document = app::document(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        now,
    )
    .await?;
    Ok(Json(view(document, now)))
}

/// Public, no sign-in: the letterhead for a share link's page, so the page prints the clinic's
/// header even before the PIN. Needs a link that exists; holds no patient data.
#[utoipa::path(
    get,
    path = "/api/v1/shared/{token}/letterhead",
    operation_id = "getSharedLetterhead",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    responses(
        (status = 200, body = LetterheadDocument),
        (status = 404, description = "No such link")
    )
)]
pub(crate) async fn shared_document(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath(token): ApiPath<String>,
) -> Result<Json<LetterheadDocument>, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    share::preview(state.db(), public.clinic_id, public.request_id, &token, now).await?;
    let document = app::public_document(
        state.db(),
        state.files()?,
        public.clinic_id,
        public.request_id,
        now,
    )
    .await?;
    Ok(Json(view(document, now)))
}

/// The image form: one file.
#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "documents the multipart form for OpenAPI")]
pub struct ImageForm {
    /// A PNG or JPEG of at most 2 MB.
    #[schema(value_type = String, format = Binary)]
    file: String,
}

async fn read_image(mut form: Multipart) -> Result<Vec<u8>, ApiFailure> {
    while let Some(field) = form.next_field().await.map_err(|e| form_error(&e))? {
        if field.name() == Some("file") {
            let bytes = field.bytes().await.map_err(|e| form_error(&e))?;
            return Ok(bytes.to_vec());
        }
    }
    Err(bad_form("file: is required"))
}

/// Uploads the letterhead image (`slot` `letterhead`) or the logo (`slot` `logo`) as
/// `multipart/form-data` field `file`: PNG or JPEG, up to 2 MB, checked by content. Replaces the
/// previous one. Returns the letterhead settings.
#[utoipa::path(
    put,
    path = "/api/v1/settings/letterhead/images/{slot}",
    operation_id = "uploadLetterheadImage",
    tag = "settings",
    params(("slot" = String, Path, description = "`letterhead` or `logo`")),
    request_body(content = ImageForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Letterhead),
        (status = 400, description = "Not a PNG or JPEG, empty, or a bad slot"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 413, description = "Larger than 2 MB")
    )
)]
pub(crate) async fn upload_image(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(slot): ApiPath<String>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<Json<Letterhead>, ApiFailure> {
    let slot = Slot::parse(&slot)?;
    let form = form.map_err(|_| bad_form("send the image as multipart/form-data"))?;
    let bytes = read_image(form).await?;
    let letterhead = app::upload_image(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        slot,
        bytes,
    )
    .await?;
    Ok(Json(letterhead.into()))
}

/// Removes the letterhead image or the logo. Without an image, upload mode falls back to the
/// generated design.
#[utoipa::path(
    delete,
    path = "/api/v1/settings/letterhead/images/{slot}",
    operation_id = "removeLetterheadImage",
    tag = "settings",
    params(("slot" = String, Path, description = "`letterhead` or `logo`")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Letterhead),
        (status = 400, description = "A bad slot"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn remove_image(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(slot): ApiPath<String>,
) -> Result<Json<Letterhead>, ApiFailure> {
    let letterhead = app::remove_image(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        Slot::parse(&slot)?,
    )
    .await?;
    Ok(Json(letterhead.into()))
}

/// The signed token from an image link.
#[derive(Debug, Deserialize)]
pub struct ImageQuery {
    #[serde(default)]
    pub token: String,
}

/// Streams a letterhead image through its signed link. The link is the proof of access (an
/// `<img>` can use it) and works on the clinic's own host for an hour.
#[utoipa::path(
    get,
    path = "/api/v1/letterhead/images/{id}/content",
    operation_id = "getLetterheadImageContent",
    tag = "public",
    params(
        ("id" = String, Path, description = "The image"),
        ("token" = String, Query, description = "The signed token from the letterhead document")
    ),
    responses(
        (status = 200, description = "The image, with its media type"),
        (status = 403, description = "The link has expired; load the page again"),
        (status = 404, description = "Not a valid link for an image of this clinic")
    )
)]
pub(crate) async fn image_content(
    State(state): State<AppState>,
    host: ClinicHost,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ImageQuery>,
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
        ImageRefusal::Expired => ApiFailure(ApiError::forbidden(
            "link_expired",
            "This link has expired; load the page again.",
        )),
        ImageRefusal::NotFound => ApiFailure(not_found()),
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
