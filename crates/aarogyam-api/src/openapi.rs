//! The OpenAPI document, generated from the route annotations.

use utoipa::OpenApi;

/// Returns the OpenAPI document for every annotated route.
///
/// `docs/api/openapi.json` is the committed copy, and a test fails when the two differ.
/// Regenerate it with `UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi`.
#[must_use]
pub fn openapi() -> utoipa::openapi::OpenApi {
    let mut document = ApiDoc::openapi();
    // utoipa copies the licence from Cargo.toml; private crates have none, which would leave
    // an invalid empty licence object.
    document.info.license = None;
    document
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Aarogyam API",
        description = "The clinic platform's API. The clinic comes from the host name."
    ),
    paths(healthz),
    tags((name = "health", description = "Liveness for load balancers and Cloud Run"))
)]
struct ApiDoc;

/// Liveness check.
///
/// Answers `ok` while the process is serving; a database outage does not fail it.
#[utoipa::path(
    get,
    path = "/healthz",
    tag = "health",
    responses(
        (status = 200, description = "The process is serving", body = String, content_type = "text/plain")
    )
)]
#[expect(
    dead_code,
    reason = "documents the route sakalya_http::health_routes serves; it is never called"
)]
fn healthz() {}
