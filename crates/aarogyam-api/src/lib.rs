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
//! use aarogyam_api::{AppState, router};
//! use sakalya_http::HttpConfig;
//!
//! # async fn run(db: sakalya_db::Db) -> Result<(), sakalya_http::ServeError> {
//! let app = router(AppState::new(db, HttpConfig::default()));
//! sakalya_http::serve(app, "127.0.0.1:8080".parse().expect("valid address")).await
//! # }
//! ```

mod openapi;
mod v1;

use axum::Router;
use sakalya_db::Db;
use sakalya_http::HttpConfig;

#[doc(inline)]
pub use openapi::openapi;

/// What the routes can reach: the database handle and the HTTP limits. Cheap to clone.
#[derive(Debug, Clone)]
pub struct AppState {
    db: Db,
    http: HttpConfig,
}

impl AppState {
    /// Creates the state from the API's database handle and its HTTP limits.
    #[must_use]
    pub fn new(db: Db, http: HttpConfig) -> Self {
        Self { db, http }
    }

    /// The database handle that use cases open scoped transactions on.
    #[must_use]
    pub fn db(&self) -> &Db {
        &self.db
    }
}

/// Builds the API: `GET /healthz`, the routes under `/api/v1`, and the standard middleware.
pub fn router(state: AppState) -> Router {
    let http = state.http.clone();
    let routes = Router::new()
        .nest("/api/v1", v1::routes())
        .with_state(state)
        .merge(sakalya_http::health_routes());
    sakalya_http::with_standard_layers(routes, &http)
}
