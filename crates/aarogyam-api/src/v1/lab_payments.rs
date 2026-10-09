//! Money paid to labs: record and void (`expenses.write` and `finance.view`), list
//! (`finance.view`). Each payment records, and voids with it, an expense in the `lab` category.

use aarogyam_app::lab_payments::{self as app, NewPaymentInput, PaymentView};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{LabOrderId, LabPaymentId, LabVendorId};
use aarogyam_domain::permission::require::{ExpensesWrite, FinanceView};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use sakalya_types::Paise;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::Reason;
use super::{optional_uuid, parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

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
        (status = 400, description = "Invalid amount, note, reference or day, or an order at another lab"),
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
