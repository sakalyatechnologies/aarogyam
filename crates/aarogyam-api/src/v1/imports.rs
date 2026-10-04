//! Patient identifiers and patient imports.

use std::collections::BTreeMap;

use aarogyam_app::identifiers as identifiers_app;
use aarogyam_app::imports::{self as app, ImportMode};
use aarogyam_dal::identifiers::IdentifierRow;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ImportId, PatientId, PatientIdentifierId};
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Another number a patient is known by.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientIdentifier {
    /// The identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `file_number`, `legacy`, `smart_card`, `abha_number` or `abha_address`.
    pub kind: String,
    /// The number.
    pub value: String,
    /// When it was added (RFC 3339).
    pub created_at: String,
}

impl From<IdentifierRow> for PatientIdentifier {
    fn from(row: IdentifierRow) -> Self {
        Self {
            id: row.id,
            kind: row.kind,
            value: row.value,
            created_at: rfc3339(row.created_at),
        }
    }
}

/// A patient's identifiers.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientIdentifierList {
    /// By kind.
    pub items: Vec<PatientIdentifier>,
}

/// A patient's other numbers: file number, legacy ID, smart card, ABHA.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/identifiers",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientIdentifierList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn identifiers(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientIdentifierList>, ApiFailure> {
    let rows = identifiers_app::list(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(PatientIdentifierList {
        items: rows.into_iter().map(PatientIdentifier::from).collect(),
    }))
}

/// An identifier to add.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewIdentifier {
    /// `file_number`, `legacy`, `smart_card`, `abha_number` or `abha_address`.
    pub kind: String,
    /// The number, 1 to 64 characters.
    pub value: String,
}

/// Adds a number to a patient. Each number belongs to one patient per clinic and kind.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/identifiers",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = NewIdentifier,
    security(("bearer" = [])),
    responses(
        (status = 201, body = PatientIdentifier),
        (status = 400, description = "Unknown kind or bad value"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "Another patient already has this number")
    )
)]
pub(crate) async fn add_identifier(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewIdentifier>,
) -> Result<(StatusCode, Json<PatientIdentifier>), ApiFailure> {
    let row = identifiers_app::add(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        &body.kind,
        &body.value,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

/// Removes a number from a patient.
#[utoipa::path(
    delete,
    path = "/api/v1/patients/{id}/identifiers/{identifier_id}",
    tag = "patients",
    params(
        ("id" = String, Path, description = "The patient"),
        ("identifier_id" = String, Path, description = "The identifier")
    ),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such identifier in this clinic")
    )
)]
pub(crate) async fn remove_identifier(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath((id, identifier_id)): ApiPath<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiFailure> {
    identifiers_app::remove(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        PatientIdentifierId::from_uuid(identifier_id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A patient import.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PatientImport {
    /// The CSV text, header line first; at most 5,000 rows and 2 MB.
    pub csv: String,
    /// `preview` checks every row and saves nothing; `commit` saves the valid rows.
    pub mode: String,
    /// Our field to the file's column header (matched ignoring case). Fields: `full_name`
    /// (required), `sex`, `date_of_birth`, `age_years`, `phone`, `email`,
    /// `preferred_language`, `file_number`, `legacy_id`.
    pub mapping: BTreeMap<String, String>,
}

/// One row's result.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportRow {
    /// Line in the file (the header is line 1).
    pub line: usize,
    /// Whether the row is (or was) imported.
    pub valid: bool,
    /// What is wrong, as `field: problem`.
    pub errors: Vec<String>,
    /// The patient registered, on commit.
    #[schema(value_type = Option<String>)]
    pub patient_id: Option<Uuid>,
    /// Their new number, on commit.
    pub number: Option<String>,
}

/// An import's result.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportResult {
    /// `preview` or `commit`.
    pub mode: String,
    /// The recorded import, on commit.
    #[schema(value_type = Option<String>)]
    pub import_id: Option<Uuid>,
    /// Rows read.
    pub total: usize,
    /// Rows that are (or were) imported.
    pub valid: usize,
    /// Rows with errors.
    pub invalid: usize,
    /// Every row, in file order.
    pub rows: Vec<ImportRow>,
}

/// Imports patients from CSV. Preview checks every row like a registration; commit registers
/// the valid rows in one transaction with numbers from the clinic's sequence, keeps
/// `file_number` and `legacy_id` as identifiers, and records the import and each row's result.
#[utoipa::path(
    post,
    path = "/api/v1/imports/patients",
    tag = "patients",
    request_body = PatientImport,
    security(("bearer" = [])),
    responses(
        (status = 200, body = ImportResult),
        (status = 400, description = "The file or mapping can't be used; the message says why"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 413, description = "The request is too large")
    )
)]
pub(crate) async fn import_patients(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiJson(body): ApiJson<PatientImport>,
) -> Result<Json<ImportResult>, ApiFailure> {
    let mode = match body.mode.as_str() {
        "preview" => ImportMode::Preview,
        "commit" => ImportMode::Commit,
        _ => {
            return Err(ApiError::bad_request(
                "invalid_request",
                "mode: must be preview or commit",
            )
            .into());
        }
    };
    let outcome = app::import_patients(
        state.db(),
        &request.actor,
        request.request_id,
        &body.csv,
        &body.mapping,
        mode,
        OffsetDateTime::now_utc(),
    )
    .await?;
    if let Some(import_id) = outcome.import_id {
        tracing::info!(
            event = Event::PatientsImported.as_str(),
            import_id = %import_id.uuid(),
            imported = outcome.valid,
            failed = outcome.invalid,
            "patients imported"
        );
    }
    Ok(Json(ImportResult {
        mode: body.mode,
        import_id: outcome.import_id.map(ImportId::uuid),
        total: outcome.total,
        valid: outcome.valid,
        invalid: outcome.invalid,
        rows: outcome
            .rows
            .into_iter()
            .map(|row| ImportRow {
                line: row.line,
                valid: row.errors.is_empty(),
                errors: row.errors,
                patient_id: row.patient_id.map(PatientId::uuid),
                number: row.number,
            })
            .collect(),
    }))
}
