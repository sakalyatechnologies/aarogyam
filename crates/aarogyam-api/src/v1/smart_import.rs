//! Smart import: upload a CSV or Excel file, map its columns (suggested automatically),
//! preview every row, import, and the to-do list of patients imported without some details.

use std::collections::BTreeMap;

use aarogyam_app::files::DownloadRefusal;
use aarogyam_app::smart_import::{
    self as app, Choices, DuplicateOf, Gap, ImportFileView, ImportOutcome, RowChoice, SessionView,
    Upload,
};
use aarogyam_app::tabular::MAX_FILE_BYTES;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ImportId, ImportSessionId, PatientGapId, PatientId};
use aarogyam_domain::import::ImportField;
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartError, MultipartRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery, ErrorKind};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::files::{ContentQuery, DownloadLink};
use super::rfc3339;
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::{ApiFailure, not_found};

/// Largest upload body: the file plus room for the other form fields.
pub(crate) const MAX_UPLOAD_BODY: usize = MAX_FILE_BYTES + 64 * 1024;

pub(crate) fn bad_request(message: impl Into<String>) -> ApiFailure {
    ApiFailure::Error(ApiError::bad_request("invalid_request", message.into()))
}

pub(crate) fn too_large() -> ApiFailure {
    ApiFailure::Error(ApiError::new(
        ErrorKind::PayloadTooLarge,
        "too_large",
        "file: must be at most 5 MB",
    ))
}

pub(crate) fn form_error(error: &MultipartError) -> ApiFailure {
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

/// The original file of an import, kept for the clinic until it deletes it (and past 365 days
/// the retention report lists it).
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportFile {
    /// The name it was uploaded with.
    pub file_name: String,
    /// Its size in bytes.
    pub size_bytes: i64,
    /// `text/csv` or the `.xlsx` media type.
    pub mime_type: String,
    /// When it was stored (RFC 3339).
    pub stored_at: String,
}

impl From<ImportFileView> for ImportFile {
    fn from(file: ImportFileView) -> Self {
        Self {
            file_name: file.file_name,
            size_bytes: file.size_bytes,
            mime_type: file.mime_type,
            stored_at: rfc3339(file.stored_at),
        }
    }
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
    /// The original file, kept for the clinic: open it with
    /// `GET /imports/sessions/{id}/file/download`, delete it with
    /// `DELETE /imports/sessions/{id}/file`. Absent once deleted.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub file: Option<ImportFile>,
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
            file: view.file.map(ImportFile::from),
        }
    }
}

/// Uploads a clinic's patient file (`multipart/form-data`, field `file`, optional `sheet`).
/// The header row is found automatically and each column gets a suggested field from its
/// header (English, Hindi or Marathi), its values, and what the clinic chose last time. The
/// original file is kept (in India, in the clinic's file storage) until the clinic deletes it.
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
        state.files()?,
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
    /// `file_number`, `legacy_id`, `address`, `last_visit`, `balance` (an amount above zero
    /// becomes one issued "Opening balance (imported)" bill when the caller has
    /// `billing.write`).
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
    /// The opening balance in paise, as it is billed (rounded to the rupee): the amount the
    /// row carries in a preview, the bill made on commit. Only with `billing.read`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub opening_balance_paise: Option<i64>,
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
    /// Opening-balance bills: to be made (preview, `0` without `billing.write`) or made
    /// (commit).
    pub opening_bills: usize,
    /// Their total in paise. Only with `billing.read`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub opening_total_paise: Option<i64>,
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
        opening_bills: outcome.opening_bills,
        opening_total_paise: outcome.opening_total_paise,
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
                opening_balance_paise: row.opening_balance_paise,
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
/// sheet and row, and patients missing details put on the to-do list. A row with an amount in
/// the balance column gets one issued bill, "Opening balance (imported)", when the caller has
/// `billing.write` (at most 300 per file); without it the patients are imported and no bills
/// are made. The mapping is remembered for the next file. Sending it again returns the same
/// result and bills nothing more.
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
        (status = 400, description = "The mapping or a choice can't be used (or more than 300 rows have a balance); the message says why"),
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
            opening_bills = outcome.opening_bills,
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

/// Issues a five-minute download link for the original file of an import session. Needs the
/// permission that runs imports (`patients.write`).
#[utoipa::path(
    get,
    path = "/api/v1/imports/sessions/{id}/file/download",
    operation_id = "getImportFileDownloadLink",
    tag = "patients",
    params(("id" = String, Path, description = "The import session")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = DownloadLink),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such file in this clinic (or it was deleted)")
    )
)]
pub(crate) async fn file_link(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<DownloadLink>, ApiFailure> {
    let link = app::file_link(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        ImportSessionId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(DownloadLink {
        url: format!(
            "/api/v1/imports/sessions/{}/file/content?token={}",
            link.session.uuid(),
            link.token
        ),
        expires_at: rfc3339(link.expires_at),
    }))
}

/// Percent-encodes a file name for `filename*=UTF-8''...`.
fn percent_encode(name: &str) -> String {
    use std::fmt::Write as _;
    name.bytes().fold(String::new(), |mut out, byte| {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_') {
            out.push(char::from(byte));
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
        out
    })
}

/// Streams the original file through a signed link from
/// `GET /imports/sessions/{id}/file/download`. The link is the proof of access; it works on the
/// clinic's own host for five minutes.
#[utoipa::path(
    get,
    path = "/api/v1/imports/sessions/{id}/file/content",
    operation_id = "getImportFileContent",
    tag = "patients",
    params(
        ("id" = String, Path, description = "The import session"),
        ("token" = String, Query, description = "The signed token from the download link")
    ),
    responses(
        (status = 200, description = "The file, as an attachment"),
        (status = 403, description = "The link has expired; ask for a new one"),
        (status = 404, description = "Not a valid link for this file on this host")
    )
)]
pub(crate) async fn file_content(
    State(state): State<AppState>,
    host: ClinicHost,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ContentQuery>,
) -> Result<Response, ApiFailure> {
    let download = app::file_content(
        state.db(),
        state.files()?,
        host.clinic_id,
        host.request_id,
        ImportSessionId::from_uuid(id),
        &query.token,
        OffsetDateTime::now_utc(),
    )
    .await
    .map_err(|refusal| match refusal {
        DownloadRefusal::Expired => ApiFailure::Error(ApiError::forbidden(
            "link_expired",
            "This link has expired; ask for a new one.",
        )),
        DownloadRefusal::NotFound => ApiFailure::Error(not_found()),
        DownloadRefusal::Failed(error) => error.into(),
    })?;
    let extension = if download.mime_type == "text/csv" {
        "csv"
    } else {
        "xlsx"
    };
    let disposition = format!(
        "attachment; filename=\"import-{}.{extension}\"; filename*=UTF-8''{}",
        &id.simple().to_string()[..8],
        percent_encode(&download.file_name)
    );
    let mut response = download.bytes.into_response();
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&download.mime_type) {
        headers.insert(header::CONTENT_TYPE, value);
    }
    if let Ok(value) = HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    Ok(response)
}

/// Deletes the original file of an import session: its record and its stored copy. The
/// session and the patients it imported stay. Needs `patients.write`; recorded in the change
/// history.
#[utoipa::path(
    delete,
    path = "/api/v1/imports/sessions/{id}/file",
    operation_id = "deleteImportFile",
    tag = "patients",
    params(("id" = String, Path, description = "The import session")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Deleted (or already deleted)"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such import session in this clinic")
    )
)]
pub(crate) async fn delete_file(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let deleted = app::delete_file(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        ImportSessionId::from_uuid(id),
    )
    .await?;
    if deleted {
        tracing::info!(
            event = Event::ImportFileDeleted.as_str(),
            session_id = %id,
            "import file deleted"
        );
    }
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
