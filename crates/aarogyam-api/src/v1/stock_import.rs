//! Stock import: upload a CSV or Excel list of items and opening stock, see every row checked,
//! then commit the preview by its token.

use aarogyam_app::stock_import::{self as app, CommitOutcome, Preview, PreviewLine, Upload};
use aarogyam_app::tabular::MAX_FILE_BYTES;
use aarogyam_domain::permission::require::InventoryManage;
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartRejection};
use axum::http::StatusCode;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use super::rfc3339;
use super::smart_import::{bad_request, form_error, too_large};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Largest upload body: the file plus room for the other form fields.
pub(crate) const MAX_UPLOAD_BODY: usize = MAX_FILE_BYTES + 64 * 1024;

/// The upload form, for the OpenAPI document.
#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "describes the multipart form; never constructed")]
pub struct StockImportForm {
    /// The file: CSV (any delimiter) or Excel `.xlsx`, up to 5 MB and 1,000 rows, with a header
    /// row. Columns: name (required), category, unit, reorder level, max level, quantity, unit
    /// cost (rupees) or unit cost paise, batch, expiry, supplier.
    #[schema(value_type = String, format = Binary)]
    file: Vec<u8>,
    /// The workbook sheet to read; the first when left out.
    sheet: Option<String>,
}

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

/// A row that failed its checks.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockImportError {
    /// The row in the file, numbered as a spreadsheet numbers them.
    pub row: usize,
    /// The field.
    pub field: String,
    /// What is wrong.
    pub message: String,
}

impl From<aarogyam_domain::stock_import::RowError> for StockImportError {
    fn from(error: aarogyam_domain::stock_import::RowError) -> Self {
        Self {
            row: error.row,
            field: error.field,
            message: error.message,
        }
    }
}

/// A row that passed.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockImportRow {
    /// The row in the file.
    pub row: usize,
    /// The item's name.
    pub name: String,
    /// Units to receive; 0 when the row only describes the item.
    pub quantity: i64,
    /// The item will be created.
    pub new_item: bool,
}

impl From<PreviewLine> for StockImportRow {
    fn from(line: PreviewLine) -> Self {
        Self {
            row: line.row,
            name: line.name,
            quantity: line.quantity,
            new_item: line.new_item,
        }
    }
}

/// An uploaded list, checked and waiting to be committed.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockImportPreview {
    /// Commit with this token; it is shown once.
    pub token: String,
    /// The file's name.
    pub file_name: String,
    /// Data rows in the file.
    pub row_count: usize,
    /// Rows that passed.
    pub valid_rows: usize,
    /// Rows that failed; they are left out of the commit.
    pub error_rows: usize,
    /// Why they failed.
    pub errors: Vec<StockImportError>,
    /// The rows the commit will apply.
    pub rows: Vec<StockImportRow>,
    /// Items the commit creates.
    pub new_items: usize,
    /// Things worth knowing, such as the same file having been imported before.
    pub warnings: Vec<String>,
    /// When the preview ends unless committed.
    pub expires_at: String,
}

impl From<Preview> for StockImportPreview {
    fn from(preview: Preview) -> Self {
        Self {
            token: preview.token,
            file_name: preview.file_name,
            row_count: preview.row_count,
            valid_rows: preview.valid_rows,
            error_rows: preview.row_count - preview.valid_rows,
            errors: preview.errors.into_iter().map(Into::into).collect(),
            rows: preview.rows.into_iter().map(Into::into).collect(),
            new_items: preview.new_items,
            warnings: preview.warnings,
            expires_at: rfc3339(preview.expires_at),
        }
    }
}

/// Reads a CSV or Excel list of items and opening stock and checks every row. Nothing is
/// changed until the preview is committed.
#[utoipa::path(
    post,
    path = "/api/v1/stock/import",
    operation_id = "previewStockImport",
    tag = "inventory",
    request_body(content = StockImportForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 201, body = StockImportPreview),
        (status = 400, description = "The file can't be read, has no name column, no rows, or too many"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 413, description = "Larger than 5 MB")
    )
)]
pub(crate) async fn preview(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<(StatusCode, Json<StockImportPreview>), ApiFailure> {
    let form = form.map_err(|_| bad_request("send the file as multipart/form-data"))?;
    let upload = read_form(form).await?;
    let preview = app::preview(
        state.db(),
        &request.actor,
        request.request_id,
        upload,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = aarogyam_domain::event::Event::StockImportPreviewed.as_str(),
        rows = preview.row_count,
        errors = preview.errors.len(),
        "stock import checked"
    );
    Ok((StatusCode::CREATED, Json(preview.into())))
}

/// The preview to commit.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CommitStockImportBody {
    /// The token the preview gave.
    pub token: String,
}

/// What the commit did.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockImportResult {
    /// Items created.
    pub items_created: usize,
    /// Existing items whose values changed.
    pub items_updated: usize,
    /// Batches received.
    pub batches_received: usize,
    /// Units received in all.
    pub units_received: i64,
    /// Rows that could no longer be applied, because the clinic's items or suppliers changed
    /// since the preview.
    pub skipped: Vec<StockImportError>,
    /// This token had been committed before; nothing changed this time.
    pub replayed: bool,
}

impl From<CommitOutcome> for StockImportResult {
    fn from(outcome: CommitOutcome) -> Self {
        let result = outcome.result;
        Self {
            items_created: result.items_created,
            items_updated: result.items_updated,
            batches_received: result.batches_received,
            units_received: result.units_received,
            skipped: result.skipped.into_iter().map(Into::into).collect(),
            replayed: outcome.replayed,
        }
    }
}

/// Commits a stock import preview by its token: creates the new items, updates the values the
/// file gives for existing ones and receives each row's quantity as a batch. Committing the same
/// token again returns the first result and changes nothing.
#[utoipa::path(
    post,
    path = "/api/v1/stock/import/commit",
    operation_id = "commitStockImport",
    tag = "inventory",
    request_body = CommitStockImportBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = StockImportResult),
        (status = 400, description = "No token"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such preview in this clinic"),
        (status = 409, description = "The preview has expired")
    )
)]
pub(crate) async fn commit(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiJson(body): ApiJson<CommitStockImportBody>,
) -> Result<Json<StockImportResult>, ApiFailure> {
    if body.token.trim().is_empty() {
        return Err(bad_request("token: is required"));
    }
    let outcome = app::commit(
        state.db(),
        &request.actor,
        request.request_id,
        &body.token,
        OffsetDateTime::now_utc(),
    )
    .await?;
    if !outcome.replayed {
        tracing::info!(
            event = aarogyam_domain::event::Event::StockImportCommitted.as_str(),
            created = outcome.result.items_created,
            batches = outcome.result.batches_received,
            "stock import committed"
        );
    }
    Ok(Json(outcome.into()))
}
