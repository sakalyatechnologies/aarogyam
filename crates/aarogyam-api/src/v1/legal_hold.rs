//! A patient's legal hold: while it is on, the erasure job never erases the patient, whatever
//! their retention period (a dispute, a court order, an insurer's claim).

use aarogyam_app::erasure as app;
use aarogyam_dal::legal_hold::HoldRow;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::require::SettingsManage;
use axum::Json;
use axum::extract::State;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A patient's legal hold.
#[derive(Debug, Serialize, ToSchema)]
pub struct LegalHold {
    /// Whether erasure is stopped.
    pub held: bool,
    /// Why, while held.
    pub reason: Option<String>,
    /// Since when, while held (RFC 3339).
    pub since: Option<String>,
}

impl From<HoldRow> for LegalHold {
    fn from(row: HoldRow) -> Self {
        Self {
            held: row.legal_hold,
            reason: row.reason,
            since: row.since.map(rfc3339),
        }
    }
}

/// Puts a patient on legal hold, or releases them.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetLegalHold {
    /// On or off.
    pub held: bool,
    /// Why, 3 to 300 characters; required when `held`. No clinical detail.
    pub reason: Option<String>,
}

/// Puts the patient on legal hold, which stops their erasure, or releases them. Holding again
/// keeps the first time and takes the new reason.
#[utoipa::path(
    put,
    path = "/api/v1/patients/{id}/legal-hold",
    operation_id = "setPatientLegalHold",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = SetLegalHold,
    security(("bearer" = [])),
    responses(
        (status = 200, body = LegalHold),
        (status = 400, description = "A missing or bad reason"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn set(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SetLegalHold>,
) -> Result<Json<LegalHold>, ApiFailure> {
    let reason = match (body.held, body.reason.as_deref()) {
        (true, Some(reason)) => Some(reason),
        (true, None) => return Err(bad("reason", "is required to hold").into()),
        (false, _) => None,
    };
    let row = app::set_legal_hold(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        reason,
    )
    .await?;
    tracing::info!(
        event = aarogyam_domain::event::Event::LegalHoldChanged.as_str(),
        patient_id = %id,
        held = row.legal_hold,
        "legal hold changed"
    );
    Ok(Json(row.into()))
}
