//! Aarogyam's HTTP API.
//!
//! [`router`] builds the whole service: `GET /healthz` from `sakalya-http`, the versioned routes
//! under `/api/v1`, and the standard middleware (request IDs, the request span, panic recovery,
//! timeouts and body limits). Handlers stay thin: they parse input into domain types, call a use
//! case in `aarogyam-app`, and fail with `sakalya_http::ApiError`.
//!
//! Every route is annotated for OpenAPI. [`openapi`] returns the document, and a test keeps the
//! committed `docs/api/openapi.json` in step with it.
//!
//! # Examples
//!
//! ```no_run
//! use aarogyam_api::{AppState, DevTokens, Hosts, TokenCheck, router};
//! use sakalya_http::HttpConfig;
//! use secrecy::SecretString;
//!
//! # async fn run(db: sakalya_db::Db) -> Result<(), sakalya_http::ServeError> {
//! let tokens = TokenCheck::Dev(DevTokens::new("aarogyam-dev", "authenticated", SecretString::from("local secret")));
//! let hosts = Hosts {
//!     portal_host_template: "{slug}.localtest.me".into(),
//!     console: "console.localtest.me".into(),
//!     app: "app.localtest.me".into(),
//! };
//! let app = router(AppState::new(db, HttpConfig::default(), tokens, hosts));
//! sakalya_http::serve(app, "127.0.0.1:8080".parse().expect("valid address")).await
//! # }
//! ```

mod cache;
mod client_gate;
mod dev;
pub mod error_report;
mod extract;
mod failure;
pub mod metrics;
mod openapi;
mod revalidate;
mod scrub;
mod state;
mod v1;

use axum::Router;

pub use dev::DevTokens;
pub use error_report::ErrorReporting;
pub use extract::{ClinicRequest, PlatformRequest, Require, SignedIn};
pub use failure::ApiFailure;
#[doc(inline)]
pub use openapi::openapi;
pub use state::{AppState, Hosts, TokenCheck, WebsiteLinks};

/// The per-IP request limits, applied before any token is checked. Sign-in itself is
/// Supabase's, with its own limits. The public registration form gets a strict limit of its
/// own, since it needs no sign-in.
///
/// # Errors
/// [`sakalya_throttle::ConfigError`] if a rule is invalid (a bug).
pub fn standard_throttle() -> Result<sakalya_throttle::Throttle, sakalya_throttle::ConfigError> {
    standard_throttle_with(None)
}

/// [`standard_throttle`], plus a bypass token: requests carrying it in
/// [`sakalya_throttle::BYPASS_HEADER`] skip every rule. For end-to-end suites and canaries, which
/// sign in far more often than any person; the server only accepts one in the `local`
/// environment until canaries need it deployed.
///
/// # Errors
/// [`sakalya_throttle::ConfigError`] if a rule is invalid (a bug) or the token is shorter than
/// 32 bytes.
pub fn standard_throttle_with(
    bypass: Option<secrecy::SecretString>,
) -> Result<sakalya_throttle::Throttle, sakalya_throttle::ConfigError> {
    use sakalya_throttle::{KeyKind, RuleConfig, Throttle, ThrottleConfig};
    let config = ThrottleConfig::default().with_rules(vec![
        RuleConfig::new("ip", KeyKind::Ip, 600, 60),
        RuleConfig::new("ip-dev-sign-in", KeyKind::Ip, 30, 15 * 60).on_paths(&["/api/v1/dev/"]),
        // Handoff codes are random 32-byte secrets, but guessing is still throttled hard.
        RuleConfig::new("ip-handoff-redeem", KeyKind::Ip, 20, 10 * 60)
            .on_paths(&["/api/v1/auth/handoff/redeem"]),
        RuleConfig::new("ip-handoff", KeyKind::Ip, 60, 10 * 60).on_paths(&["/api/v1/auth/handoff"]),
        // Errors from the web apps: a failing page may retry in a loop.
        RuleConfig::new("ip-client-errors", KeyKind::Ip, 20, 60)
            .on_paths(&["/api/v1/client-errors"]),
        RuleConfig::new("ip-registration", KeyKind::Ip, 5, 60 * 60)
            .on_paths(&["/api/v1/registrations"]),
        // Public booking: reads (doctors, slots) are cheap but unauthenticated, so capped per IP;
        // bookings are capped per IP here and per verified person in the handler.
        RuleConfig::new("ip-public-booking-read", KeyKind::Ip, 60, 60)
            .on_paths(&["/api/v1/public/booking", "/api/v1/public/availability"])
            .on_methods(&["GET"]),
        // The clinic website and its pictures: one page view is the site plus its pictures.
        RuleConfig::new("ip-public-site", KeyKind::Ip, 300, 60)
            .on_paths(&["/api/v1/public/site"])
            .on_methods(&["GET"]),
        RuleConfig::new("ip-public-booking", KeyKind::Ip, 10, 60 * 60)
            .on_paths(&["/api/v1/public/bookings"])
            .on_methods(&["POST"]),
        RuleConfig::new("public-booking-identity", KeyKind::Custom, 6, 60 * 60),
        // The patient app: link codes are 50-bit secrets, but guessing is throttled per IP and
        // per account; bookings from the app count with the public page's.
        RuleConfig::new("ip-patient-link", KeyKind::Ip, 20, 10 * 60)
            .on_paths(&[
                "/api/v1/me/patient/links",
                "/api/v1/me/patient/link-requests",
            ])
            .on_methods(&["POST"]),
        RuleConfig::new("patient-link-account", KeyKind::Custom, 10, 60 * 60),
        RuleConfig::new("ip-patient-booking", KeyKind::Ip, 10, 60 * 60)
            .on_paths(&["/api/v1/me/patient/bookings"])
            .on_methods(&["POST"]),
    ]);
    Throttle::new(match bypass {
        Some(token) => config.with_bypass_token(token),
        None => config,
    })
}

/// Builds the API: `GET /healthz`, the routes under `/api/v1`, and the standard middleware
/// (request IDs, the edge check, the request span, panic recovery, timeouts, body limits).
/// The development sign-in and outbox drain routes exist only when the state holds development
/// tokens, which the server allows only in the `local` environment.
pub fn router(state: AppState) -> Router {
    let http = state.http().clone();
    let local_dev = state.dev_tokens().is_some();
    let metrics = std::sync::Arc::clone(state.metrics());
    let clients = std::sync::Arc::clone(state.client_policy());
    let throttle = state.throttle().cloned();
    let reporting = state.error_reporting().cloned();
    let mut routes = Router::new()
        .nest("/api/v1", v1::routes(local_dev))
        .with_state(state)
        // Old apps are told to update before anything else looks at their request.
        .layer(axum::middleware::from_fn_with_state(
            clients,
            client_gate::client_gate,
        ));
    if let Some(throttle) = throttle {
        // Inside the standard layers, so the edge has already established the client IP.
        routes = routes.layer(axum::middleware::from_fn_with_state(
            throttle,
            sakalya_throttle::before_auth,
        ));
    }
    let routes = routes.merge(sakalya_http::health_routes());
    // Outside the standard layers, so timeouts and panics they turn into responses are counted.
    let app = sakalya_http::with_standard_layers(routes, &http).layer(
        axum::middleware::from_fn_with_state(metrics, metrics::track),
    );
    match reporting {
        // Outermost, so it sees the 500s the standard layers make from panics and timeouts.
        Some(reporting) => app.layer(axum::middleware::from_fn_with_state(
            reporting,
            error_report::report_server_errors,
        )),
        None => app,
    }
}
