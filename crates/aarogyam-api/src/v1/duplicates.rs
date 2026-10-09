//! Possible duplicate patients from online booking, dismissing a flag, and merging a
//! self-registered record into an existing patient.

use aarogyam_app::duplicates::{self as app, DuplicateView};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_id, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// One of the two records.
#[derive(Debug, Serialize, ToSchema)]
pub struct DuplicateSide {
    /// The patient.
    pub id: String,
    /// Their number.
    pub number: String,
    /// Their name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Age in whole years, when known.
    pub age_years: Option<u16>,
}

/// A self-registered record that may be an existing patient.
#[derive(Debug, Serialize, ToSchema)]
pub struct PossibleDuplicate {
    /// The flag.
    pub id: String,
    /// Why: `phone` (same phone, no email match).
    pub reason: String,
    /// When it was flagged (RFC 3339).
    pub flagged_at: String,
    /// The self-registered record from online booking.
    pub patient: DuplicateSide,
    /// The existing patient it may be.
    pub candidate: DuplicateSide,
}

impl From<DuplicateView> for PossibleDuplicate {
    fn from(view: DuplicateView) -> Self {
        let row = view.row;
        Self {
            id: row.id.to_string(),
            reason: row.reason,
            flagged_at: rfc3339(row.created_at),
            patient: DuplicateSide {
                id: row.patient_id.to_string(),
                number: row.patient_number,
                full_name: row.patient_name,
                sex: row.patient_sex,
                age_years: view.patient_age_years,
            },
            candidate: DuplicateSide {
                id: row.candidate_id.to_string(),
                number: row.candidate_number,
                full_name: row.candidate_name,
                sex: row.candidate_sex,
                age_years: view.candidate_age_years,
            },
        }
    }
}

/// Open possible duplicates.
#[derive(Debug, Serialize, ToSchema)]
pub struct DuplicateList {
    /// Newest first, at most 200.
    pub items: Vec<PossibleDuplicate>,
}

/// Self-registered records from online booking whose phone matches an existing patient, for
/// the front desk to merge or dismiss. Only flags whose two records are in reach.
#[utoipa::path(
    get,
    path = "/api/v1/patient-duplicates",
    operation_id = "listPatientDuplicates",
    tag = "patients",
    security(("bearer" = [])),
    responses(
        (status = 200, body = DuplicateList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
) -> Result<Json<DuplicateList>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(DuplicateList {
        items: rows.into_iter().map(PossibleDuplicate::from).collect(),
    }))
}

/// Dismisses a flag: the two records are different people.
#[utoipa::path(
    post,
    path = "/api/v1/patient-duplicates/{id}/dismiss",
    operation_id = "dismissPatientDuplicate",
    tag = "patients",
    params(("id" = String, Path, description = "The flag")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Dismissed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such open flag in this clinic")
    )
)]
pub(crate) async fn dismiss(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::dismiss(state.db(), &request.actor, request.request_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Which patient to merge into.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MergeRequest {
    /// The existing patient that keeps its number and record.
    pub into_patient_id: String,
}

/// What a merge did.
#[derive(Debug, Serialize, ToSchema)]
pub struct Merged {
    /// The patient that remains.
    pub patient_id: String,
    /// How many appointments moved to it.
    pub appointments_moved: i64,
}

/// Merges a self-registered record (from online booking) into an existing patient: its
/// appointments, queue tokens, patient-app links, identifiers and consents move, the existing
/// patient gets its email if it has none, and the record is marked merged. Refused when the
/// self-registered record has any clinical or billing record. Every change is audited.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/merge",
    operation_id = "mergePatient",
    tag = "patients",
    params(("id" = String, Path, description = "The self-registered record to merge away")),
    request_body = MergeRequest,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Merged),
        (status = 400, description = "Not a self-registered record, or the same patient"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "Already merged, or the record has clinical or billing data")
    )
)]
pub(crate) async fn merge(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<MergeRequest>,
) -> Result<Json<Merged>, ApiFailure> {
    let into = PatientId::from_uuid(parse_id("into_patient_id", &body.into_patient_id)?);
    let moved = app::merge(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        into,
    )
    .await?;
    tracing::info!(
        event = Event::PatientsMerged.as_str(),
        patient_id = %id,
        into_patient_id = %into.uuid(),
        appointments_moved = moved,
        "patient merged"
    );
    Ok(Json(Merged {
        patient_id: into.uuid().to_string(),
        appointments_moved: moved,
    }))
}
