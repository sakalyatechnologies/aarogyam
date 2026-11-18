//! Clinic expenses: record and attach a bill (`expenses.write`), list, void and download a
//! bill (`finance.view`).

use aarogyam_app::expenses::{self as app, BillUpload, ExpenseView, NewExpenseInput};
use aarogyam_app::files::DownloadRefusal;
use aarogyam_domain::event::Event;
use aarogyam_domain::expense::ExpenseCategoryKey;
use aarogyam_domain::ids::{AttachmentId, ExpenseId};
use aarogyam_domain::permission::require::{ExpensesWrite, FinanceView};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartRejection};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use sakalya_types::Paise;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::Reason;
use super::files::{ContentQuery, DownloadLink, bad_form, form_error, too_large};
use super::{parse_day, rfc3339};
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::{ApiFailure, not_found};

/// Largest bill upload body: the file (10 MB, as patient files) plus room for the form.
pub(crate) const MAX_UPLOAD_BODY: usize = aarogyam_domain::files::MAX_BYTES + 64 * 1024;

/// A system expense category. Stock deliveries count as `material` in analytics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExpenseCategory {
    /// Staff salaries.
    Salary,
    /// Materials bought outside stock.
    Material,
    /// Electricity.
    Electricity,
    /// Outside lab work.
    Lab,
    /// Rent.
    Rent,
    /// Anything else.
    Other,
}

impl From<ExpenseCategoryKey> for ExpenseCategory {
    fn from(key: ExpenseCategoryKey) -> Self {
        match key {
            ExpenseCategoryKey::Salary => Self::Salary,
            ExpenseCategoryKey::Material => Self::Material,
            ExpenseCategoryKey::Electricity => Self::Electricity,
            ExpenseCategoryKey::Lab => Self::Lab,
            ExpenseCategoryKey::Rent => Self::Rent,
            ExpenseCategoryKey::Other => Self::Other,
        }
    }
}

impl From<ExpenseCategory> for ExpenseCategoryKey {
    fn from(category: ExpenseCategory) -> Self {
        match category {
            ExpenseCategory::Salary => Self::Salary,
            ExpenseCategory::Material => Self::Material,
            ExpenseCategory::Electricity => Self::Electricity,
            ExpenseCategory::Lab => Self::Lab,
            ExpenseCategory::Rent => Self::Rent,
            ExpenseCategory::Other => Self::Other,
        }
    }
}

/// The bill of an expense: a photo or a PDF.
#[derive(Debug, Serialize, ToSchema)]
pub struct ExpenseBill {
    /// `image/jpeg`, `image/png` or `application/pdf`.
    pub mime_type: String,
    /// Bytes.
    pub size_bytes: i64,
    /// The name the uploader's device gave it, when it gave one.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

/// Money the clinic spent.
#[derive(Debug, Serialize, ToSchema)]
pub struct Expense {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// What it was for.
    pub category: ExpenseCategory,
    /// The category's name, such as `Rent`.
    pub category_name: String,
    /// The clinic day the money went out, `YYYY-MM-DD`.
    pub spent_on: String,
    /// Paise.
    pub amount_paise: i64,
    /// A note.
    pub note: Option<String>,
    /// How it was paid: `cash`, `upi`, `card` or `bank`. Absent when it was not recorded.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// The bill photo, when one was attached; fetch it with
    /// `GET /expenses/{id}/bill/download`. Absent when there is none.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bill: Option<ExpenseBill>,
    /// `recorded` or `void`.
    pub status: String,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided (RFC 3339).
    pub voided_at: Option<String>,
    /// The membership that recorded it.
    #[schema(value_type = String)]
    pub recorded_by: Uuid,
    /// When it was recorded (RFC 3339).
    pub created_at: String,
    /// The recurring expense that recorded it. Absent for one recorded by hand.
    #[schema(required = false, value_type = Option<String>)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurring_expense_id: Option<Uuid>,
}

impl From<ExpenseView> for Expense {
    fn from(view: ExpenseView) -> Self {
        Self {
            id: view.id.uuid(),
            category: view.category.into(),
            category_name: view.category_name,
            spent_on: view.spent_on.to_string(),
            amount_paise: view.amount.get(),
            note: view.note,
            method: view.method.map(|m| m.as_str().to_owned()),
            bill: view.bill.map(|b| ExpenseBill {
                mime_type: b.mime_type,
                size_bytes: b.size_bytes,
                file_name: b.file_name,
            }),
            status: view.status.as_str().to_owned(),
            void_reason: view.void_reason,
            voided_at: view.voided_at.map(rfc3339),
            recorded_by: view.recorded_by.uuid(),
            created_at: rfc3339(view.created_at),
            recurring_expense_id: view.recurring_expense_id.map(sakalya_types::Id::uuid),
        }
    }
}

/// Expenses.
#[derive(Debug, Serialize, ToSchema)]
pub struct ExpenseList {
    /// Newest day first, voided ones included.
    pub items: Vec<Expense>,
}

/// An expense to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewExpense {
    /// What it was for.
    pub category: ExpenseCategory,
    /// The clinic day, `YYYY-MM-DD`; today or earlier.
    pub spent_on: String,
    /// Paise, more than zero and at most 1,00,00,000 rupees.
    pub amount_paise: i64,
    /// Up to 300 characters.
    pub note: Option<String>,
    /// How it was paid: `cash`, `upi`, `card` or `bank`. Optional; nothing is assumed.
    pub method: Option<String>,
}

/// Records an expense. Send an `Idempotency-Key` header (a UUID per form) so a retry returns
/// the first expense (`200`) instead of recording another.
#[utoipa::path(
    post,
    path = "/api/v1/expenses",
    operation_id = "recordExpense",
    tag = "billing",
    request_body = NewExpense,
    params(("Idempotency-Key" = Option<String>, Header, description = "Unique per expense, 8 to 100 letters, digits, '-', '_', '.' or ':'; a retry sends the same key")),
    security(("bearer" = [])),
    responses(
        (status = 201, body = Expense, description = "Recorded"),
        (status = 200, body = Expense, description = "Already recorded with this key"),
        (status = 400, description = "Invalid input: amount, note, method, a day after today, or a malformed key"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 409, description = "The key was used for a different expense")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<NewExpense>,
) -> Result<(StatusCode, Json<Expense>), ApiFailure> {
    let idempotency_key = headers
        .get("idempotency-key")
        .map(|value| value.to_str().unwrap_or_default().to_owned());
    let spent_on = parse_day("spent_on", &body.spent_on)?;
    let (view, created) = app::record(
        state.db(),
        &request.actor,
        request.request_id,
        NewExpenseInput {
            category: body.category.into(),
            spent_on,
            amount: Paise::new(body.amount_paise),
            note: body.note,
            method: body.method,
            idempotency_key,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    if !created {
        return Ok((StatusCode::OK, Json(view.into())));
    }
    tracing::info!(event = Event::ExpenseRecorded.as_str(), expense_id = %view.id.uuid(), "expense recorded");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Filters for the expense list.
#[derive(Debug, Deserialize)]
pub struct ExpenseParams {
    /// First clinic day (`YYYY-MM-DD`).
    pub from: Option<String>,
    /// Last clinic day, included.
    pub to: Option<String>,
    /// Most rows, 1 to 500 (default 500).
    pub limit: Option<i64>,
}

/// Expenses spent on clinic days `from` to `to`, newest day first, voided ones included.
#[utoipa::path(
    get,
    path = "/api/v1/expenses",
    operation_id = "listExpenses",
    tag = "billing",
    params(
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD"),
        ("to" = Option<String>, Query, description = "Last clinic day, included"),
        ("limit" = Option<i64>, Query, description = "Most rows, 1 to 500 (default 500)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ExpenseList),
        (status = 400, description = "A bad date or a backwards range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiQuery(params): ApiQuery<ExpenseParams>,
) -> Result<Json<ExpenseList>, ApiFailure> {
    let from = params
        .from
        .as_deref()
        .map(|t| parse_day("from", t))
        .transpose()?;
    let to = params
        .to
        .as_deref()
        .map(|t| parse_day("to", t))
        .transpose()?;
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        from,
        to,
        params.limit.unwrap_or(app::MAX_LIST),
    )
    .await?;
    Ok(Json(ExpenseList {
        items: rows.into_iter().map(Expense::from).collect(),
    }))
}

/// Voids an expense with a reason; it stops counting in reports.
#[utoipa::path(
    post,
    path = "/api/v1/expenses/{id}/void",
    operation_id = "voidExpense",
    tag = "billing",
    params(("id" = String, Path, description = "The expense")),
    request_body = Reason,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Expense),
        (status = 400, description = "No reason given"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view"),
        (status = 404, description = "No such expense in this clinic"),
        (status = 409, description = "Already void")
    )
)]
pub(crate) async fn void(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<Reason>,
) -> Result<Json<Expense>, ApiFailure> {
    let view = app::void(
        state.db(),
        &request.actor,
        request.request_id,
        ExpenseId::from_uuid(id),
        &body.reason,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ExpenseVoided.as_str(), expense_id = %id, "expense voided");
    Ok(Json(view.into()))
}

/// The bill upload form.
#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "documents the multipart form for OpenAPI")]
pub struct ExpenseBillForm {
    /// A JPEG, PNG or PDF of at most 10 MB, checked by content.
    #[schema(value_type = String, format = Binary)]
    file: String,
}

/// Attaches a bill photo (or a PDF) as `multipart/form-data` field `file`: JPEG, PNG or PDF, up
/// to 10 MB, checked by content. Replaces the current bill, which is kept as superseded. Returns
/// the expense.
#[utoipa::path(
    post,
    path = "/api/v1/expenses/{id}/bill",
    operation_id = "uploadExpenseBill",
    tag = "billing",
    params(("id" = String, Path, description = "The expense")),
    request_body(content = ExpenseBillForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Expense),
        (status = 400, description = "Not a JPEG, PNG or PDF, or empty"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 404, description = "No such expense in this clinic"),
        (status = 409, description = "The expense is void"),
        (status = 413, description = "Larger than 10 MB")
    )
)]
pub(crate) async fn upload_bill(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<Json<Expense>, ApiFailure> {
    let mut form = form.map_err(|_| bad_form("send the file as multipart/form-data"))?;
    let mut upload = None;
    while let Some(field) = form.next_field().await.map_err(|e| form_error(&e))? {
        if field.name() == Some("file") {
            let file_name = field.file_name().map(str::to_owned);
            let bytes = field.bytes().await.map_err(|e| form_error(&e))?;
            if bytes.len() > aarogyam_domain::files::MAX_BYTES {
                return Err(too_large());
            }
            upload = Some(BillUpload {
                bytes: bytes.to_vec(),
                file_name,
            });
        } else {
            return Err(bad_form("unknown form field"));
        }
    }
    let upload = upload.ok_or_else(|| bad_form("file: is required"))?;
    let view = app::upload_bill(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        ExpenseId::from_uuid(id),
        upload,
    )
    .await?;
    tracing::info!(expense_id = %id, "expense bill attached");
    Ok(Json(view.into()))
}

/// Takes the bill off an expense that is not void. The file is kept as superseded.
#[utoipa::path(
    delete,
    path = "/api/v1/expenses/{id}/bill",
    operation_id = "removeExpenseBill",
    tag = "billing",
    params(("id" = String, Path, description = "The expense")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Expense),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 404, description = "No such expense in this clinic, or it has no bill"),
        (status = 409, description = "The expense is void")
    )
)]
pub(crate) async fn remove_bill(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Expense>, ApiFailure> {
    let view = app::remove_bill(
        state.db(),
        &request.actor,
        request.request_id,
        ExpenseId::from_uuid(id),
    )
    .await?;
    tracing::info!(expense_id = %id, "expense bill removed");
    Ok(Json(view.into()))
}

/// Issues a five-minute link to an expense's bill. A voided expense's bill stays readable.
#[utoipa::path(
    get,
    path = "/api/v1/expenses/{id}/bill/download",
    operation_id = "getExpenseBillDownloadLink",
    tag = "billing",
    params(("id" = String, Path, description = "The expense")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = DownloadLink),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view"),
        (status = 404, description = "No such expense in this clinic, or it has no bill")
    )
)]
pub(crate) async fn bill_link(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<DownloadLink>, ApiFailure> {
    let link = app::bill_link(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        ExpenseId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(DownloadLink {
        url: format!(
            "/api/v1/expense-files/{}/content?token={}",
            link.file_id.uuid(),
            link.token
        ),
        expires_at: rfc3339(link.expires_at),
    }))
}

/// Streams a bill file through a signed link from `GET /expenses/{id}/bill/download`. The link
/// is the proof of access (an `<img>` can use it); it works on the clinic's own host for five
/// minutes.
#[utoipa::path(
    get,
    path = "/api/v1/expense-files/{id}/content",
    operation_id = "getExpenseBillContent",
    tag = "public",
    params(
        ("id" = String, Path, description = "The file"),
        ("token" = String, Query, description = "The signed token from the download link")
    ),
    responses(
        (status = 200, description = "The file, with its media type"),
        (status = 403, description = "The link has expired; ask for a new one"),
        (status = 404, description = "Not a valid link for this file on this host")
    )
)]
pub(crate) async fn bill_content(
    State(state): State<AppState>,
    host: ClinicHost,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ContentQuery>,
) -> Result<Response, ApiFailure> {
    let download = app::bill_content(
        state.db(),
        state.files()?,
        host.clinic_id,
        host.request_id,
        AttachmentId::from_uuid(id),
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
    let disposition = format!(
        "inline; filename=\"bill-{}.{}\"",
        id.simple(),
        download.file_type.extension()
    );
    let mut response = download.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(download.file_type.mime_type()),
    );
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
