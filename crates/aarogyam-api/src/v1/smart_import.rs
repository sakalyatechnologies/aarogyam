//! Smart import: upload a CSV or Excel file, map its columns (suggested automatically),
//! preview every row, import, and the to-do list of patients imported without some details.

use std::collections::BTreeMap;

use aarogyam_app::smart_import::{
    self as app, Choices, DuplicateOf, Gap, ImportOutcome, RowChoice, SessionView, Upload,
};
use aarogyam_app::tabular::MAX_FILE_BYTES;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ImportId, ImportSessionId, PatientGapId, PatientId};
use aarogyam_domain::import::ImportField;
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartError, MultipartRejection};
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath, ErrorKind};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Largest upload body: the file plus room for the other form fields.
pub(crate) const MAX_UPLOAD_BODY: usize = MAX_FILE_BYTES + 64 * 1024;

fn bad_request(message: impl Into<String>) -> ApiFailure {
    ApiFailure::Error(ApiError::bad_request("invalid_request", message.into()))
}

fn too_large() -> ApiFailure {
    ApiFailure::Error(ApiError::new(
        ErrorKind::PayloadTooLarge,
        "too_large",
        "file: must be at most 5 MB",
    ))
}

fn form_error(error: &MultipartError) -> ApiFailure {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        too_large()
    } else {
        bad_request("the form could not be read")
    }
}

/// The upload form, for the OpenAPI document.
#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "describes the multipart form; never constructed")]
pub struct ImportUploadForm {
    /// The file: CSV (any delimiter; UTF-8, UTF-16 or Windows-1252) or Excel `.xlsx`, up to
    /// 5 MB and 5,000 rows.
    #[schema(value_type = String, format = Binary)]
    file: Vec<u8>,
    /// The workbook sheet to read; the first when left out.
    sheet: Option<String>,
}

/// Reads the form, streaming the file and stopping as soon as it is too large.
async fn read_form(mut form: Multipart) -> Result<Upload, ApiFailure> {
    let mut upload = Upload::default();
    let mut has_file = false;
    while let Some(mut field) = form.next_field().await.map_err(|e| form_error(&e))? {
        let name = field.name().unwrap_or_default().to_owned();
        if name == "file" {
            upload.file_name = field.file_name().unwrap_or_default().to_owned();
            while let Some(chunk) = field.chunk().await.map_err(|e| form_error(&e))? {
                if upload.bytes.len() + chunk.len() > MAX_FILE_BYTES {
                    return Err(too_large());
                }
                upload.bytes.extend_from_slice(&chunk);
            }
            has_file = true;
            continue;
        }
        let text = field.text().await.map_err(|e| form_error(&e))?;
        let text = text.trim();
        match name.as_str() {
            "sheet" if !text.is_empty() => upload.sheet = Some(text.chars().take(100).collect()),
            "sheet" => {}
            _ => return Err(bad_request("unknown form field")),
        }
    }
    if has_file {
        Ok(upload)
    } else {
        Err(bad_request("file: is required"))
    }
}

/// A suggested field for one column.
#[derive(Debug, Serialize, ToSchema)]
pub struct ColumnSuggestion {
    /// Column index, from 0.
    pub column: usize,
    /// The column's header.
    pub header: String,
    /// Our field, or null when nothing matched.
    pub field: Option<String>,
    /// How sure, 0 to 100.
    pub confidence: u8,
    /// `saved` (mapped this way last time), `header_and_values`, `header`, `values` or `none`.
    pub basis: String,
}

/// An uploaded file ready to map. Its rows live only in this session: they are cleared on
/// import, on discard, or after 24 hours.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportSession {
    /// The session.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The file's name.
    pub file_name: String,
    /// `csv` or `xlsx`.
    pub kind: String,
    /// A workbook's sheets, in order; empty for CSV.
    pub sheets: Vec<String>,
    /// The sheet read.
    pub sheet: Option<String>,
    /// Row of the file holding the headers (found automatically, below any title rows).
    pub header_row: usize,
    /// The headers; blank ones are named `Column N`.
    pub headers: Vec<String>,
    /// Data rows under the header.
    pub row_count: usize,
    /// The first rows, one value per column; phones and emails hidden without
    /// `patients.contact`.
    pub sample: Vec<Vec<String>>,
    /// A suggestion for every column, in column order.
    pub suggestions: Vec<ColumnSuggestion>,
    /// When the session ends unless imported (RFC 3339).
    pub expires_at: String,
}

impl From<SessionView> for ImportSession {
    fn from(view: SessionView) -> Self {
        Self {
            id: view.id.uuid(),
            suggestions: view
                .suggestions
                .iter()
                .map(|s| ColumnSuggestion {
                    column: s.column,
                    header: view.headers[s.column].clone(),
                    field: s.field.map(|f| f.key().to_owned()),
                    confidence: s.confidence,
                    basis: s.basis.as_str().to_owned(),
                })
                .collect(),
            file_name: view.file_name,
            kind: view.kind.to_owned(),
            sheets: view.sheets,
            sheet: view.sheet,
            header_row: view.header_row,
            headers: view.headers,
            row_count: view.row_count,
            sample: view.sample,
            expires_at: rfc3339(view.expires_at),
        }
    }
}

/// Uploads a clinic's patient file (`multipart/form-data`, field `file`, optional `sheet`).
/// The header row is found automatically and each column gets a suggested field from its
/// header (English, Hindi or Marathi), its values, and what the clinic chose last time.
#[utoipa::path(
    post,
    path = "/api/v1/imports/sessions",
    operation_id = "uploadImportFile",
    tag = "patients",
    request_body(content = ImportUploadForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 201, body = ImportSession),
        (status = 400, description = "The file can't be read, has no rows, or the workbook has no such sheet"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 413, description = "Larger than 5 MB")
    )
)]
pub(crate) async fn upload(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<(StatusCode, Json<ImportSession>), ApiFailure> {
    let form = form.map_err(|_| bad_request("send the file as multipart/form-data"))?;
    let upload = read_form(form).await?;
    let view = app::upload(
        state.db(),
        &request.actor,
        request.request_id,
        upload,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// A choice for one row.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RowDecision {
    /// The row in the file.
    pub row: usize,
    /// `skip` (leave it out), `merge` (fill the matching record's empty details) or `import`
    /// (a different person).
    pub choice: String,
}

/// The clinic's mapping and choices.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ImportChoices {
    /// Our field to the column index (from 0). `full_name` is required. Fields: `full_name`,
    /// `sex`, `date_of_birth`, `age_years`, `phone`, `email`, `preferred_language`,
    /// `file_number`, `legacy_id`, `address`, `last_visit`, `balance` (recognised, not
    /// imported).
    pub mapping: BTreeMap<String, usize>,
    /// For rows with the same phone and name as an existing patient or an earlier row: `skip`
    /// (the default) or `merge`.
    #[serde(default)]
    pub duplicates: Option<String>,
    /// Choices for particular rows, overriding `duplicates`.
    #[serde(default)]
    pub rows: Vec<RowDecision>,
}

fn row_choice(text: &str, field: &str) -> Result<RowChoice, ApiFailure> {
    match text {
        "skip" => Ok(RowChoice::Skip),
        "merge" => Ok(RowChoice::Merge),
        "import" => Ok(RowChoice::Import),
        _ => Err(bad_request(format!(
            "{field}: must be skip, merge or import"
        ))),
    }
}

impl ImportChoices {
    fn parse(&self) -> Result<Choices, ApiFailure> {
        let mut mapping = BTreeMap::new();
        for (key, column) in &self.mapping {
            let field = ImportField::from_key(key)
                .ok_or_else(|| bad_request("mapping: names a field we don't import"))?;
            mapping.insert(field, *column);
        }
        let duplicates = match self.duplicates.as_deref() {
            None | Some("skip") => RowChoice::Skip,
            Some("merge") => RowChoice::Merge,
            Some(_) => return Err(bad_request("duplicates: must be skip or merge")),
        };
        let rows = self
            .rows
            .iter()
            .map(|d| Ok((d.row, row_choice(&d.choice, "rows")?)))
            .collect::<Result<_, ApiFailure>>()?;
        Ok(Choices {
            mapping,
            duplicates,
            rows,
        })
    }
}

/// The record a row duplicates.
#[derive(Debug, Serialize, ToSchema)]
pub struct DuplicateRef {
    /// An existing patient with the same phone and name.
    #[schema(value_type = Option<String>)]
    pub patient_id: Option<Uuid>,
    /// Their number.
    pub number: Option<String>,
    /// Or an earlier row of the file.
    pub row: Option<usize>,
}

/// One row's result.
#[derive(Debug, Serialize, ToSchema)]
pub struct SmartImportRow {
    /// Row in the file.
    pub row: usize,
    /// Preview: `import`, `merge`, `skip` or `fail`. Commit: `imported`, `merged`, `skipped`
    /// or `failed`.
    pub action: String,
    /// Details missing from a new patient (`phone`, `sex`, `date_of_birth`): they go on the
    /// front desk's to-do list.
    pub missing: Vec<String>,
    /// Why it can't be imported or was skipped, as `field: problem`. Never echoes values.
    pub errors: Vec<String>,
    /// Values left empty because they couldn't be read, as `field: problem`.
    pub warnings: Vec<String>,
    /// The record it duplicates.
    pub duplicate_of: Option<DuplicateRef>,
    /// Preview only: the values as they will be saved, by field (contact details hidden
    /// without `patients.contact`).
    pub values: BTreeMap<String, String>,
    /// The patient it became or was merged into, on commit.
    #[schema(value_type = Option<String>)]
    pub patient_id: Option<Uuid>,
    /// Their number, on commit.
    pub number: Option<String>,
}

/// A preview's or import's result.
#[derive(Debug, Serialize, ToSchema)]
pub struct SmartImportResult {
    /// The import, on commit.
    #[schema(value_type = Option<String>)]
    pub import_id: Option<Uuid>,
    /// Rows read.
    pub total: usize,
    /// New patients.
    pub imported: usize,
    /// Of those, missing some details.
    pub incomplete: usize,
    /// Merged into another record.
    pub merged: usize,
    /// Left out.
    pub skipped: usize,
    /// Can't be imported.
    pub failed: usize,
    /// Notes about the whole file.
    pub notes: Vec<String>,
    /// Every row, in file order.
    pub rows: Vec<SmartImportRow>,
}

fn result(outcome: ImportOutcome, committed: bool) -> SmartImportResult {
    SmartImportResult {
        import_id: outcome.import_id.map(ImportId::uuid),
        total: outcome.total,
        imported: outcome.imported,
        incomplete: outcome.incomplete,
        merged: outcome.merged,
        skipped: outcome.skipped,
        failed: outcome.failed,
        notes: outcome.notes,
        rows: outcome
            .rows
            .into_iter()
            .map(|row| SmartImportRow {
                row: row.line,
                action: row.action.as_str(committed).to_owned(),
                missing: row.missing.iter().map(|m| m.as_str().to_owned()).collect(),
                errors: row.errors,
                warnings: row.warnings,
                duplicate_of: row.duplicate_of.map(|d| match d {
                    DuplicateOf::Patient { id, number } => DuplicateRef {
                        patient_id: Some(id.uuid()),
                        number: Some(number),
                        row: None,
                    },
                    DuplicateOf::Row(line) => DuplicateRef {
                        patient_id: None,
                        number: None,
                        row: Some(line),
                    },
                }),
                values: row
                    .values
                    .into_iter()
                    .map(|(k, v)| (k.to_owned(), v))
                    .collect(),
                patient_id: row.patient_id.map(PatientId::uuid),
                number: row.number,
            })
            .collect(),
    }
}

/// Checks every row through the mapping and choices, and saves nothing. Unreadable values are
/// reported and left empty; only a row without a usable name can't be imported.
#[utoipa::path(
    post,
    path = "/api/v1/imports/sessions/{id}/preview",
    operation_id = "previewImport",
    tag = "patients",
    params(("id" = String, Path, description = "The import session")),
    request_body = ImportChoices,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SmartImportResult),
        (status = 400, description = "The mapping or a choice can't be used; the message says why"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such import session in this clinic"),
        (status = 409, description = "The session has ended or was already imported")
    )
)]
pub(crate) async fn preview(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ImportChoices>,
) -> Result<Json<SmartImportResult>, ApiFailure> {
    let choices = body.parse()?;
    let outcome = app::preview(
        state.db(),
        &request.actor,
        request.request_id,
        ImportSessionId::from_uuid(id),
        &choices,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(result(outcome, false)))
}

/// Imports the session in one transaction: new patients numbered from the clinic's sequence,
/// duplicates skipped or merged (filling only empty details), each row recorded with its file,
/// sheet and row, and patients missing details put on the to-do list. The mapping is
/// remembered for the next file. Sending it again returns the same result.
#[utoipa::path(
    post,
    path = "/api/v1/imports/sessions/{id}/commit",
    operation_id = "commitImport",
    tag = "patients",
    params(("id" = String, Path, description = "The import session")),
    request_body = ImportChoices,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SmartImportResult),
        (status = 400, description = "The mapping or a choice can't be used; the message says why"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such import session in this clinic"),
        (status = 409, description = "The session has ended")
    )
)]
pub(crate) async fn commit(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ImportChoices>,
) -> Result<Json<SmartImportResult>, ApiFailure> {
    let choices = body.parse()?;
    let outcome = app::commit(
        state.db(),
        &request.actor,
        request.request_id,
        ImportSessionId::from_uuid(id),
        &choices,
        OffsetDateTime::now_utc(),
    )
    .await?;
    if let Some(import_id) = outcome.import_id {
        tracing::info!(
            event = Event::PatientsImported.as_str(),
            import_id = %import_id.uuid(),
            imported = outcome.imported,
            incomplete = outcome.incomplete,
            merged = outcome.merged,
            skipped = outcome.skipped,
            failed = outcome.failed,
            "patients imported"
        );
    }
    Ok(Json(result(outcome, true)))
}

/// Ends an import session without importing, and clears its rows.
#[utoipa::path(
    delete,
    path = "/api/v1/imports/sessions/{id}",
    operation_id = "discardImport",
    tag = "patients",
    params(("id" = String, Path, description = "The import session")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Ended (or already ended)"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such import session in this clinic")
    )
)]
pub(crate) async fn discard(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::discard(
        state.db(),
        &request.actor,
        request.request_id,
        ImportSessionId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A patient missing some details: imported without them, or registered here with no age or sex.
#[derive(Debug, Serialize, ToSchema)]
pub struct IncompletePatient {
    /// The to-do entry, for dismissing; null for a patient registered here (not imported).
    #[schema(value_type = Option<String>)]
    pub id: Option<Uuid>,
    /// The patient.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// Their number.
    pub number: String,
    /// Their name.
    pub full_name: String,
    /// Still missing: `phone`, `sex`, `date_of_birth` (no date of birth and no age). Filling a
    /// detail removes it. Patients registered here are listed for `sex` and `date_of_birth` only.
    pub missing: Vec<String>,
    /// The file they came from.
    pub file_name: Option<String>,
    /// Its sheet.
    pub sheet: Option<String>,
    /// Their row in it; null when not imported.
    pub row: Option<usize>,
    /// When they were imported (RFC 3339); null when not imported.
    pub imported_at: Option<String>,
}

/// The front desk's to-do list.
#[derive(Debug, Serialize, ToSchema)]
pub struct IncompleteList {
    /// Imported patients (oldest import first), then patients registered here, at most 500.
    pub items: Vec<IncompletePatient>,
}

impl From<Gap> for IncompletePatient {
    fn from(gap: Gap) -> Self {
        Self {
            id: gap.id.map(sakalya_types::Id::uuid),
            patient_id: gap.patient_id.uuid(),
            number: gap.number,
            full_name: gap.full_name,
            missing: gap.missing.iter().map(|m| m.as_str().to_owned()).collect(),
            file_name: gap.file_name,
            sheet: gap.sheet_name,
            row: gap.row,
            imported_at: gap.imported_at.map(rfc3339),
        }
    }
}

/// Patients still missing details, for the front desk to complete.
#[utoipa::path(
    get,
    path = "/api/v1/imports/incomplete",
    operation_id = "listIncompletePatients",
    tag = "patients",
    security(("bearer" = [])),
    responses(
        (status = 200, body = IncompleteList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read")
    )
)]
pub(crate) async fn incomplete(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
) -> Result<Json<IncompleteList>, ApiFailure> {
    let gaps = app::gaps(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(IncompleteList {
        items: gaps.into_iter().map(IncompletePatient::from).collect(),
    }))
}

/// Takes a patient off the to-do list, when the missing details can't be had.
#[utoipa::path(
    post,
    path = "/api/v1/imports/incomplete/{id}/dismiss",
    operation_id = "dismissIncompletePatient",
    tag = "patients",
    params(("id" = String, Path, description = "The to-do entry")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Dismissed (or already dismissed)"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such entry in this clinic")
    )
)]
pub(crate) async fn dismiss(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::dismiss_gap(
        state.db(),
        &request.actor,
        request.request_id,
        PatientGapId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
