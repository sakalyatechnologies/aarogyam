//! `/me/ui-prefs`: the caller's saved screen choices in this clinic.

use aarogyam_app::ui_prefs as app;
use aarogyam_domain::permission::require::ClinicalRead;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::AppState;
use crate::extract::Require;

/// The caller's saved screen choices; defaults when nothing is saved.
#[derive(Debug, Serialize, ToSchema)]
pub struct UiPrefs {
    /// The Show patient style: `story` (default), `painted`, `xray`, `smile3d` or `face`.
    pub present_style: String,
    /// The history view: `page` (default), `popup` or `story`.
    pub history_view: String,
}

impl From<app::UiPrefs> for UiPrefs {
    fn from(prefs: app::UiPrefs) -> Self {
        Self {
            present_style: prefs.present_style.to_owned(),
            history_view: prefs.history_view.to_owned(),
        }
    }
}

/// The fields to save; one left out stays as it was.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NewUiPrefs {
    /// The Show patient style; an unknown one is a 400.
    #[serde(default)]
    #[schema(required = false)]
    pub present_style: Option<String>,
    /// The history view; an unknown one is a 400.
    #[serde(default)]
    #[schema(required = false)]
    pub history_view: Option<String>,
}

/// The caller's saved screen choices in this clinic.
#[utoipa::path(
    get,
    path = "/api/v1/me/ui-prefs",
    operation_id = "getUiPrefs",
    tag = "clinical",
    security(("bearer" = [])),
    responses(
        (status = 200, body = UiPrefs, description = "Defaults until saved"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read")
    )
)]
pub(crate) async fn get_prefs(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
) -> Result<Json<UiPrefs>, crate::ApiFailure> {
    let prefs = app::get(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(prefs.into()))
}

/// Saves the caller's screen choices in this clinic.
#[utoipa::path(
    put,
    path = "/api/v1/me/ui-prefs",
    operation_id = "saveUiPrefs",
    tag = "clinical",
    request_body = NewUiPrefs,
    security(("bearer" = [])),
    responses(
        (status = 200, body = UiPrefs, description = "Saved"),
        (status = 400, description = "An unknown value"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read, or Sakalya support")
    )
)]
pub(crate) async fn save_prefs(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiJson(body): ApiJson<NewUiPrefs>,
) -> Result<Json<UiPrefs>, crate::ApiFailure> {
    let prefs = app::save(
        state.db(),
        &request.actor,
        request.request_id,
        body.present_style.as_deref(),
        body.history_view.as_deref(),
    )
    .await?;
    Ok(Json(prefs.into()))
}
