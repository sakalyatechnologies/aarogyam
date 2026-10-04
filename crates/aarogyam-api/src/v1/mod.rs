//! Routes under `/api/v1`. Each route's extractor names who may call it:
//! [`crate::extract::Require`] (a clinic member with a permission), [`crate::extract::PlatformRequest`]
//! (Sakalya staff on the console host) or [`crate::extract::SignedIn`] (anyone signed in).

pub(crate) mod billing;
pub(crate) mod console;
pub(crate) mod internal;
pub(crate) mod invitations;
pub(crate) mod me;
pub(crate) mod patients;
pub(crate) mod payments;
pub(crate) mod prescriptions;
pub(crate) mod recalls;
pub(crate) mod reports;
pub(crate) mod settings;
pub(crate) mod staff;

use axum::Router;
use axum::routing::{get, patch, post};
use sakalya_http::ApiError;
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::AppState;

/// The version 1 routes. `local_dev` adds the development sign-in and the outbox drain, which
/// deployed servers don't have until Cloud Scheduler's signed calls are checked.
pub(crate) fn routes(local_dev: bool) -> Router<AppState> {
    let router = Router::new()
        .route("/me", get(me::me))
        .route("/me/sessions", get(me::sessions))
        .route("/me/sessions/{id}/revoke", post(me::revoke_session))
        .route("/session", get(me::session))
        .route("/invitations/accept", post(invitations::accept))
        .route("/patients", get(patients::recent).post(patients::register))
        .route("/patients/search", post(patients::search))
        .route("/patients/{id}", get(patients::open).patch(patients::edit))
        .route("/staff", get(staff::list))
        .route("/staff/invitations", post(staff::invite))
        .route("/staff/{membership_id}", patch(staff::change))
        .route("/roles", get(staff::roles))
        .route(
            "/settings/clinic",
            get(settings::get_clinic).patch(settings::update_clinic),
        )
        .route(
            "/console/clinics",
            get(console::clinics).post(console::create_clinic),
        )
        .route("/console/metrics", get(console::metrics))
        .route(
            "/price-items",
            get(billing::price_items).post(billing::create_price_item),
        )
        .route("/price-items/{id}", patch(billing::update_price_item))
        .route(
            "/invoices",
            get(billing::list_invoices).post(billing::create_invoice),
        )
        .route(
            "/invoices/{id}",
            get(billing::get_invoice).patch(billing::edit_invoice),
        )
        .route("/invoices/{id}/issue", post(billing::issue_invoice))
        .route("/invoices/{id}/void", post(billing::void_invoice))
        .route("/payments", get(payments::list).post(payments::record))
        .route("/payments/{id}", get(payments::get))
        .route("/payments/{id}/void", post(payments::void))
        .route("/reports/collections", get(reports::collections))
        .route("/reports/pending", get(reports::pending))
        .route("/today/money", get(reports::today_money))
        .route("/patients/{id}/recalls", post(recalls::create))
        .route("/recalls", get(recalls::due))
        .route("/recalls/{id}/done", post(recalls::done))
        .route("/drugs/search", post(prescriptions::search_drugs))
        .route(
            "/patients/{id}/prescriptions",
            get(prescriptions::for_patient).post(prescriptions::create),
        )
        .route(
            "/patients/{id}/prescriptions/last",
            get(prescriptions::last),
        )
        .route(
            "/prescriptions/{id}",
            get(prescriptions::get).patch(prescriptions::edit),
        )
        .route("/prescriptions/{id}/issue", post(prescriptions::issue))
        .route("/prescriptions/{id}/cancel", post(prescriptions::cancel))
        .route(
            "/prescriptions/{id}/share",
            post(prescriptions::create_share),
        )
        // Public, no sign-in: on the clinic's host, limited by the link's token and PIN.
        .route("/shared/{token}", get(prescriptions::shared_preview))
        .route("/shared/{token}/open", post(prescriptions::shared_open))
        .route(
            "/verify/prescriptions/{verify_token}",
            get(prescriptions::verify),
        );
    if local_dev {
        router
            .route("/dev/token", post(crate::dev::token))
            .route("/internal/outbox/drain", post(internal::drain_outbox))
    } else {
        router
    }
}

/// RFC 3339 for timestamps in responses.
pub(crate) fn rfc3339(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap_or_default()
}

/// A clinic day, `YYYY-MM-DD`.
pub(crate) fn parse_day(field: &'static str, text: &str) -> Result<Date, ApiError> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    Date::parse(text.trim(), &format).map_err(|_| {
        ApiError::bad_request("invalid_request", format!("{field}: must be YYYY-MM-DD"))
    })
}

/// An optional identifier where an empty string means none.
pub(crate) fn optional_uuid(field: &'static str, text: &str) -> Result<Option<Uuid>, ApiError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    Uuid::parse_str(text)
        .map(Some)
        .map_err(|_| ApiError::bad_request("invalid_request", format!("{field}: must be an id")))
}
