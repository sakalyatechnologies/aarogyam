//! Routes under `/api/v1`. Each route's extractor names who may call it:
//! [`crate::extract::Require`] (a clinic member with a permission), [`crate::extract::PlatformRequest`]
//! (Sakalya staff on the console host) or [`crate::extract::SignedIn`] (anyone signed in).

pub(crate) mod chart;
pub(crate) mod console;
pub(crate) mod facts;
pub(crate) mod files;
pub(crate) mod internal;
pub(crate) mod invitations;
pub(crate) mod me;
pub(crate) mod patients;
pub(crate) mod settings;
pub(crate) mod staff;
pub(crate) mod treatment;
pub(crate) mod visits;
pub(crate) mod vitals;

use axum::Router;
use axum::extract::DefaultBodyLimit;
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
        .route("/visits/{id}/observations", post(vitals::record))
        .route(
            "/observations/{id}/entered-in-error",
            post(vitals::in_error),
        )
        .route(
            "/patients/{id}/conditions",
            get(facts::conditions).post(facts::add_condition),
        )
        .route(
            "/patients/{id}/conditions/{condition_id}",
            patch(facts::edit_condition),
        )
        .route(
            "/patients/{id}/allergies",
            get(facts::allergies).post(facts::add_allergy),
        )
        .route(
            "/patients/{id}/allergies/{allergy_id}",
            patch(facts::edit_allergy),
        )
        .route("/patients/{id}/clinical-flags", get(facts::flags))
        .route(
            "/patients/{id}/dental-chart",
            get(chart::get).post(chart::record),
        )
        .route("/visits/{id}/procedures", post(treatment::record_procedure))
        .route("/patients/{id}/procedures", get(treatment::procedures))
        .route("/procedures/{id}/complete", post(treatment::complete))
        .route(
            "/procedures/{id}/entered-in-error",
            post(treatment::procedure_in_error),
        )
        .route(
            "/patients/{id}/treatment-plans",
            get(treatment::plans).post(treatment::create_plan),
        )
        .route("/treatment-plans/{id}/accept", post(treatment::accept_plan))
        .route(
            "/patients/{id}/attachments",
            get(files::list)
                .post(files::upload)
                .layer(DefaultBodyLimit::max(files::MAX_UPLOAD_BODY)),
        )
        .route("/attachments/{id}/download", get(files::link))
        .route("/attachments/{id}/content", get(files::content))
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
