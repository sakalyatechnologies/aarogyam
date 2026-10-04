//! Payments and receipts.

use aarogyam_app::payments::{self as app, PaymentView, RecordPayment};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{InvoiceId, PatientId, PaymentId};
use aarogyam_domain::permission::require::{BillingRead, BillingWrite};
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::{PatientRef, Reason};
use super::{parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Part of a payment going to a bill.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Allocation {
    /// The bill: issued, of the same patient.
    #[schema(value_type = String)]
    pub invoice_id: Uuid,
    /// The bill's number (in responses).
    #[serde(default, skip_deserializing)]
    pub invoice_number: Option<String>,
    /// Paise; no more than the bill's balance.
    pub amount_paise: i64,
}

/// A payment and its receipt number.
#[derive(Debug, Serialize, ToSchema)]
pub struct Payment {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Receipt number, such as `RC/26-27/000042`.
    pub number: String,
    /// Who paid.
    pub patient: PatientRef,
    /// When (RFC 3339).
    pub received_at: String,
    /// Paise.
    pub amount_paise: i64,
    /// `cash`, `upi`, `card` or `bank`.
    pub method: String,
    /// UPI or card reference.
    pub reference: Option<String>,
    /// `received` or `void`.
    pub status: String,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// Allocated to bills.
    pub allocated_paise: i64,
    /// Left as an advance.
    pub unallocated_paise: i64,
    /// The bills it pays.
    pub allocations: Vec<Allocation>,
}

impl From<PaymentView> for Payment {
    fn from(view: PaymentView) -> Self {
        Self {
            id: view.id.uuid(),
            number: view.number,
            patient: view.patient.into(),
            received_at: rfc3339(view.received_at),
            amount_paise: view.amount.get(),
            method: view.method.as_str().to_owned(),
            reference: view.reference,
            status: view.status.as_str().to_owned(),
            void_reason: view.void_reason,
            allocated_paise: view.allocated.get(),
            unallocated_paise: view.unallocated.get(),
            allocations: view
                .allocations
                .into_iter()
                .map(|a| Allocation {
                    invoice_id: a.invoice_id.uuid(),
                    invoice_number: a.invoice_number,
                    amount_paise: a.amount.get(),
                })
                .collect(),
        }
    }
}

/// Payments.
#[derive(Debug, Serialize, ToSchema)]
pub struct PaymentList {
    /// Newest first.
    pub items: Vec<Payment>,
}

/// A payment to record. Send an `Idempotency-Key` header (a UUID per payment form); a retry
/// with the same key returns the first payment instead of recording another.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewPayment {
    /// Who paid.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// `cash`, `upi`, `card` or `bank`.
    pub method: String,
    /// Paise, more than zero.
    pub amount_paise: i64,
    /// UPI or card reference.
    pub reference: Option<String>,
    /// The bills it pays; what is left over stays as an advance.
    #[serde(default)]
    pub allocations: Vec<Allocation>,
}

/// Records a payment against issued bills and issues a receipt number. Needs an
/// `Idempotency-Key` header.
#[utoipa::path(
    post,
    path = "/api/v1/payments",
    tag = "billing",
    request_body = NewPayment,
    params(("Idempotency-Key" = String, Header, description = "Unique per payment; a retry sends the same key")),
    security(("bearer" = [])),
    responses(
        (status = 201, body = Payment, description = "Recorded"),
        (status = 200, body = Payment, description = "Already recorded with this key"),
        (status = 400, description = "Invalid input, a missing key, or an allocation past a bill's balance or the payment"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write"),
        (status = 404, description = "No such patient or bill in this clinic"),
        (status = 409, description = "The key was used for a different payment, or a bill isn't issued")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingWrite>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<NewPayment>,
) -> Result<(StatusCode, Json<Payment>), ApiFailure> {
    let key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            ApiError::bad_request("invalid_request", "Idempotency-Key: the header is required")
        })?;
    let input = RecordPayment {
        idempotency_key: key.to_owned(),
        patient_id: PatientId::from_uuid(body.patient_id),
        method: body.method,
        amount_paise: body.amount_paise,
        reference: body.reference,
        allocations: body
            .allocations
            .into_iter()
            .map(|a| (InvoiceId::from_uuid(a.invoice_id), a.amount_paise))
            .collect(),
    };
    let (view, created) = app::record(
        state.db(),
        &request.actor,
        request.request_id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    if created {
        tracing::info!(event = Event::PaymentReceived.as_str(), payment_id = %view.id.uuid(), "payment received");
    }
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(view.into())))
}

/// Voids a payment with a reason. The bills it paid show their balance again.
#[utoipa::path(
    post,
    path = "/api/v1/payments/{id}/void",
    tag = "billing",
    params(("id" = String, Path, description = "The payment")),
    request_body = Reason,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Payment),
        (status = 400, description = "No reason given"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.write"),
        (status = 404, description = "No such payment in this clinic"),
        (status = 409, description = "Already void")
    )
)]
pub(crate) async fn void(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<Reason>,
) -> Result<Json<Payment>, ApiFailure> {
    let view = app::void(
        state.db(),
        &request.actor,
        request.request_id,
        PaymentId::from_uuid(id),
        &body.reason,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::PaymentVoided.as_str(), payment_id = %id, "payment voided");
    Ok(Json(view.into()))
}

/// One payment, for its receipt.
#[utoipa::path(
    get,
    path = "/api/v1/payments/{id}",
    tag = "billing",
    params(("id" = String, Path, description = "The payment")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Payment),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.read"),
        (status = 404, description = "No such payment in this clinic")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Payment>, ApiFailure> {
    let view = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        PaymentId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Filters for the payment list.
#[derive(Debug, Deserialize)]
pub struct PaymentParams {
    /// First clinic day (`YYYY-MM-DD`).
    pub from: Option<String>,
    /// Last clinic day, included.
    pub to: Option<String>,
    /// Most rows, 1 to 500 (default 100).
    pub limit: Option<i64>,
}

/// Payments received, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/payments",
    tag = "billing",
    params(
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD"),
        ("to" = Option<String>, Query, description = "Last clinic day, included"),
        ("limit" = Option<i64>, Query, description = "Most rows, 1 to 500 (default 100)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PaymentList),
        (status = 400, description = "A bad date"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks billing.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<BillingRead>,
    ApiQuery(params): ApiQuery<PaymentParams>,
) -> Result<Json<PaymentList>, ApiFailure> {
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
        params.limit.unwrap_or(100),
    )
    .await?;
    Ok(Json(PaymentList {
        items: rows.into_iter().map(Payment::from).collect(),
    }))
}
