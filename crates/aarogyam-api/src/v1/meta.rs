//! What the API is and which app versions it serves. Public: an app asks before it signs in.

use axum::Json;
use axum::extract::State;
use serde::Serialize;
use utoipa::ToSchema;

use crate::AppState;

/// The versions of one app the API serves.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClientVersions {
    /// The app's name as it appears in `x-client`, such as `aarogyam-staff`.
    pub app: String,
    /// The oldest version still served; older ones get `426 client_upgrade_required`.
    pub min_version: String,
    /// The newest released version, for asking people to update before the minimum moves.
    pub latest_version: String,
}

/// What the API serves.
#[derive(Debug, Serialize, ToSchema)]
pub struct Meta {
    /// Each app the server tracks versions of; empty when every version is served.
    pub clients: Vec<ClientVersions>,
}

/// The oldest and newest version of each phone app the API serves. Apps send
/// `x-client: <app>/<version>` with every request and are refused below the minimum; this
/// answers without a sign-in, and to apps that are already too old, so they can say so.
#[utoipa::path(
    get,
    path = "/api/v1/meta",
    operation_id = "getMeta",
    tag = "meta",
    responses((status = 200, body = Meta))
)]
pub(crate) async fn meta(State(state): State<AppState>) -> Json<Meta> {
    Json(Meta {
        clients: state
            .client_policy()
            .rules()
            .map(|(app, rule)| ClientVersions {
                app: app.to_owned(),
                min_version: rule.min.to_string(),
                latest_version: rule.latest.to_string(),
            })
            .collect(),
    })
}
