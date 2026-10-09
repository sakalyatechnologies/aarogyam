//! The patient app's own sessions, on the app host: where the patient is signed in, and signing
//! one out. A signed-out session gets `401` on its next request.

use aarogyam_app::patient_sessions as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PatientSessionId;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::ApiPath;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::PatientRequest;
use crate::failure::ApiFailure;

/// A place the patient is signed in.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientSession {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// When it signed in (RFC 3339).
    pub created_at: String,
    /// When it was last used, to within five minutes (RFC 3339).
    pub last_active_at: String,
    /// When the sign-in expires unless refreshed (RFC 3339).
    pub expires_at: String,
    /// The session making this request.
    pub current: bool,
}

/// The patient's sessions.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientSessionList {
    /// Live sessions, most recently used first, at most 50.
    pub items: Vec<PatientSession>,
}

/// Where the signed-in patient is signed in.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/sessions",
    operation_id = "listMyPatientSessions",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientSessionList),
        (status = 401, description = "Not signed in, or this session was signed out"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<PatientSessionList>, ApiFailure> {
    let rows = app::list(state.db(), request.access.account_id, request.session_id).await?;
    Ok(Json(PatientSessionList {
        items: rows
            .into_iter()
            .map(|row| PatientSession {
                id: row.id,
                created_at: rfc3339(row.created_at),
                last_active_at: rfc3339(row.last_active_at),
                expires_at: rfc3339(row.expires_at),
                current: row.is_current,
            })
            .collect(),
    }))
}

/// Signs out one of the patient's sessions; it gets `401` from its next request.
#[utoipa::path(
    delete,
    path = "/api/v1/me/patient/sessions/{id}",
    operation_id = "revokeMyPatientSession",
    tag = "patient",
    params(("id" = String, Path, description = "The session")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Signed out"),
        (status = 401, description = "Not signed in, or this session was signed out"),
        (status = 404, description = "Not one of this patient's sessions, or not the app host")
    )
)]
pub(crate) async fn revoke(
    State(state): State<AppState>,
    request: PatientRequest,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let session = PatientSessionId::from_uuid(id);
    app::revoke(state.db(), request.access.account_id, session).await?;
    tracing::info!(
        event = Event::PatientSessionRevoked.as_str(),
        patient_account_id = %request.access.account_id.uuid(),
        session_id = %id,
        "patient session signed out"
    );
    Ok(StatusCode::NO_CONTENT)
}
