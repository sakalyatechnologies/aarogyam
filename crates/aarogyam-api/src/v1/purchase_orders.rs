//! Purchase orders: what the clinic orders from a supplier, and receiving the goods into stock.
//! Costs show only with `finance.view`.

use aarogyam_app::purchase_orders::{
    self as app, LineInput, LineView, NewOrderInput, OrderChanges, OrderStatus, OrderView,
    ReceiptView, ReceiveInputs, ReceiveLine,
};
use aarogyam_domain::ids::{InventoryItemId, PurchaseOrderId, PurchaseOrderLineId, SupplierId};
use aarogyam_domain::permission::require::{InventoryManage, InventoryRead};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use sakalya_types::Paise;
use serde::{Deserialize, Deserializer, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_day, parse_id, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Tells a field sent as `null` (`Some(None)`) from one left out (`None`).
#[expect(clippy::option_option, reason = "null clears, absent keeps")]
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

/// A line of an order.
#[derive(Debug, Serialize, ToSchema)]
pub struct PurchaseOrderLine {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Position, from 1.
    pub line_no: i16,
    /// The item.
    #[schema(value_type = String)]
    pub item_id: Uuid,
    /// Its name.
    pub item_name: String,
    /// Its unit.
    pub unit: String,
    /// Units ordered.
    pub quantity: i64,
    /// Units received so far.
    pub received_quantity: i64,
    /// Cost of one unit in paise; null without finance.view or when not set.
    pub unit_cost_paise: Option<i64>,
}

impl From<LineView> for PurchaseOrderLine {
    fn from(line: LineView) -> Self {
        Self {
            id: line.id.uuid(),
            line_no: line.line_no,
            item_id: line.item_id.uuid(),
            item_name: line.item_name,
            unit: line.unit.as_str().to_owned(),
            quantity: line.quantity,
            received_quantity: line.received_quantity,
            unit_cost_paise: line.unit_cost.map(Paise::get),
        }
    }
}

/// Goods received against a line.
#[derive(Debug, Serialize, ToSchema)]
pub struct PurchaseOrderReceipt {
    /// The line.
    #[schema(value_type = String)]
    pub line_id: Uuid,
    /// The stock batch made.
    #[schema(value_type = String)]
    pub batch_id: Uuid,
    /// Units received.
    pub quantity: i64,
    /// When.
    pub at: String,
}

impl From<ReceiptView> for PurchaseOrderReceipt {
    fn from(receipt: ReceiptView) -> Self {
        Self {
            line_id: receipt.line_id.uuid(),
            batch_id: receipt.batch_id.uuid(),
            quantity: receipt.quantity,
            at: rfc3339(receipt.at),
        }
    }
}

/// An order to a supplier.
#[derive(Debug, Serialize, ToSchema)]
pub struct PurchaseOrder {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its number, such as PO-12.
    pub number: String,
    /// The supplier.
    #[schema(value_type = String)]
    pub supplier_id: Uuid,
    /// Their name.
    pub supplier_name: String,
    /// `draft`, `ordered`, `received` or `cancelled`.
    pub status: String,
    /// Day it is expected, `YYYY-MM-DD`.
    pub expected_on: Option<String>,
    /// Notes.
    pub notes: Option<String>,
    /// When it was sent.
    pub ordered_at: Option<String>,
    /// When the last line came in.
    pub received_at: Option<String>,
    /// When cancelled.
    pub cancelled_at: Option<String>,
    /// When made.
    pub created_at: String,
    /// Total cost in paise; null without finance.view or when a line has no cost.
    pub total_paise: Option<i64>,
    /// The lines.
    pub lines: Vec<PurchaseOrderLine>,
    /// What has been received.
    pub receipts: Vec<PurchaseOrderReceipt>,
}

impl From<OrderView> for PurchaseOrder {
    fn from(order: OrderView) -> Self {
        Self {
            id: order.id.uuid(),
            number: order.number,
            supplier_id: order.supplier_id.uuid(),
            supplier_name: order.supplier_name,
            status: order.status.as_str().to_owned(),
            expected_on: order.expected_on.map(|day| day.to_string()),
            notes: order.notes,
            ordered_at: order.ordered_at.map(rfc3339),
            received_at: order.received_at.map(rfc3339),
            cancelled_at: order.cancelled_at.map(rfc3339),
            created_at: rfc3339(order.created_at),
            total_paise: order.total.map(Paise::get),
            lines: order.lines.into_iter().map(Into::into).collect(),
            receipts: order.receipts.into_iter().map(Into::into).collect(),
        }
    }
}

/// The orders, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct PurchaseOrderList {
    /// The orders.
    pub items: Vec<PurchaseOrder>,
}

/// Which orders to list.
#[derive(Debug, Deserialize)]
pub struct ListParams {
    /// Only this status.
    pub status: Option<String>,
    /// Only this supplier.
    pub supplier_id: Option<String>,
}

/// The purchase orders, newest first, optionally of one status or supplier.
#[utoipa::path(
    get,
    path = "/api/v1/purchase-orders",
    operation_id = "listPurchaseOrders",
    tag = "inventory",
    params(
        ("status" = Option<String>, Query, description = "draft, ordered, received or cancelled"),
        ("supplier_id" = Option<String>, Query, description = "Only this supplier")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PurchaseOrderList),
        (status = 400, description = "A bad status or id"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
    ApiQuery(params): ApiQuery<ListParams>,
) -> Result<Json<PurchaseOrderList>, ApiFailure> {
    let status = match params.status.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(text) => Some(OrderStatus::parse(text)?),
    };
    let supplier_id = match params.supplier_id.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(text) => Some(SupplierId::from_uuid(parse_id("supplier_id", text)?)),
    };
    let orders = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        status,
        supplier_id,
    )
    .await?;
    Ok(Json(PurchaseOrderList {
        items: orders.into_iter().map(Into::into).collect(),
    }))
}

/// One purchase order.
#[utoipa::path(
    get,
    path = "/api/v1/purchase-orders/{id}",
    operation_id = "getPurchaseOrder",
    tag = "inventory",
    params(("id" = String, Path, description = "The order")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PurchaseOrder),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "No such order in this clinic")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PurchaseOrder>, ApiFailure> {
    let order = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        PurchaseOrderId::from_uuid(id),
    )
    .await?;
    Ok(Json(order.into()))
}

/// A line to order.
#[derive(Debug, Deserialize, ToSchema)]
pub struct OrderLineBody {
    /// The item.
    pub item_id: String,
    /// Units, at least 1.
    pub quantity: i64,
    /// Cost of one unit in paise; needs finance.view.
    pub unit_cost_paise: Option<i64>,
}

fn lines_of(lines: Vec<OrderLineBody>) -> Result<Vec<LineInput>, ApiFailure> {
    lines
        .into_iter()
        .map(|line| {
            Ok(LineInput {
                item_id: InventoryItemId::from_uuid(parse_id("lines.item_id", &line.item_id)?),
                quantity: line.quantity,
                unit_cost_paise: line.unit_cost_paise,
            })
        })
        .collect()
}

fn optional_day(field: &str, text: Option<&str>) -> Result<Option<time::Date>, ApiFailure> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => Ok(Some(parse_day(field, text)?)),
    }
}

/// A new order.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewPurchaseOrderBody {
    /// The supplier.
    pub supplier_id: String,
    /// Day it is expected, `YYYY-MM-DD`.
    pub expected_on: Option<String>,
    /// Notes, up to 500 characters.
    pub notes: Option<String>,
    /// The lines, 1 to 100, each item once.
    pub lines: Vec<OrderLineBody>,
    /// Send it at once instead of keeping a draft.
    pub order_now: Option<bool>,
}

/// Makes a purchase order, a draft or sent at once.
#[utoipa::path(
    post,
    path = "/api/v1/purchase-orders",
    operation_id = "createPurchaseOrder",
    tag = "inventory",
    request_body = NewPurchaseOrderBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = PurchaseOrder),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage, or costs without finance.view"),
        (status = 404, description = "No such supplier or item in this clinic")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiJson(body): ApiJson<NewPurchaseOrderBody>,
) -> Result<(StatusCode, Json<PurchaseOrder>), ApiFailure> {
    let input = NewOrderInput {
        supplier_id: SupplierId::from_uuid(parse_id("supplier_id", &body.supplier_id)?),
        expected_on: optional_day("expected_on", body.expected_on.as_deref())?,
        notes: body.notes,
        lines: lines_of(body.lines)?,
        order_now: body.order_now.unwrap_or(false),
    };
    let order = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = aarogyam_domain::event::Event::PurchaseOrderCreated.as_str(),
        order_id = %order.id.uuid(),
        "purchase order made"
    );
    Ok((StatusCode::CREATED, Json(order.into())))
}

/// A change to an order. Fields left out stay.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PurchaseOrderChanges {
    /// A different supplier; drafts only.
    pub supplier_id: Option<String>,
    /// Day it is expected; `null` clears.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    #[expect(clippy::option_option, reason = "null clears, absent keeps")]
    pub expected_on: Option<Option<String>>,
    /// Notes; an empty string clears.
    pub notes: Option<String>,
    /// All the lines, replacing the old ones; drafts only.
    pub lines: Option<Vec<OrderLineBody>>,
    /// `ordered` sends a draft; `cancelled` cancels an order nothing has come in against.
    pub status: Option<String>,
}

/// Changes a purchase order: its details while it is a draft, send it, or cancel it.
#[utoipa::path(
    patch,
    path = "/api/v1/purchase-orders/{id}",
    operation_id = "updatePurchaseOrder",
    tag = "inventory",
    params(("id" = String, Path, description = "The order")),
    request_body = PurchaseOrderChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = PurchaseOrder),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage, or costs without finance.view"),
        (status = 404, description = "No such order in this clinic"),
        (status = 409, description = "The order's state doesn't allow the change")
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PurchaseOrderChanges>,
) -> Result<Json<PurchaseOrder>, ApiFailure> {
    let expected_on = match body.expected_on {
        None => None,
        Some(None) => Some(None),
        Some(Some(text)) => Some(optional_day("expected_on", Some(&text))?),
    };
    let changes = OrderChanges {
        supplier_id: body
            .supplier_id
            .as_deref()
            .map(|text| parse_id("supplier_id", text))
            .transpose()?
            .map(SupplierId::from_uuid),
        expected_on,
        notes: body.notes,
        lines: body.lines.map(lines_of).transpose()?,
        status: body
            .status
            .as_deref()
            .map(|text| OrderStatus::parse(text.trim()))
            .transpose()?,
    };
    let order = app::update(
        state.db(),
        &request.actor,
        request.request_id,
        PurchaseOrderId::from_uuid(id),
        changes,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(order.into()))
}

/// Deletes a draft order.
#[utoipa::path(
    delete,
    path = "/api/v1/purchase-orders/{id}",
    operation_id = "deletePurchaseOrder",
    tag = "inventory",
    params(("id" = String, Path, description = "The order")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such order in this clinic"),
        (status = 409, description = "Only a draft can be deleted")
    )
)]
pub(crate) async fn delete(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete(
        state.db(),
        &request.actor,
        request.request_id,
        PurchaseOrderId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A delivery against one line.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReceiveLineBody {
    /// The order's line.
    pub line_id: String,
    /// Units that arrived, up to what is still to come.
    pub quantity: i64,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used, `YYYY-MM-DD`.
    pub expiry: Option<String>,
    /// What one unit really cost; needs finance.view.
    pub unit_cost_paise: Option<i64>,
}

/// A receipt of goods.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ReceiveOrderBody {
    /// What arrived; left out or empty receives everything still to come at the line costs.
    pub lines: Option<Vec<ReceiveLineBody>>,
    /// The day it arrived, `YYYY-MM-DD`; today by default.
    pub received_on: Option<String>,
}

/// Receives goods against a sent order: each line makes a stock batch and a receive movement.
#[utoipa::path(
    post,
    path = "/api/v1/purchase-orders/{id}/receive",
    operation_id = "receivePurchaseOrder",
    tag = "inventory",
    params(("id" = String, Path, description = "The order")),
    request_body = ReceiveOrderBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = PurchaseOrder),
        (status = 400, description = "Invalid input, such as more than is still to come"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage, or a cost without finance.view"),
        (status = 404, description = "No such order or line in this clinic"),
        (status = 409, description = "The order isn't in the ordered state")
    )
)]
pub(crate) async fn receive(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ReceiveOrderBody>,
) -> Result<Json<PurchaseOrder>, ApiFailure> {
    let lines = body
        .lines
        .unwrap_or_default()
        .into_iter()
        .map(|line| {
            Ok(ReceiveLine {
                line_id: PurchaseOrderLineId::from_uuid(parse_id("lines.line_id", &line.line_id)?),
                quantity: line.quantity,
                batch_no: line.batch_no,
                expiry: optional_day("lines.expiry", line.expiry.as_deref())?,
                unit_cost_paise: line.unit_cost_paise,
            })
        })
        .collect::<Result<Vec<_>, ApiFailure>>()?;
    let order = app::receive(
        state.db(),
        &request.actor,
        request.request_id,
        PurchaseOrderId::from_uuid(id),
        ReceiveInputs {
            lines,
            received_on: optional_day("received_on", body.received_on.as_deref())?,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = aarogyam_domain::event::Event::PurchaseOrderReceived.as_str(),
        order_id = %id,
        "purchase order received"
    );
    Ok(Json(order.into()))
}
