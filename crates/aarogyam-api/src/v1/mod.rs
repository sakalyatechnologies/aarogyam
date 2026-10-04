//! Routes under `/api/v1`. Each route's extractor names who may call it:
//! [`crate::extract::Require`] (a clinic member with a permission), [`crate::extract::PlatformRequest`]
//! (Sakalya staff on the console host) or [`crate::extract::SignedIn`] (anyone signed in).

pub(crate) mod console;
pub(crate) mod internal;
pub(crate) mod invitations;
pub(crate) mod me;
pub(crate) mod patients;
pub(crate) mod settings;
pub(crate) mod staff;
pub(crate) mod visits;

use axum::Router;
use axum::routing::{get, patch, post};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

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
        .route(
            "/patients/{id}/visits",
            get(visits::list).post(visits::start),
        )
        .route("/visits/{id}", get(visits::open))
        .route("/visits/{id}/close", post(visits::close))
        .route("/visits/{id}/notes", post(visits::create_note))
        .route("/notes/{id}", patch(visits::edit_note))
        .route("/notes/{id}/sign", post(visits::sign_note))
        .route("/notes/{id}/addenda", post(visits::add_addendum))
        .route("/notes/{id}/entered-in-error", post(visits::note_in_error))
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
        .route("/console/metrics", get(console::metrics));
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
