//! How failures become HTTP answers. Every answer is `sakalya_http::ApiError` JSON; nothing
//! reveals patient data, and "not a member" looks the same as "doesn't exist".

use aarogyam_app::AppError;
use aarogyam_domain::access::Denied;
use axum::Json;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_auth::AuthError;
use sakalya_db::DbError;
use sakalya_http::ApiError;
use serde::Serialize;
use utoipa::ToSchema;

/// A handler or extractor failure. Wraps [`ApiError`] so use-case errors convert with `?`.
#[derive(Debug)]
pub enum ApiFailure {
    /// An ordinary failure: the status and the `{"error": {code, message}}` body come from it.
    Error(ApiError),
    /// `409`: the record's state doesn't allow the move, and `current` is the record as it is.
    Refused {
        /// What is wrong, without patient data.
        message: String,
        /// The record, in the shape the move returns when it succeeds.
        current: serde_json::Value,
    },
    /// `412`: `If-Match` names a version the record no longer has.
    Stale {
        /// The record's version now, sent back as the `ETag`.
        current: i64,
    },
}

impl ApiFailure {
    /// A `409` for a move the record's state doesn't allow, carrying the record as it is.
    pub fn refused(message: impl Into<String>, current: &impl Serialize) -> Self {
        Self::Refused {
            message: message.into(),
            current: serde_json::to_value(current).unwrap_or(serde_json::Value::Null),
        }
    }
}

/// What went wrong, as every error answer sends it.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorDetail {
    /// A stable code to branch on, such as `conflict`.
    pub code: String,
    /// A message for people, without patient data.
    pub message: String,
}

/// The `409` answer to a move the record's state doesn't allow (an appointment that is already
/// cancelled can't arrive): the usual error and the record as it is, so the client can show it.
#[derive(Debug, Serialize, ToSchema)]
pub struct MoveRefused {
    /// The refusal.
    pub error: ErrorDetail,
    /// The record as it is, in the shape the move returns when it succeeds.
    #[schema(value_type = Object)]
    pub current: serde_json::Value,
}

impl IntoResponse for ApiFailure {
    fn into_response(self) -> Response {
        match self {
            Self::Error(error) => error.into_response(),
            Self::Refused { message, current } => {
                tracing::debug!(code = "conflict", "request rejected");
                let body = MoveRefused {
                    error: ErrorDetail {
                        code: "conflict".to_owned(),
                        message,
                    },
                    current,
                };
                (StatusCode::CONFLICT, Json(body)).into_response()
            }
            Self::Stale { current } => {
                tracing::debug!(code = "stale_version", "request rejected");
                let body = serde_json::json!({ "error": {
                    "code": "stale_version",
                    "message": "The record changed since you read it; read it again before editing.",
                } });
                (
                    StatusCode::PRECONDITION_FAILED,
                    [(header::ETAG, format!("\"{current}\""))],
                    Json(body),
                )
                    .into_response()
            }
        }
    }
}

impl From<ApiError> for ApiFailure {
    fn from(error: ApiError) -> Self {
        Self::Error(error)
    }
}

impl From<DbError> for ApiFailure {
    fn from(error: DbError) -> Self {
        Self::Error(error.into())
    }
}

impl From<AuthError> for ApiFailure {
    fn from(error: AuthError) -> Self {
        Self::Error(error.into())
    }
}

impl From<Denied> for ApiFailure {
    fn from(denied: Denied) -> Self {
        Self::Error(match denied {
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
            AppError::NotFound(_) => Self::Error(not_found()),
            AppError::Invalid { field, message } => Self::Error(ApiError::bad_request(
                "invalid_request",
                format!("{field}: {message}"),
            )),
            AppError::Conflict(message) => Self::Error(ApiError::conflict("conflict", message)),
            AppError::IdConflict => Self::Error(ApiError::conflict(
                "id_conflict",
                "That id is already used by a different record.",
            )),
            AppError::VisitClosed => Self::Error(ApiError::conflict(
                "visit_closed",
                "This visit is already closed. Open it to see how it ended.",
            )),
            AppError::Stale { current } => Self::Stale { current },
            AppError::Forbidden(message) => Self::Error(ApiError::forbidden("forbidden", message)),
            AppError::Db(error) => error.into(),
            AppError::Internal(what) => Self::Error(ApiError::internal(what)),
            AppError::Accounts(error) => Self::Error(ApiError::unavailable(error)),
        }
    }
}

/// The one "not found" answer, for unknown clinics, non-members and missing records alike.
pub(crate) fn not_found() -> ApiError {
    ApiError::not_found("not_found", "Not found.")
}
