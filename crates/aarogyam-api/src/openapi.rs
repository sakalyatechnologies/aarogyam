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
        crate::v1::staff::list,
        crate::v1::staff::invite,
        crate::v1::staff::change,
        crate::v1::staff::roles,
        crate::v1::settings::get_clinic,
        crate::v1::settings::update_clinic,
        crate::v1::console::clinics,
        crate::v1::console::create_clinic,
        crate::v1::console::metrics,
        crate::v1::billing::price_items,
        crate::v1::billing::create_price_item,
        crate::v1::billing::update_price_item,
        crate::v1::billing::list_invoices,
        crate::v1::billing::create_invoice,
        crate::v1::billing::get_invoice,
        crate::v1::billing::edit_invoice,
        crate::v1::billing::issue_invoice,
        crate::v1::billing::void_invoice,
        crate::v1::payments::list,
        crate::v1::payments::record,
        crate::v1::payments::get,
        crate::v1::payments::void,
        crate::v1::reports::collections,
        crate::v1::reports::pending,
        crate::v1::reports::today_money,
        crate::v1::recalls::create,
        crate::v1::recalls::due,
        crate::v1::recalls::done,
        crate::v1::prescriptions::search_drugs,
        crate::v1::prescriptions::create,
        crate::v1::prescriptions::for_patient,
        crate::v1::prescriptions::last,
        crate::v1::prescriptions::get,
        crate::v1::prescriptions::edit,
        crate::v1::prescriptions::issue,
        crate::v1::prescriptions::cancel,
        crate::v1::prescriptions::create_share,
        crate::v1::prescriptions::shared_preview,
        crate::v1::prescriptions::shared_open,
        crate::v1::prescriptions::verify,
        crate::dev::token,
        crate::v1::internal::drain_outbox,
    ),
    modifiers(&BearerAuth),
    tags(
        (name = "health", description = "Liveness for load balancers and Cloud Run"),
        (name = "session", description = "Who is signed in, and where"),
        (name = "patients", description = "A clinic's patients; clinic host only"),
        (name = "staff", description = "A clinic's staff, invitations and roles; clinic host only"),
        (name = "settings", description = "A clinic's own settings; clinic host only"),
        (name = "billing", description = "Price list, bills, payments and receipts; clinic host only"),
        (name = "reports", description = "Money reports for owners and finance; clinic host only"),
        (name = "prescriptions", description = "Prescriptions, the medicine list and patient links; clinic host only"),
        (name = "public", description = "No sign-in: patient links and QR verification on the clinic's host"),
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
