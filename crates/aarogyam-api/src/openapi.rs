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
        crate::v1::imports::identifiers,
        crate::v1::imports::add_identifier,
        crate::v1::imports::remove_identifier,
        crate::v1::imports::import_patients,
        crate::v1::schedule::rooms,
        crate::v1::schedule::add_room,
        crate::v1::schedule::change_room,
        crate::v1::schedule::remove_room,
        crate::v1::schedule::practitioners,
        crate::v1::schedule::add_practitioner,
        crate::v1::schedule::change_practitioner,
        crate::v1::schedule::remove_practitioner,
        crate::v1::schedule::hours,
        crate::v1::schedule::set_hours,
        crate::v1::schedule::leave,
        crate::v1::schedule::add_leave,
        crate::v1::schedule::remove_leave,
        crate::v1::appointments::list,
        crate::v1::appointments::book,
        crate::v1::appointments::change,
        crate::v1::appointments::set_status,
        crate::v1::queue::list,
        crate::v1::queue::walk_in,
        crate::v1::queue::set_status,
        crate::v1::today::today,
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
        (name = "schedule", description = "A clinic's chairs, doctors, working hours and leave; clinic host only"),
        (name = "appointments", description = "The calendar, appointments and Today; clinic host only"),
        (name = "queue", description = "The waiting-room queue; clinic host only"),
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
