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
        crate::v1::me::sessions,
        crate::v1::me::revoke_session,
        crate::v1::invitations::accept,
        crate::v1::patients::recent,
        crate::v1::patients::search,
        crate::v1::patients::register,
        crate::v1::patients::open,
        crate::v1::patients::edit,
        crate::v1::visits::start,
        crate::v1::visits::list,
        crate::v1::visits::open,
        crate::v1::visits::timeline,
        crate::v1::visits::close,
        crate::v1::visits::create_note,
        crate::v1::visits::edit_note,
        crate::v1::visits::sign_note,
        crate::v1::visits::add_addendum,
        crate::v1::visits::note_in_error,
        crate::v1::vitals::record,
        crate::v1::vitals::in_error,
        crate::v1::facts::conditions,
        crate::v1::facts::add_condition,
        crate::v1::facts::edit_condition,
        crate::v1::facts::allergies,
        crate::v1::facts::add_allergy,
        crate::v1::facts::edit_allergy,
        crate::v1::facts::flags,
        crate::v1::chart::get,
        crate::v1::chart::record,
        crate::v1::treatment::record_procedure,
        crate::v1::treatment::procedures,
        crate::v1::treatment::complete,
        crate::v1::treatment::procedure_in_error,
        crate::v1::treatment::create_plan,
        crate::v1::treatment::plans,
        crate::v1::treatment::accept_plan,
        crate::v1::files::upload,
        crate::v1::files::list,
        crate::v1::files::link,
        crate::v1::files::content,
        crate::v1::staff::list,
        crate::v1::staff::invite,
        crate::v1::staff::change,
        crate::v1::staff::roles,
        crate::v1::settings::get_clinic,
        crate::v1::settings::update_clinic,
        crate::v1::console::clinics,
        crate::v1::console::create_clinic,
        crate::v1::console::metrics,
        crate::dev::token,
        crate::v1::internal::drain_outbox,
    ),
    modifiers(&BearerAuth),
    tags(
        (name = "health", description = "Liveness for load balancers and Cloud Run"),
        (name = "session", description = "Who is signed in, and where"),
        (name = "patients", description = "A clinic's patients; clinic host only"),
        (name = "clinical", description = "Visits, notes, vitals, the dental chart, treatment and files; clinic host only"),
        (name = "staff", description = "A clinic's staff, invitations and roles; clinic host only"),
        (name = "settings", description = "A clinic's own settings; clinic host only"),
        (name = "console", description = "Sakalya's console; console host only, staff only"),
        (name = "development", description = "Local development only; absent in deployed servers"),
        (name = "internal", description = "Scheduled jobs; local only until Cloud Scheduler's signed calls are checked")
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
