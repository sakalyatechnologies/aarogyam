//! Routes under `/api/v1`.

use axum::Router;

use crate::AppState;

/// The version 1 routes. Each module adds its routes here and lists them in the OpenAPI
/// document. Empty until the first module lands.
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
}
