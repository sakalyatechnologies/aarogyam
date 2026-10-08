//! Notice and consent records (DPDP Act 2023): that a patient was shown the clinic's notice and
//! agreed to a purpose, and that they later withdrew.

use aarogyam_app::consents::{self as app, ConsentView, Give};
use aarogyam_domain::consent::{Method, Purpose};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// One consent a patient gave, and whether it still stands.
#[derive(Debug, Serialize, ToSchema)]
pub struct Consent {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `care`, `reminders`, `promotional`, `sharing` or `research`.
    pub purpose: String,
    /// The clinic's label for the notice text the patient was shown.
    pub notice_version: String,
    /// When the patient agreed (RFC 3339).
    pub given_at: String,
    /// `paper`, `verbal` or `app`.
    pub method: String,
    /// The staff member who recorded it.
    pub recorded_by: String,
    /// `given` or `withdrawn`.
    pub status: String,
    /// When it was withdrawn (RFC 3339).
    pub withdrawn_at: Option<String>,
    /// The staff member who recorded the withdrawal.
    pub withdrawn_by: Option<String>,
    /// `paper`, `verbal` or `app`.
    pub withdrawn_method: Option<String>,
    /// A short remark.
    pub note: Option<String>,
    /// A short remark about the withdrawal.
    pub withdrawal_note: Option<String>,
}

impl From<ConsentView> for Consent {
    fn from(view: ConsentView) -> Self {
        Self {
            id: view.id,
            purpose: view.purpose.as_str().to_owned(),
            notice_version: view.notice_version,
            given_at: rfc3339(view.given_at),
            method: view.method.as_str().to_owned(),
            recorded_by: view.recorded_by,
            status: view.status.as_str().to_owned(),
            withdrawn_at: view.withdrawn_at.map(rfc3339),
            withdrawn_by: view.withdrawn_by,
            withdrawn_method: view
                .withdrawn_method
                .map(|method| method.as_str().to_owned()),
            note: view.note,
            withdrawal_note: view.withdrawal_note,
        }
    }
}

/// A patient's consents, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsentList {
    /// The consents, given and withdrawn.
    pub items: Vec<Consent>,
}

/// A consent to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RecordConsent {
    /// `care`, `reminders`, `promotional`, `sharing` or `research`.
    pub purpose: String,
    /// The clinic's label for the notice text shown, 1 to 40 characters, such as `v1 2026-10`.
    pub notice_version: String,
    /// How: `paper`, `verbal` or `app`.
    pub method: String,
    /// When the patient agreed (RFC 3339); now when absent. Not in the future.
    pub given_at: Option<String>,
    /// A short remark, up to 500 characters. No clinical detail.
    pub note: Option<String>,
}

/// A withdrawal to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct WithdrawConsent {
    /// How the patient withdrew: `paper`, `verbal` or `app`.
    pub method: String,
    /// A short remark, up to 500 characters.
    pub note: Option<String>,
}

/// The patient's consent records, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/consents",
    operation_id = "listPatientConsents",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ConsentList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ConsentList>, ApiFailure> {
    let items = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(ConsentList {
        items: items.into_iter().map(Consent::from).collect(),
    }))
}

/// Records that the patient was shown the clinic's notice and agreed to a purpose. The change
/// history records who entered it.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/consents",
    operation_id = "recordPatientConsent",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = RecordConsent,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Consent),
        (status = 400, description = "An unknown purpose or method, a bad version or note, or a time in the future"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach"),
        (status = 409, description = "The patient already has an active consent for that purpose; withdraw it first")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RecordConsent>,
) -> Result<(StatusCode, Json<Consent>), ApiFailure> {
    let input = Give {
        purpose: Purpose::parse(&body.purpose).map_err(|_| bad("purpose", "unknown value"))?,
        notice_version: body.notice_version,
        given_at: body
            .given_at
            .as_deref()
            .map(|text| parse_instant("given_at", text))
            .transpose()?,
        method: Method::parse(&body.method).map_err(|_| bad("method", "unknown value"))?,
        note: body.note,
    };
    let view = app::give(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        &input,
    )
    .await?;
    tracing::info!(
        event = Event::ConsentRecorded.as_str(),
        patient_id = %id,
        consent_id = %view.id,
        purpose = view.purpose.as_str(),
        "consent recorded"
    );
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Records that the patient withdrew a consent. The record stays as history.
#[utoipa::path(
    post,
    path = "/api/v1/consents/{id}/withdraw",
    operation_id = "withdrawPatientConsent",
    tag = "patients",
    params(("id" = String, Path, description = "The consent")),
    request_body = WithdrawConsent,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Consent),
        (status = 400, description = "An unknown method, or a bad note"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such consent in this clinic, or its patient is out of the role's reach"),
        (status = 409, description = "That consent was already withdrawn")
    )
)]
pub(crate) async fn withdraw(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<WithdrawConsent>,
) -> Result<Json<Consent>, ApiFailure> {
    let method = Method::parse(&body.method).map_err(|_| bad("method", "unknown value"))?;
    let view = app::withdraw(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        method,
        body.note.as_deref(),
    )
    .await?;
    tracing::info!(
        event = Event::ConsentWithdrawn.as_str(),
        consent_id = %id,
        purpose = view.purpose.as_str(),
        "consent withdrawn"
    );
    Ok(Json(view.into()))
}
