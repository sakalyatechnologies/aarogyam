//! Money paid to labs: record and void (`expenses.write` and `finance.view`), list
//! (`finance.view`). Each payment records, and voids with it, an expense in the `lab` category.

use aarogyam_app::files::DownloadRefusal;
use aarogyam_app::lab_payments::{self as app, NewPaymentInput, PaymentView, ProofUpload};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AttachmentId, LabOrderId, LabPaymentId, LabVendorId};
use aarogyam_domain::permission::require::{ExpensesWrite, FinanceView};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use sakalya_types::Paise;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::Reason;
use super::files::{ContentQuery, DownloadLink, bad_form, form_error, too_large};
use super::{optional_uuid, parse_day, rfc3339};
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::{ApiFailure, not_found};

/// Largest proof upload body: the file (10 MB, as patient files) plus room for the form.
pub(crate) const MAX_UPLOAD_BODY: usize = aarogyam_domain::files::MAX_BYTES + 64 * 1024;

/// The proof of a payment to a lab: a receipt photo, a UPI screenshot or a PDF.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabPaymentProof {
    /// `image/jpeg`, `image/png` or `application/pdf`.
    pub mime_type: String,
    /// Bytes.
    pub size_bytes: i64,
    /// The name the uploader's device gave it, when it gave one.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

/// Money paid to a lab.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabPayment {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The lab.
    #[schema(value_type = String)]
    pub vendor_id: Uuid,
    /// The order paid for.
    #[schema(value_type = Option<String>)]
    pub lab_order_id: Option<Uuid>,
    /// The clinic day, `YYYY-MM-DD`.
    pub paid_on: String,
    /// Paise.
    pub amount_paise: i64,
    /// The lab's bill number.
    pub lab_invoice_ref: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// How it was paid: `cash`, `upi`, `card` or `bank`. Absent when it was not recorded.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// The proof of payment, when one was attached; fetch it with
    /// `GET /lab-payments/{id}/proof/download`. Absent when there is none.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proof: Option<LabPaymentProof>,
    /// The `lab` expense recorded with it.
    #[schema(value_type = String)]
    pub expense_id: Uuid,
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
}

impl From<PaymentView> for LabPayment {
    fn from(view: PaymentView) -> Self {
        Self {
            id: view.id.uuid(),
            vendor_id: view.vendor_id.uuid(),
            lab_order_id: view.lab_order_id.map(LabOrderId::uuid),
            paid_on: view.paid_on.to_string(),
            amount_paise: view.amount.get(),
            lab_invoice_ref: view.lab_invoice_ref,
            note: view.note,
            method: view.method.map(|m| m.as_str().to_owned()),
            proof: view.proof.map(|p| LabPaymentProof {
                mime_type: p.mime_type,
                size_bytes: p.size_bytes,
                file_name: p.file_name,
            }),
            expense_id: view.expense_id.uuid(),
            status: view.status.as_str().to_owned(),
            void_reason: view.void_reason,
            voided_at: view.voided_at.map(rfc3339),
            recorded_by: view.recorded_by.uuid(),
            created_at: rfc3339(view.created_at),
        }
    }
}

/// Payments to labs.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabPaymentList {
    /// Newest day first, voided ones included.
    pub items: Vec<LabPayment>,
}

/// A payment to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewLabPayment {
    /// The lab.
    #[schema(value_type = String)]
    pub vendor_id: Uuid,
    /// The order paid for, at that lab.
    #[schema(value_type = Option<String>)]
    pub lab_order_id: Option<Uuid>,
    /// The clinic day, `YYYY-MM-DD`; today or earlier.
    pub paid_on: String,
    /// Paise, more than zero and at most 1,00,00,000 rupees.
    pub amount_paise: i64,
    /// The lab's bill number, up to 60 characters.
    pub lab_invoice_ref: Option<String>,
    /// Up to 300 characters.
    pub note: Option<String>,
    /// How it was paid: `cash`, `upi`, `card` or `bank`. Optional; nothing is assumed.
    pub method: Option<String>,
}

/// Filters for the payment list.
#[derive(Debug, Deserialize)]
pub struct LabPaymentParams {
    /// Only this lab.
    pub vendor_id: Option<String>,
    /// First clinic day.
    pub from: Option<String>,
    /// Last clinic day, included.
    pub to: Option<String>,
    /// Most rows, 1 to 500 (default 500).
    pub limit: Option<i64>,
}

/// Records a payment to a lab and its `lab` expense.
#[utoipa::path(
    post,
    path = "/api/v1/lab-payments",
    operation_id = "recordLabPayment",
    tag = "labs",
    request_body = NewLabPayment,
    security(("bearer" = [])),
    responses(
        (status = 201, body = LabPayment),
        (status = 400, description = "Invalid amount, note, reference, method or day, or an order at another lab"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write or finance.view"),
        (status = 404, description = "No such lab in this clinic")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiJson(body): ApiJson<NewLabPayment>,
) -> Result<(StatusCode, Json<LabPayment>), ApiFailure> {
    let paid_on = parse_day("paid_on", &body.paid_on)?;
    let view = app::record(
        state.db(),
        &request.actor,
        request.request_id,
        NewPaymentInput {
            vendor_id: LabVendorId::from_uuid(body.vendor_id),
            lab_order_id: body.lab_order_id.map(LabOrderId::from_uuid),
            paid_on,
            amount: Paise::new(body.amount_paise),
            lab_invoice_ref: body.lab_invoice_ref,
            note: body.note,
            method: body.method,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::LabPaymentRecorded.as_str(),
        lab_payment_id = %view.id.uuid(),
        expense_id = %view.expense_id.uuid(),
        "lab payment recorded"
    );
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Payments to labs, newest day first, voided ones included.
#[utoipa::path(
    get,
    path = "/api/v1/lab-payments",
    operation_id = "listLabPayments",
    tag = "labs",
    params(
        ("vendor_id" = Option<String>, Query, description = "Only this lab"),
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD"),
        ("to" = Option<String>, Query, description = "Last clinic day, included"),
        ("limit" = Option<i64>, Query, description = "Most rows, 1 to 500 (default 500)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabPaymentList),
        (status = 400, description = "A bad filter or a backwards range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiQuery(params): ApiQuery<LabPaymentParams>,
) -> Result<Json<LabPaymentList>, ApiFailure> {
    let vendor = optional_uuid("vendor_id", params.vendor_id.as_deref().unwrap_or(""))?;
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
        vendor.map(LabVendorId::from_uuid),
        (from, to),
        params.limit.unwrap_or(app::MAX_LIST),
    )
    .await?;
    Ok(Json(LabPaymentList {
        items: rows.into_iter().map(LabPayment::from).collect(),
    }))
}

/// Voids a payment to a lab and its expense, with a reason.
#[utoipa::path(
    post,
    path = "/api/v1/lab-payments/{id}/void",
    operation_id = "voidLabPayment",
    tag = "labs",
    params(("id" = String, Path, description = "The payment")),
    request_body = Reason,
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabPayment),
        (status = 400, description = "No reason given"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write or finance.view"),
        (status = 404, description = "No such payment in this clinic"),
        (status = 409, description = "Already void")
    )
)]
pub(crate) async fn void(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<Reason>,
) -> Result<Json<LabPayment>, ApiFailure> {
    let view = app::void(
        state.db(),
        &request.actor,
        request.request_id,
        LabPaymentId::from_uuid(id),
        &body.reason,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::LabPaymentVoided.as_str(), lab_payment_id = %id, "lab payment voided");
    Ok(Json(view.into()))
}

/// The proof upload form.
#[derive(Debug, ToSchema)]
#[expect(dead_code, reason = "documents the multipart form for OpenAPI")]
pub struct LabPaymentProofForm {
    /// A JPEG, PNG or PDF of at most 10 MB, checked by content.
    #[schema(value_type = String, format = Binary)]
    file: String,
}

/// Attaches a proof of payment (a receipt photo, UPI screenshot or PDF) as `multipart/form-data`
/// field `file`: JPEG, PNG or PDF, up to 10 MB, checked by content. Replaces the current proof,
/// which is kept as superseded. Returns the payment.
#[utoipa::path(
    post,
    path = "/api/v1/lab-payments/{id}/proof",
    operation_id = "uploadLabPaymentProof",
    tag = "labs",
    params(("id" = String, Path, description = "The payment")),
    request_body(content = LabPaymentProofForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabPayment),
        (status = 400, description = "Not a JPEG, PNG or PDF, or empty"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write or finance.view"),
        (status = 404, description = "No such payment in this clinic"),
        (status = 409, description = "The payment is void"),
        (status = 413, description = "Larger than 10 MB")
    )
)]
pub(crate) async fn upload_proof(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<Json<LabPayment>, ApiFailure> {
    let mut form = form.map_err(|_| bad_form("send the file as multipart/form-data"))?;
    let mut upload = None;
    while let Some(field) = form.next_field().await.map_err(|e| form_error(&e))? {
        if field.name() == Some("file") {
            let file_name = field.file_name().map(str::to_owned);
            let bytes = field.bytes().await.map_err(|e| form_error(&e))?;
            if bytes.len() > aarogyam_domain::files::MAX_BYTES {
                return Err(too_large());
            }
            upload = Some(ProofUpload {
                bytes: bytes.to_vec(),
                file_name,
            });
        } else {
            return Err(bad_form("unknown form field"));
        }
    }
    let upload = upload.ok_or_else(|| bad_form("file: is required"))?;
    let view = app::upload_proof(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        LabPaymentId::from_uuid(id),
        upload,
    )
    .await?;
    tracing::info!(lab_payment_id = %id, "lab payment proof attached");
    Ok(Json(view.into()))
}

/// Takes the proof off a payment that is not void. The file is kept as superseded.
#[utoipa::path(
    delete,
    path = "/api/v1/lab-payments/{id}/proof",
    operation_id = "removeLabPaymentProof",
    tag = "labs",
    params(("id" = String, Path, description = "The payment")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabPayment),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write or finance.view"),
        (status = 404, description = "No such payment in this clinic, or it has no proof"),
        (status = 409, description = "The payment is void")
    )
)]
pub(crate) async fn remove_proof(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<LabPayment>, ApiFailure> {
    let view = app::remove_proof(
        state.db(),
        &request.actor,
        request.request_id,
        LabPaymentId::from_uuid(id),
    )
    .await?;
    tracing::info!(lab_payment_id = %id, "lab payment proof removed");
    Ok(Json(view.into()))
}

/// Issues a five-minute link to a payment's proof. A voided payment's proof stays readable.
#[utoipa::path(
    get,
    path = "/api/v1/lab-payments/{id}/proof/download",
    operation_id = "getLabPaymentProofDownloadLink",
    tag = "labs",
    params(("id" = String, Path, description = "The payment")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = DownloadLink),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view"),
        (status = 404, description = "No such payment in this clinic, or it has no proof")
    )
)]
pub(crate) async fn proof_link(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<DownloadLink>, ApiFailure> {
    let link = app::proof_link(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        LabPaymentId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(DownloadLink {
        url: format!(
            "/api/v1/lab-payment-files/{}/content?token={}",
            link.file_id.uuid(),
            link.token
        ),
        expires_at: rfc3339(link.expires_at),
    }))
}

/// Streams a proof file through a signed link from `GET /lab-payments/{id}/proof/download`. The
/// link is the proof of access (an `<img>` can use it); it works on the clinic's own host for
/// five minutes.
#[utoipa::path(
    get,
    path = "/api/v1/lab-payment-files/{id}/content",
    operation_id = "getLabPaymentProofContent",
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
pub(crate) async fn proof_content(
    State(state): State<AppState>,
    host: ClinicHost,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ContentQuery>,
) -> Result<Response, ApiFailure> {
    let download = app::proof_content(
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
        "inline; filename=\"proof-{}.{}\"",
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
