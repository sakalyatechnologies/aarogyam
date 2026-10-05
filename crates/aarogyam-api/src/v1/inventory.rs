//! Stock: items, suppliers, deliveries, use and corrections, and the low-stock and expiry
//! lists.

use aarogyam_app::inventory::{
    self as app, AdjustInput, BatchView, ExpiringView, ItemDetail, ItemInput, ItemView,
    MovementView, ReceiveInput, StockChange, StockCounts, StockItem, SupplierInput, SupplierView,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{InventoryItemId, StockBatchId, SupplierId};
use aarogyam_domain::permission::require::{InventoryManage, InventoryRead};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{parse_day, parse_id, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

// ------------------------------------------------------------------ suppliers

/// A supplier.
#[derive(Debug, Serialize, ToSchema)]
pub struct Supplier {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Phone in E.164.
    pub phone: Option<String>,
    /// GSTIN.
    pub gstin: Option<String>,
    /// Still bought from.
    pub active: bool,
}

impl From<SupplierView> for Supplier {
    fn from(view: SupplierView) -> Self {
        Self {
            id: view.id.uuid(),
            name: view.name,
            phone: view.phone,
            gstin: view.gstin,
            active: view.active,
        }
    }
}

/// The suppliers.
#[derive(Debug, Serialize, ToSchema)]
pub struct SupplierList {
    /// By name.
    pub items: Vec<Supplier>,
}

/// A supplier's values. On a change, fields left out stay as they are and an empty string
/// clears an optional one.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SupplierValues {
    /// Name; required for a new supplier.
    pub name: Option<String>,
    /// Phone; +91 is assumed without a country code.
    pub phone: Option<String>,
    /// GSTIN, 15 characters.
    pub gstin: Option<String>,
    /// Still bought from.
    pub active: Option<bool>,
}

impl From<SupplierValues> for SupplierInput {
    fn from(body: SupplierValues) -> Self {
        Self {
            name: body.name,
            phone: body.phone,
            gstin: body.gstin,
            active: body.active,
        }
    }
}

/// The clinic's suppliers.
#[utoipa::path(
    get,
    path = "/api/v1/suppliers",
    operation_id = "listSuppliers",
    tag = "inventory",
    security(("bearer" = [])),
    responses(
        (status = 200, body = SupplierList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn suppliers(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
) -> Result<Json<SupplierList>, ApiFailure> {
    let rows = app::suppliers(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(SupplierList {
        items: rows.into_iter().map(Supplier::from).collect(),
    }))
}

/// Adds a supplier.
#[utoipa::path(
    post,
    path = "/api/v1/suppliers",
    operation_id = "createSupplier",
    tag = "inventory",
    request_body = SupplierValues,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Supplier),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 409, description = "A supplier has this name")
    )
)]
pub(crate) async fn create_supplier(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiJson(body): ApiJson<SupplierValues>,
) -> Result<(StatusCode, Json<Supplier>), ApiFailure> {
    let view =
        app::create_supplier(state.db(), &request.actor, request.request_id, body.into()).await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Changes a supplier.
#[utoipa::path(
    patch,
    path = "/api/v1/suppliers/{id}",
    operation_id = "updateSupplier",
    tag = "inventory",
    params(("id" = String, Path, description = "The supplier")),
    request_body = SupplierValues,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Supplier),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such supplier in this clinic"),
        (status = 409, description = "A supplier has this name")
    )
)]
pub(crate) async fn update_supplier(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SupplierValues>,
) -> Result<Json<Supplier>, ApiFailure> {
    let view = app::update_supplier(
        state.db(),
        &request.actor,
        request.request_id,
        SupplierId::from_uuid(id),
        body.into(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Removes a supplier from the list. Deliveries already received keep their supplier.
#[utoipa::path(
    delete,
    path = "/api/v1/suppliers/{id}",
    operation_id = "deleteSupplier",
    tag = "inventory",
    params(("id" = String, Path, description = "The supplier")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such supplier in this clinic")
    )
)]
pub(crate) async fn delete_supplier(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete_supplier(
        state.db(),
        &request.actor,
        request.request_id,
        SupplierId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------ items

/// A stock item.
#[derive(Debug, Serialize, ToSchema)]
pub struct InventoryItem {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Category, such as `restorative` or `disposables`.
    pub category: Option<String>,
    /// `piece`, `ml`, `g`, `box` or `pack`.
    pub unit: String,
    /// At or below this the item is low.
    pub reorder_level: i64,
    /// Still stocked.
    pub active: bool,
}

impl From<ItemView> for InventoryItem {
    fn from(view: ItemView) -> Self {
        Self {
            id: view.id.uuid(),
            name: view.name,
            category: view.category,
            unit: view.unit.as_str().to_owned(),
            reorder_level: view.reorder_level,
            active: view.active,
        }
    }
}

/// An item and where its stock stands.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockLevel {
    /// The item.
    pub item: InventoryItem,
    /// Units on hand, all batches.
    pub on_hand: i64,
    /// Earliest expiry among batches with stock left, `YYYY-MM-DD`.
    pub next_expiry: Option<String>,
    /// `ok`, `low` (at or below the reorder level), `critical` (out, or at a fifth of the
    /// reorder level or less) or `expiring` (enough, but a batch expires within 30 days).
    pub status: String,
}

impl From<StockItem> for StockLevel {
    fn from(stock: StockItem) -> Self {
        Self {
            item: stock.item.into(),
            on_hand: stock.on_hand,
            next_expiry: stock.next_expiry.map(|date| date.to_string()),
            status: stock.status.as_str().to_owned(),
        }
    }
}

/// The items with their levels.
#[derive(Debug, Serialize, ToSchema)]
pub struct ItemList {
    /// By name.
    pub items: Vec<StockLevel>,
}

/// An item's values. On a change, fields left out stay as they are and an empty category
/// clears it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ItemValues {
    /// Name; required for a new item.
    pub name: Option<String>,
    /// Category: lower case, digits and `_`.
    pub category: Option<String>,
    /// `piece` (default), `ml`, `g`, `box` or `pack`.
    pub unit: Option<String>,
    /// At or below this the item is low; 0 by default.
    pub reorder_level: Option<i64>,
    /// Still stocked.
    pub active: Option<bool>,
}

impl From<ItemValues> for ItemInput {
    fn from(body: ItemValues) -> Self {
        Self {
            name: body.name,
            category: body.category,
            unit: body.unit,
            reorder_level: body.reorder_level,
            active: body.active,
        }
    }
}

/// A delivery on the shelf.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockBatch {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The supplier, if recorded.
    #[schema(value_type = Option<String>)]
    pub supplier_id: Option<Uuid>,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used, `YYYY-MM-DD`.
    pub expiry: Option<String>,
    /// Units that arrived.
    pub received_quantity: i64,
    /// Units left.
    pub quantity: i64,
    /// Cost of one unit in paise.
    pub unit_cost_paise: i64,
    /// Day it arrived, `YYYY-MM-DD`.
    pub received_on: String,
}

impl From<BatchView> for StockBatch {
    fn from(view: BatchView) -> Self {
        Self {
            id: view.id.uuid(),
            supplier_id: view.supplier_id.map(SupplierId::uuid),
            batch_no: view.batch_no,
            expiry: view.expiry.map(|date| date.to_string()),
            received_quantity: view.received_quantity,
            quantity: view.quantity,
            unit_cost_paise: view.unit_cost.get(),
            received_on: view.received_on.to_string(),
        }
    }
}

/// A change in stock.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockMovement {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The batch touched.
    #[schema(value_type = String)]
    pub batch_id: Uuid,
    /// `receive`, `use`, `adjust` or `expire`.
    pub kind: String,
    /// Signed units: negative took stock off the shelf.
    pub quantity: i64,
    /// Why, for corrections and write-offs.
    pub reason: Option<String>,
    /// When (RFC 3339).
    pub at: String,
    /// The member who did it.
    #[schema(value_type = Option<String>)]
    pub by: Option<Uuid>,
}

impl From<MovementView> for StockMovement {
    fn from(view: MovementView) -> Self {
        Self {
            id: view.id,
            batch_id: view.batch_id.uuid(),
            kind: view.kind,
            quantity: view.quantity,
            reason: view.reason,
            at: rfc3339(view.at),
            by: view.by,
        }
    }
}

/// An item with its deliveries and latest changes.
#[derive(Debug, Serialize, ToSchema)]
pub struct ItemDetailResponse {
    /// The item and where it stands.
    pub stock: StockLevel,
    /// Deliveries, those with stock first.
    pub batches: Vec<StockBatch>,
    /// The latest changes, newest first.
    pub movements: Vec<StockMovement>,
}

impl From<ItemDetail> for ItemDetailResponse {
    fn from(detail: ItemDetail) -> Self {
        Self {
            stock: detail.stock.into(),
            batches: detail.batches.into_iter().map(StockBatch::from).collect(),
            movements: detail
                .movements
                .into_iter()
                .map(StockMovement::from)
                .collect(),
        }
    }
}

/// The clinic's stock items, by name, each with its level.
#[utoipa::path(
    get,
    path = "/api/v1/inventory-items",
    operation_id = "listInventoryItems",
    tag = "inventory",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ItemList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn items(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
) -> Result<Json<ItemList>, ApiFailure> {
    let rows = app::items(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(ItemList {
        items: rows.into_iter().map(StockLevel::from).collect(),
    }))
}

/// Adds a stock item.
#[utoipa::path(
    post,
    path = "/api/v1/inventory-items",
    operation_id = "createInventoryItem",
    tag = "inventory",
    request_body = ItemValues,
    security(("bearer" = [])),
    responses(
        (status = 201, body = InventoryItem),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 409, description = "An item has this name")
    )
)]
pub(crate) async fn create_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiJson(body): ApiJson<ItemValues>,
) -> Result<(StatusCode, Json<InventoryItem>), ApiFailure> {
    let view =
        app::create_item(state.db(), &request.actor, request.request_id, body.into()).await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// One item with its deliveries and latest changes.
#[utoipa::path(
    get,
    path = "/api/v1/inventory-items/{id}",
    operation_id = "getInventoryItem",
    tag = "inventory",
    params(("id" = String, Path, description = "The item")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ItemDetailResponse),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "No such item in this clinic")
    )
)]
pub(crate) async fn item(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ItemDetailResponse>, ApiFailure> {
    let detail = app::item_detail(
        state.db(),
        &request.actor,
        request.request_id,
        InventoryItemId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(detail.into()))
}

/// Changes a stock item.
#[utoipa::path(
    patch,
    path = "/api/v1/inventory-items/{id}",
    operation_id = "updateInventoryItem",
    tag = "inventory",
    params(("id" = String, Path, description = "The item")),
    request_body = ItemValues,
    security(("bearer" = [])),
    responses(
        (status = 200, body = InventoryItem),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such item in this clinic"),
        (status = 409, description = "An item has this name")
    )
)]
pub(crate) async fn update_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ItemValues>,
) -> Result<Json<InventoryItem>, ApiFailure> {
    let view = app::update_item(
        state.db(),
        &request.actor,
        request.request_id,
        InventoryItemId::from_uuid(id),
        body.into(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Removes an item from the lists. Only an item with nothing on the shelf can go.
#[utoipa::path(
    delete,
    path = "/api/v1/inventory-items/{id}",
    operation_id = "deleteInventoryItem",
    tag = "inventory",
    params(("id" = String, Path, description = "The item")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such item in this clinic"),
        (status = 409, description = "The item still has stock")
    )
)]
pub(crate) async fn delete_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete_item(
        state.db(),
        &request.actor,
        request.request_id,
        InventoryItemId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ------------------------------------------------------------------ summary and lists

/// Items by status, for the summary cards.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockCountsResponse {
    /// Items out or nearly out.
    pub critical: usize,
    /// Items at or below the reorder level.
    pub low: usize,
    /// Items with a batch expiring within 30 days.
    pub expiring: usize,
    /// Items in good supply.
    pub ok: usize,
}

impl From<StockCounts> for StockCountsResponse {
    fn from(counts: StockCounts) -> Self {
        Self {
            critical: counts.critical,
            low: counts.low,
            expiring: counts.expiring,
            ok: counts.ok,
        }
    }
}

/// The stock summary.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockSummary {
    /// Active items by status.
    pub counts: StockCountsResponse,
    /// Every item, critical first, then low, expiring and ok; each group by name.
    pub items: Vec<StockLevel>,
}

/// Stock levels: units on hand, reorder level and status for every item, with counts for the
/// summary cards.
#[utoipa::path(
    get,
    path = "/api/v1/stock",
    operation_id = "getStockSummary",
    tag = "inventory",
    security(("bearer" = [])),
    responses(
        (status = 200, body = StockSummary),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn summary(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
) -> Result<Json<StockSummary>, ApiFailure> {
    let items = app::stock_levels(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(StockSummary {
        counts: app::counts(&items).into(),
        items: items.into_iter().map(StockLevel::from).collect(),
    }))
}

/// Active items at or below their reorder level, worst first.
#[utoipa::path(
    get,
    path = "/api/v1/stock/low",
    operation_id = "listLowStock",
    tag = "inventory",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ItemList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn low(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
) -> Result<Json<ItemList>, ApiFailure> {
    let rows = app::low_stock(
        state.db(),
        &request.actor,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(ItemList {
        items: rows.into_iter().map(StockLevel::from).collect(),
    }))
}

/// A batch about to expire.
#[derive(Debug, Serialize, ToSchema)]
pub struct ExpiringBatch {
    /// The batch.
    #[schema(value_type = String)]
    pub batch_id: Uuid,
    /// The item.
    #[schema(value_type = String)]
    pub item_id: Uuid,
    /// The item's name.
    pub item_name: String,
    /// The item's unit.
    pub unit: String,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used, `YYYY-MM-DD`.
    pub expiry: String,
    /// Units left.
    pub quantity: i64,
    /// Days until expiry; negative once expired.
    pub days_left: i64,
}

impl From<ExpiringView> for ExpiringBatch {
    fn from(view: ExpiringView) -> Self {
        Self {
            batch_id: view.batch_id.uuid(),
            item_id: view.item_id.uuid(),
            item_name: view.item_name,
            unit: view.unit.as_str().to_owned(),
            batch_no: view.batch_no,
            expiry: view.expiry.to_string(),
            quantity: view.quantity,
            days_left: view.days_left,
        }
    }
}

/// Batches expiring soon.
#[derive(Debug, Serialize, ToSchema)]
pub struct ExpiringList {
    /// Earliest first; already expired batches come first.
    pub items: Vec<ExpiringBatch>,
}

/// Filters for the expiring list.
#[derive(Debug, Deserialize)]
pub struct ExpiringParams {
    /// Days ahead to look; 30 by default.
    pub days: Option<i64>,
}

/// Batches with stock left that expire within `days` days or already have.
#[utoipa::path(
    get,
    path = "/api/v1/stock/expiring",
    operation_id = "listExpiringStock",
    tag = "inventory",
    params(("days" = Option<i64>, Query, description = "Days ahead, 0 to 3650; 30 by default")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ExpiringList),
        (status = 400, description = "A bad number of days"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn expiring(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
    ApiQuery(params): ApiQuery<ExpiringParams>,
) -> Result<Json<ExpiringList>, ApiFailure> {
    let rows = app::expiring(
        state.db(),
        &request.actor,
        request.request_id,
        params.days,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(ExpiringList {
        items: rows.into_iter().map(ExpiringBatch::from).collect(),
    }))
}

// ------------------------------------------------------------------ movements

/// The result of a delivery, use or correction.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockChangeResponse {
    /// The item as it stands now.
    pub stock: StockLevel,
    /// What was recorded, one movement per batch touched.
    pub movements: Vec<StockMovement>,
}

impl From<StockChange> for StockChangeResponse {
    fn from(change: StockChange) -> Self {
        Self {
            stock: change.stock.into(),
            movements: change
                .movements
                .into_iter()
                .map(StockMovement::from)
                .collect(),
        }
    }
}

fn logged(event: Event, item_id: Uuid, movements: &[MovementView]) {
    tracing::info!(
        event = event.as_str(),
        item_id = %item_id,
        movements = movements.len(),
        "stock changed"
    );
}

/// A delivery.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReceiveBody {
    /// The item.
    pub item_id: String,
    /// The supplier, if known.
    pub supplier_id: Option<String>,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used, `YYYY-MM-DD`.
    pub expiry: Option<String>,
    /// Units that arrived, 1 to 1000000.
    pub quantity: i64,
    /// Cost of one unit in paise; 0 by default.
    pub unit_cost_paise: Option<i64>,
    /// Day it arrived, `YYYY-MM-DD`; today by default.
    pub received_on: Option<String>,
}

/// Adds a delivery to stock: a new batch and a `receive` movement.
#[utoipa::path(
    post,
    path = "/api/v1/stock/receive",
    operation_id = "receiveStock",
    tag = "inventory",
    request_body = ReceiveBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = StockChangeResponse),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such item or supplier in this clinic")
    )
)]
pub(crate) async fn receive(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiJson(body): ApiJson<ReceiveBody>,
) -> Result<(StatusCode, Json<StockChangeResponse>), ApiFailure> {
    let item_id = parse_id("item_id", &body.item_id)?;
    let input = ReceiveInput {
        item_id: InventoryItemId::from_uuid(item_id),
        supplier_id: optional_id("supplier_id", body.supplier_id.as_deref())?
            .map(SupplierId::from_uuid),
        batch_no: body.batch_no,
        expiry: optional_day("expiry", body.expiry.as_deref())?,
        quantity: body.quantity,
        unit_cost_paise: body.unit_cost_paise.unwrap_or(0),
        received_on: optional_day("received_on", body.received_on.as_deref())?,
    };
    let change = app::receive(
        state.db(),
        &request.actor,
        request.request_id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    logged(Event::StockReceived, item_id, &change.movements);
    Ok((StatusCode::CREATED, Json(change.into())))
}

fn optional_id(field: &str, text: Option<&str>) -> Result<Option<Uuid>, ApiError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => parse_id(field, text).map(Some),
    }
}

fn optional_day(field: &str, text: Option<&str>) -> Result<Option<time::Date>, ApiError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) => parse_day(field, text).map(Some),
    }
}

/// Stock used.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UseBody {
    /// The item.
    pub item_id: String,
    /// Units used, 1 to 1000000.
    pub quantity: i64,
    /// Why or for whom, without patient details.
    pub reason: Option<String>,
}

/// Uses stock: takes from the batches that expire first and skips expired ones. When the usable
/// stock is short, nothing is taken.
#[utoipa::path(
    post,
    path = "/api/v1/stock/use",
    operation_id = "useStock",
    tag = "inventory",
    request_body = UseBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = StockChangeResponse),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such item in this clinic"),
        (status = 409, description = "Not enough usable stock")
    )
)]
pub(crate) async fn use_stock(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiJson(body): ApiJson<UseBody>,
) -> Result<Json<StockChangeResponse>, ApiFailure> {
    let item_id = parse_id("item_id", &body.item_id)?;
    let change = app::use_stock(
        state.db(),
        &request.actor,
        request.request_id,
        InventoryItemId::from_uuid(item_id),
        body.quantity,
        body.reason.as_deref(),
        OffsetDateTime::now_utc(),
    )
    .await?;
    logged(Event::StockUsed, item_id, &change.movements);
    Ok(Json(change.into()))
}

/// A count correction.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AdjustBody {
    /// The item.
    pub item_id: String,
    /// Signed units, not zero: negative takes stock off the shelf (earliest expiry first),
    /// positive adds found stock as a new batch.
    pub quantity: i64,
    /// Why; required.
    pub reason: String,
    /// Expiry of found stock, `YYYY-MM-DD`.
    pub expiry: Option<String>,
}

/// Corrects stock after a count.
#[utoipa::path(
    post,
    path = "/api/v1/stock/adjust",
    operation_id = "adjustStock",
    tag = "inventory",
    request_body = AdjustBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = StockChangeResponse),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such item in this clinic"),
        (status = 409, description = "More removed than is on the shelf")
    )
)]
pub(crate) async fn adjust(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiJson(body): ApiJson<AdjustBody>,
) -> Result<Json<StockChangeResponse>, ApiFailure> {
    let item_id = parse_id("item_id", &body.item_id)?;
    let change = app::adjust(
        state.db(),
        &request.actor,
        request.request_id,
        AdjustInput {
            item_id: InventoryItemId::from_uuid(item_id),
            quantity: body.quantity,
            reason: body.reason,
            expiry: optional_day("expiry", body.expiry.as_deref())?,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    logged(Event::StockAdjusted, item_id, &change.movements);
    Ok(Json(change.into()))
}

/// A write-off.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ExpireBody {
    /// Why; "expired" by default.
    pub reason: Option<String>,
}

/// Writes off what is left of a batch that has expired.
#[utoipa::path(
    post,
    path = "/api/v1/stock/batches/{id}/expire",
    operation_id = "expireStockBatch",
    tag = "inventory",
    params(("id" = String, Path, description = "The batch")),
    request_body = ExpireBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = StockChangeResponse),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such batch in this clinic"),
        (status = 409, description = "The batch has not expired, or is empty")
    )
)]
pub(crate) async fn expire_batch(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ExpireBody>,
) -> Result<Json<StockChangeResponse>, ApiFailure> {
    let change = app::expire_batch(
        state.db(),
        &request.actor,
        request.request_id,
        StockBatchId::from_uuid(id),
        body.reason.as_deref(),
        OffsetDateTime::now_utc(),
    )
    .await?;
    logged(
        Event::StockAdjusted,
        change.stock.item.id.uuid(),
        &change.movements,
    );
    Ok(Json(change.into()))
}
