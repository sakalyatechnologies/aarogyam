//! The version gate: a phone app that is too old is told to update (`426`) before its request
//! reaches a route.

use std::sync::Arc;

use aarogyam_domain::client::ClientPolicy;
use axum::Json;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// The request header apps send: `<app>/<version>`, such as `aarogyam-staff/0.1.0`.
pub(crate) const CLIENT_HEADER: &str = "x-client";

/// The one route an old app may still call: it says which versions are served.
const META_PATH: &str = "/api/v1/meta";

/// Answers `426 client_upgrade_required` to an app below its minimum version. Requests without
/// `x-client` (browsers), with a header that isn't `<app>/<version>`, or from an app that isn't
/// listed pass untouched.
pub(crate) async fn client_gate(
    State(policy): State<Arc<ClientPolicy>>,
    request: Request,
    next: Next,
) -> Response {
    let below = request
        .headers()
        .get(CLIENT_HEADER)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|header| policy.is_below_minimum(header));
    if below && request.uri().path() != META_PATH {
        tracing::debug!(code = "client_upgrade_required", "request rejected");
        let body = json!({ "error": {
            "code": "client_upgrade_required",
            "message": "This version of the app is no longer supported. Update the app to continue.",
        } });
        return (StatusCode::UPGRADE_REQUIRED, Json(body)).into_response();
    }
    next.run(request).await
}
