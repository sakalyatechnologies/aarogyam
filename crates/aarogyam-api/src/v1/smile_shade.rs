//! The tooth colour a doctor settled on in Show patient, kept for the patient's next visit.

use aarogyam_app::error::AppError;
use aarogyam_app::smile_shade as app;
use aarogyam_domain::ids::PatientId;
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

/// A patient's tooth colour in the Painted smile.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SmileShade {
    /// 0 (lightest) to 100 (deepest); null when never saved. Required on a save.
    pub shade: Option<i16>,
}

/// The patient's saved tooth colour for Show patient; `shade` is null when never saved.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/smile-shade",
    operation_id = "getSmileShade",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = SmileShade),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic or the caller's reach")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<SmileShade>, ApiFailure> {
    let shade = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(SmileShade { shade }))
}

/// Saves the patient's tooth colour, replacing an earlier one. 400 outside 0 to 100.
#[utoipa::path(
    put,
    path = "/api/v1/patients/{id}/smile-shade",
    operation_id = "saveSmileShade",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    request_body = SmileShade,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SmileShade),
        (status = 400, description = "Invalid input; the message says what"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic or the caller's reach")
    )
)]
pub(crate) async fn save(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<SmileShade>,
) -> Result<Json<SmileShade>, ApiFailure> {
    let shade = input
        .shade
        .ok_or_else(|| AppError::invalid("shade", "required"))?;
    let saved = app::save(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        i64::from(shade),
    )
    .await?;
    Ok(Json(SmileShade { shade: Some(saved) }))
}
