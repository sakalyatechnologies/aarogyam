//! How failures become HTTP answers. Every answer is `sakalya_http::ApiError` JSON; nothing
//! reveals patient data, and "not a member" looks the same as "doesn't exist".

use aarogyam_app::AppError;
use aarogyam_domain::access::Denied;
use axum::response::{IntoResponse, Response};
use sakalya_auth::AuthError;
use sakalya_db::DbError;
use sakalya_http::ApiError;

/// A handler or extractor failure. Wraps [`ApiError`] so use-case errors convert with `?`.
#[derive(Debug)]
pub struct ApiFailure(pub ApiError);

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        self.0.into_response()
    }
}

impl From<ApiError> for ApiFailure {
    fn from(error: ApiError) -> Self {
        Self(error)
    }
}

impl From<DbError> for ApiFailure {
    fn from(error: DbError) -> Self {
        Self(error.into())
    }
}

impl From<AuthError> for ApiFailure {
    fn from(error: AuthError) -> Self {
        Self(error.into())
    }
}

impl From<Denied> for ApiFailure {
    fn from(denied: Denied) -> Self {
        Self(match denied {
            // Not telling an outsider whether a clinic or a record exists.
            Denied::UnknownClinic | Denied::NotAMember => not_found(),
            Denied::SessionRevoked => ApiError::unauthenticated(),
            Denied::UserDisabled => {
                ApiError::forbidden("account_disabled", "This account is disabled.")
            }
            Denied::MissingPermission(permission) => ApiError::forbidden(
                "forbidden",
                format!("Your role doesn't allow {permission}."),
            ),
        })
    }
}

impl From<AppError> for ApiFailure {
    fn from(error: AppError) -> Self {
        match error {
            AppError::Denied(denied) => denied.into(),
            AppError::NotFound(_) => Self(not_found()),
            AppError::Invalid { field, message } => Self(ApiError::bad_request(
                "invalid_request",
                format!("{field}: {message}"),
            )),
            AppError::Conflict(message) => Self(ApiError::conflict("conflict", message)),
            AppError::Forbidden(message) => Self(ApiError::forbidden("forbidden", message)),
            AppError::Db(error) => error.into(),
            AppError::Internal(what) => Self(ApiError::internal(what)),
        }
    }
}

/// The one "not found" answer, for unknown clinics, non-members and missing records alike.
pub(crate) fn not_found() -> ApiError {
    ApiError::not_found("not_found", "Not found.")
}
