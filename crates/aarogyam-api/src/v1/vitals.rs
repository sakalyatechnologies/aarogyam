//! Vital signs: record readings in a visit, correct them by superseding, mark them entered in
//! error.

use aarogyam_app::vitals::{self as app, ObservationView, ReadingInput, RecordVitals};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{EncounterId, ObservationId};
use aarogyam_domain::permission::require::ClinicalWrite;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use super::visits::EnteredInError;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A measurement. Values never change: a correction is a new reading whose `supersedes_id`
/// names the old one, which stays with status `corrected`.
#[derive(Debug, Serialize, ToSchema)]
pub struct Observation {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The visit it was taken in.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// `bp_systolic`, `bp_diastolic`, `pulse`, `temperature`, `spo2`, `weight`, `height` or `blood_sugar`.
    pub kind: String,
    /// The value, to two decimal places.
    pub value: f64,
    /// UCUM unit: `mmHg`, `/min`, `Cel`, `[degF]`, `%`, `kg`, `cm` or `mg/dL`.
    pub unit: String,
    /// LOINC code.
    pub code: Option<String>,
    /// When it was measured (RFC 3339).
    pub recorded_at: String,
    /// `final`, `corrected` or `entered_in_error`.
    pub status: String,
    /// The reading this one corrects.
    #[schema(value_type = Option<String>)]
    pub supersedes_id: Option<Uuid>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// `clinician`, `assistant`, `patient` or `import`.
    pub source: String,
}

impl From<ObservationView> for Observation {
    fn from(view: ObservationView) -> Self {
        Self {
            id: view.id.uuid(),
            visit_id: view.visit_id.map(EncounterId::uuid),
            kind: view.kind.as_str().to_owned(),
            value: view.value,
            unit: view.unit.as_str().to_owned(),
            code: view.code,
            recorded_at: rfc3339(view.recorded_at),
            status: view.status,
            supersedes_id: view.supersedes_id.map(ObservationId::uuid),
            error_reason: view.error_reason,
            source: view.source,
        }
    }
}

/// Readings recorded together.
#[derive(Debug, Serialize, ToSchema)]
pub struct ObservationList {
    /// The new readings.
    pub items: Vec<Observation>,
}

/// One reading.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewReading {
    /// `bp_systolic`, `bp_diastolic`, `pulse`, `temperature`, `spo2`, `weight`, `height` or `blood_sugar`.
    pub kind: String,
    /// The value; checked against a plausible range for the kind and unit.
    pub value: f64,
    /// The unit; the kind's usual unit when left out (`Cel` for temperature, which also takes `[degF]`).
    pub unit: Option<String>,
    /// An earlier reading of the same patient and kind that this one corrects.
    #[schema(value_type = Option<String>)]
    pub supersedes_id: Option<Uuid>,
}

/// Readings taken together, such as a blood pressure pair and a pulse.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewReadings {
    /// 1 to 20 readings.
    pub readings: Vec<NewReading>,
    /// When they were taken (RFC 3339); now when left out.
    pub recorded_at: Option<String>,
    /// `clinician` (default), `assistant`, `patient` or `import`.
    pub source: Option<String>,
}

/// Records vital signs in a visit. A closed visit takes corrections only.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/observations",
    operation_id = "recordObservations",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = NewReadings,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ObservationList),
        (status = 400, description = "An implausible value, a wrong unit, or another patient's reading"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such visit in this clinic"),
        (status = 409, description = "The corrected reading isn't final, or the visit is closed")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewReadings>,
) -> Result<(StatusCode, Json<ObservationList>), ApiFailure> {
    let recorded_at = body
        .recorded_at
        .as_deref()
        .map(|text| OffsetDateTime::parse(text.trim(), &Rfc3339))
        .transpose()
        .map_err(|_| ApiError::bad_request("invalid_request", "recorded_at: must be RFC 3339"))?;
    let input = RecordVitals {
        readings: body
            .readings
            .into_iter()
            .map(|reading| ReadingInput {
                kind: reading.kind,
                value: reading.value,
                unit: reading.unit,
                supersedes_id: reading.supersedes_id,
            })
            .collect(),
        recorded_at,
        source: body.source,
    };
    let saved = app::record(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(ObservationList {
            items: saved.into_iter().map(Observation::from).collect(),
        }),
    ))
}

/// Marks a reading entered in error with a reason. It stays in the record, marked.
#[utoipa::path(
    post,
    path = "/api/v1/observations/{id}/entered-in-error",
    operation_id = "markObservationEnteredInError",
    tag = "clinical",
    params(("id" = String, Path, description = "The reading")),
    request_body = EnteredInError,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Observation),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such reading in this clinic"),
        (status = 409, description = "Already corrected or marked")
    )
)]
pub(crate) async fn in_error(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<EnteredInError>,
) -> Result<Json<Observation>, ApiFailure> {
    let view = app::mark_in_error(
        state.db(),
        &request.actor,
        request.request_id,
        ObservationId::from_uuid(id),
        &body.reason,
    )
    .await?;
    tracing::info!(event = Event::RecordRetracted.as_str(), observation_id = %id, "reading entered in error");
    Ok(Json(view.into()))
}
