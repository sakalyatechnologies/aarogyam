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
    paths(
        healthz,
        crate::v1::me::me,
        crate::v1::me::session,
        crate::v1::invitations::accept,
        crate::v1::patients::recent,
        crate::v1::patients::search,
        crate::v1::patients::register,
        crate::v1::patients::open,
        crate::v1::patients::edit,
        crate::v1::settings::get_clinic,
        crate::v1::settings::update_clinic,
        crate::v1::console::clinics,
        crate::v1::console::create_clinic,
        crate::v1::console::metrics,
        crate::dev::token,
    ),
    modifiers(&BearerAuth),
    tags(
        (name = "health", description = "Liveness for load balancers and Cloud Run"),
        (name = "session", description = "Who is signed in, and where"),
        (name = "patients", description = "A clinic's patients; clinic host only"),
        (name = "settings", description = "A clinic's own settings; clinic host only"),
        (name = "console", description = "Sakalya's console; console host only, staff only"),
        (name = "development", description = "Local development only; absent in deployed servers")
    )
)]
struct ApiDoc;

/// Declares the `bearer` scheme: a Supabase Auth access token in `Authorization: Bearer …`.
struct BearerAuth;

impl utoipa::Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

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
