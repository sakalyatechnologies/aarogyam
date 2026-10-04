//! Routes under `/api/v1`. Each route's extractor names who may call it:
//! [`crate::extract::Require`] (a clinic member with a permission), [`crate::extract::PlatformRequest`]
//! (Sakalya staff on the console host) or [`crate::extract::SignedIn`] (anyone signed in).

pub(crate) mod appointments;
pub(crate) mod console;
pub(crate) mod imports;
pub(crate) mod internal;
pub(crate) mod invitations;
pub(crate) mod me;
pub(crate) mod patients;
pub(crate) mod queue;
pub(crate) mod schedule;
pub(crate) mod settings;
pub(crate) mod staff;
pub(crate) mod today;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, patch, post};
use sakalya_http::ApiError;
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, Time};
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
        .route(
            "/patients/{id}/identifiers",
            get(imports::identifiers).post(imports::add_identifier),
        )
        .route(
            "/patients/{id}/identifiers/{identifier_id}",
            delete(imports::remove_identifier),
        )
        .route(
            "/imports/patients",
            // 2 MB of CSV, plus JSON escaping.
            post(imports::import_patients).layer(DefaultBodyLimit::max(3 * 1024 * 1024)),
        )
        .route("/rooms", get(schedule::rooms).post(schedule::add_room))
        .route(
            "/rooms/{id}",
            patch(schedule::change_room).delete(schedule::remove_room),
        )
        .route(
            "/practitioners",
            get(schedule::practitioners).post(schedule::add_practitioner),
        )
        .route(
            "/practitioners/{id}",
            patch(schedule::change_practitioner).delete(schedule::remove_practitioner),
        )
        .route(
            "/practitioners/{id}/working-hours",
            get(schedule::hours).put(schedule::set_hours),
        )
        .route(
            "/leave-blocks",
            get(schedule::leave).post(schedule::add_leave),
        )
        .route("/leave-blocks/{id}", delete(schedule::remove_leave))
        .route(
            "/appointments",
            get(appointments::list).post(appointments::book),
        )
        .route("/appointments/{id}", patch(appointments::change))
        .route("/appointments/{id}/status", post(appointments::set_status))
        .route("/queue", get(queue::list).post(queue::walk_in))
        .route("/queue/{id}/status", post(queue::set_status))
        .route("/today", get(today::today))
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

fn bad(field: &str, problem: &str) -> ApiError {
    ApiError::bad_request("invalid_request", format!("{field}: {problem}"))
}

/// An instant in RFC 3339, such as `2026-10-05T10:00:00+05:30`.
pub(crate) fn parse_instant(field: &str, text: &str) -> Result<OffsetDateTime, ApiError> {
    OffsetDateTime::parse(text.trim(), &Rfc3339).map_err(|_| {
        bad(
            field,
            "must be an RFC 3339 time such as 2026-10-05T10:00:00+05:30",
        )
    })
}

/// A local date, `YYYY-MM-DD`.
pub(crate) fn parse_day(field: &str, text: &str) -> Result<Date, ApiError> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    Date::parse(text.trim(), &format).map_err(|_| bad(field, "must be YYYY-MM-DD"))
}

/// A local time of day, `HH:MM`.
pub(crate) fn parse_clock(field: &str, text: &str) -> Result<Time, ApiError> {
    let format = time::macros::format_description!("[hour]:[minute]");
    Time::parse(text.trim(), &format).map_err(|_| bad(field, "must be HH:MM"))
}

/// A local time of day as `HH:MM`.
pub(crate) fn clock(at: Time) -> String {
    format!("{:02}:{:02}", at.hour(), at.minute())
}

/// An identifier sent in a body.
pub(crate) fn parse_id(field: &str, text: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(text.trim()).map_err(|_| bad(field, "must be an id"))
}
