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
//!     portal_domain: "localtest.me".into(),
//!     console: "console.localtest.me".into(),
//!     app: "app.localtest.me".into(),
//! };
//! let app = router(AppState::new(db, HttpConfig::default(), tokens, hosts));
//! sakalya_http::serve(app, "127.0.0.1:8080".parse().expect("valid address")).await
//! # }
//! ```

mod cache;
mod dev;
mod extract;
mod failure;
pub mod metrics;
mod openapi;
mod state;
mod v1;

use axum::Router;

pub use dev::DevTokens;
pub use extract::{ClinicRequest, PlatformRequest, Require, SignedIn};
pub use failure::ApiFailure;
#[doc(inline)]
pub use openapi::openapi;
pub use state::{AppState, Hosts, TokenCheck};

/// Builds the API: `GET /healthz`, the routes under `/api/v1`, and the standard middleware
/// (request IDs, the edge check, the request span, panic recovery, timeouts, body limits).
/// The development sign-in route exists only when the state holds development tokens, which
/// the server allows only in the `local` environment.
pub fn router(state: AppState) -> Router {
    let http = state.http().clone();
    let local_dev = state.dev_tokens().is_some();
    let metrics = std::sync::Arc::clone(state.metrics());
    let throttle = state.throttle().cloned();
    let mut routes = Router::new()
        .nest("/api/v1", v1::routes(local_dev))
        .with_state(state);
    if let Some(throttle) = throttle {
        // Inside the standard layers, so the edge has already established the client IP.
        routes = routes.layer(axum::middleware::from_fn_with_state(
            throttle,
            sakalya_throttle::before_auth,
        ));
    }
    let routes = routes.merge(sakalya_http::health_routes());
    // Outside the standard layers, so timeouts and panics they turn into responses are counted.
    sakalya_http::with_standard_layers(routes, &http).layer(axum::middleware::from_fn_with_state(
        metrics,
        metrics::track,
    ))
}
