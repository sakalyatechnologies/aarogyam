//! Tooth pins on an X-ray or photo, placed once and kept for the next visit (slice 2g of
//! docs/plans/present-studio-design.md).

use aarogyam_app::image_pins as app;
use aarogyam_domain::ids::AttachmentId;
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use axum::Json;
use axum::extract::State;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A tooth pinned on an image.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ImagePin {
    /// FDI tooth.
    pub tooth: i64,
    /// Across the image as a fraction of its width, 0 to 1, in the image's own orientation.
    pub x: f32,
    /// Down the image as a fraction of its height, 0 to 1.
    pub y: f32,
    /// A short note on the pin, at most 80 characters; trimmed, and empty is saved as none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// An image's pins.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ImagePins {
    /// One per tooth, by tooth number.
    pub pins: Vec<ImagePin>,
}

fn body(pins: Vec<app::Pin>) -> Json<ImagePins> {
    Json(ImagePins {
        pins: pins
            .into_iter()
            .map(|p| ImagePin {
                tooth: i64::from(p.tooth),
                x: p.x,
                y: p.y,
                label: p.label,
            })
            .collect(),
    })
}

/// The tooth pins placed on an X-ray or photo.
#[utoipa::path(
    get,
    path = "/api/v1/attachments/{id}/pins",
    operation_id = "listImagePins",
    tag = "clinical",
    params(("id" = String, Path, description = "The file")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ImagePins),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such file in this clinic or the caller's reach")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ImagePins>, ApiFailure> {
    let pins = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        AttachmentId::from_uuid(id),
    )
    .await?;
    Ok(body(pins))
}

/// Replaces the pins on an X-ray or photo: new teeth are placed, known teeth moved, teeth left
/// out removed. 400 for a bad tooth, a place outside the image or a tooth twice.
#[utoipa::path(
    put,
    path = "/api/v1/attachments/{id}/pins",
    operation_id = "saveImagePins",
    tag = "clinical",
    params(("id" = String, Path, description = "The file")),
    request_body = ImagePins,
    security(("bearer" = [])),
    responses(
        (status = 200, body = ImagePins),
        (status = 400, description = "Invalid input; the message says what"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such file in this clinic or the caller's reach")
    )
)]
pub(crate) async fn save(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<ImagePins>,
) -> Result<Json<ImagePins>, ApiFailure> {
    let pins: Vec<(i64, f32, f32, Option<String>)> = input
        .pins
        .into_iter()
        .map(|p| (p.tooth, p.x, p.y, p.label))
        .collect();
    let saved = app::replace(
        state.db(),
        &request.actor,
        request.request_id,
        AttachmentId::from_uuid(id),
        &pins,
    )
    .await?;
    Ok(body(saved))
}
