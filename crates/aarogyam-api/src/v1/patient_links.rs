//! The clinic's side of the patient app, on Patient 360: who has app access to a record,
//! "Invite to patient app" (a link code shown as a QR code and emailed through the outbox),
//! confirming or declining a match the patient asked for, revoking a link, and sharing a file
//! with the patient.

use aarogyam_app::patient_app::{self as app, Decision};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AttachmentId, PatientId, PatientLinkId};
use aarogyam_domain::permission::require::{ClinicalWrite, PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A patient account's link to this record.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientAppLink {
    /// The link.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `pending` (the patient asked; confirm or decline), `active`, `declined` or `revoked`.
    pub status: String,
    /// `code` or `clinic_confirmed`.
    pub linked_via: String,
    /// The email the patient signed in with; masked without `patients.contact`.
    pub account_email: String,
    /// When the patient consented (RFC 3339).
    pub consented_at: String,
    /// When it became active (RFC 3339).
    pub linked_at: Option<String>,
    /// When it was revoked (RFC 3339).
    pub revoked_at: Option<String>,
}

/// A record's patient-app access.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientAppAccess {
    /// Links, open ones first.
    pub links: Vec<PatientAppLink>,
    /// When the unused code expires, if one is waiting (RFC 3339).
    pub code_expires_at: Option<String>,
    /// Whether the record has an email; an invitation needs one, since the patient signs in with it.
    pub has_email: bool,
}

/// Who has patient-app access to this record, and whether a code is waiting.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/app-access",
    operation_id = "getPatientAppAccess",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientAppAccess),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn access(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientAppAccess>, ApiFailure> {
    let found = app::app_access(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(PatientAppAccess {
        links: found
            .links
            .into_iter()
            .map(|link| PatientAppLink {
                id: link.id.uuid(),
                status: link.status.as_str().to_owned(),
                linked_via: link.linked_via,
                account_email: link.account_email,
                consented_at: rfc3339(link.consented_at),
                linked_at: link.linked_at.map(rfc3339),
                revoked_at: link.revoked_at.map(rfc3339),
            })
            .collect(),
        code_expires_at: found.code_expires_at.map(rfc3339),
        has_email: found.has_email,
    }))
}

/// A new link code, shown once.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientAppInvitation {
    /// The code, `XXXXX-XXXXX`: show it as text and as a QR code. It is not shown again.
    pub code: String,
    /// When it stops working (RFC 3339).
    pub expires_at: String,
    /// Whether the email with the code was queued to the address on the record.
    pub emailed: bool,
}

/// "Invite to patient app": makes sure the patient can sign in with the email on their record,
/// issues a link code (replacing any unused one) and emails it through the outbox.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/app-invitations",
    operation_id = "invitePatientToApp",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 201, body = PatientAppInvitation),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "The record has no email, or the clinic no portal address"),
        (status = 503, description = "Supabase could not create the sign-in account")
    )
)]
pub(crate) async fn invite(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<(StatusCode, Json<PatientAppInvitation>), ApiFailure> {
    let invited = app::invite(
        state.db(),
        state.accounts(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    if !invited.account_ready {
        tracing::warn!(patient_id = %id, "Supabase admin is not configured: no sign-in account was created for the patient");
    }
    tracing::info!(event = Event::PatientAppInvited.as_str(), patient_id = %id, "patient invited to the app");
    Ok((
        StatusCode::CREATED,
        Json(PatientAppInvitation {
            code: invited.code,
            expires_at: rfc3339(invited.expires_at),
            emailed: invited.emailed,
        }),
    ))
}

/// A link's status after the clinic's decision.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientLinkDecided {
    /// The link.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `active`, `declined` or `revoked`.
    pub status: String,
}

async fn decide(
    state: &AppState,
    request: &crate::extract::ClinicRequest,
    id: Uuid,
    decision: Decision,
) -> Result<Json<PatientLinkDecided>, ApiFailure> {
    let status = app::decide(
        state.db(),
        &request.actor,
        request.request_id,
        PatientLinkId::from_uuid(id),
        decision,
    )
    .await?;
    let event = if decision == Decision::Confirm {
        Event::PatientLinked
    } else {
        Event::PatientLinkEnded
    };
    tracing::info!(event = event.as_str(), link_id = %id, by = "clinic", "patient link decided");
    Ok(Json(PatientLinkDecided {
        id,
        status: status.as_str().to_owned(),
    }))
}

/// Confirms a match the patient asked for: the record appears in their app.
#[utoipa::path(
    post,
    path = "/api/v1/patient-links/{id}/confirm",
    operation_id = "confirmPatientLink",
    tag = "patients",
    params(("id" = String, Path, description = "The link")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientLinkDecided),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No pending link with this id in this clinic"),
        (status = 409, description = "The record is already linked to an app account")
    )
)]
pub(crate) async fn confirm(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientLinkDecided>, ApiFailure> {
    decide(&state, &request, id, Decision::Confirm).await
}

/// Declines a match the patient asked for.
#[utoipa::path(
    post,
    path = "/api/v1/patient-links/{id}/decline",
    operation_id = "declinePatientLink",
    tag = "patients",
    params(("id" = String, Path, description = "The link")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientLinkDecided),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No pending link with this id in this clinic")
    )
)]
pub(crate) async fn decline(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientLinkDecided>, ApiFailure> {
    decide(&state, &request, id, Decision::Decline).await
}

/// Ends an active link: the record leaves the patient's app.
#[utoipa::path(
    post,
    path = "/api/v1/patient-links/{id}/revoke",
    operation_id = "revokePatientLinkByClinic",
    tag = "patients",
    params(("id" = String, Path, description = "The link")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientLinkDecided),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No active link with this id in this clinic")
    )
)]
pub(crate) async fn revoke(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientLinkDecided>, ApiFailure> {
    decide(&state, &request, id, Decision::Revoke).await
}

/// Whether a file is shared with the patient.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct FileSharing {
    /// True to show it in the patient's app.
    pub shared_with_patient: bool,
}

/// Shares a file with the patient in their app, or stops sharing it. Voice recordings are
/// never shared.
#[utoipa::path(
    put,
    path = "/api/v1/attachments/{id}/sharing",
    operation_id = "setAttachmentSharing",
    tag = "patients",
    params(("id" = String, Path, description = "The file")),
    request_body = FileSharing,
    security(("bearer" = [])),
    responses(
        (status = 200, body = FileSharing),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such file in this clinic")
    )
)]
pub(crate) async fn set_sharing(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<FileSharing>,
) -> Result<Json<FileSharing>, ApiFailure> {
    app::set_file_shared(
        state.db(),
        &request.actor,
        request.request_id,
        AttachmentId::from_uuid(id),
        body.shared_with_patient,
    )
    .await?;
    tracing::info!(
        event = Event::AttachmentSharingChanged.as_str(),
        attachment_id = %id,
        shared = body.shared_with_patient,
        "file sharing changed"
    );
    Ok(Json(body))
}
