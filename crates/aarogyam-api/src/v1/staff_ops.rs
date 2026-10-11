//! The clinic's staff-operations settings (time-off approval, task reminders).

use axum::Router;
use utoipa::OpenApi;

use crate::AppState;

/// The routes of this module; added in the staff-operations tasks.
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths())]
pub(crate) struct Doc;
