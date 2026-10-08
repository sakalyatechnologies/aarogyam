//! A public health route for uptime checks. Cloud Run's own front end answers `/healthz`
//! itself on `*.run.app`, so a check there never reaches the API; this route does. It checks
//! nothing else on purpose (a database outage should not look like a dead API to a restart
//! policy), and says nothing about the deployment.

use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

/// The answer to a health check.
#[derive(Debug, Serialize, ToSchema)]
pub struct Health {
    /// Always `ok` while the API is serving.
    pub status: &'static str,
}

/// Whether the API is serving (public, no sign-in, no database).
#[utoipa::path(
    get,
    path = "/api/v1/health",
    operation_id = "checkApiHealth",
    tag = "meta",
    responses((status = 200, body = Health))
)]
pub(crate) async fn health() -> Json<Health> {
    Json(Health { status: "ok" })
}
