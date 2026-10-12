//! Stock analytics: usage, days of cover and run-out dates, and each item's alert settings.

use aarogyam_app::stock_insights::{self as app, AlertSettings, Analytics, ItemInsight};
use aarogyam_domain::ids::InventoryItemId;
use aarogyam_domain::permission::require::{InventoryManage, InventoryRead};
use axum::extract::State;
use axum::routing::{get, patch};
use axum::{Json, Router};
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::parse_id;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The routes of this module.
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/stock/analytics", get(analytics))
        .route("/inventory-items/{id}/alerts", patch(update_alerts))
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths(analytics, update_alerts))]
pub(crate) struct Doc;

/// Units used on one clinic day.
#[derive(Debug, Serialize, ToSchema)]
pub struct DailyUse {
    /// The clinic's local day, `YYYY-MM-DD`.
    pub day: String,
    /// Units used.
    pub quantity: i64,
}

/// One item's usage and run-out projection.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockInsight {
    /// The item.
    #[schema(value_type = String)]
    pub item_id: Uuid,
    /// Name.
    pub name: String,
    /// Unit.
    pub unit: String,
    /// Units on the shelf that have not expired today.
    pub on_hand: i64,
    /// Units used per day over the last two weeks; empty with under a week of history or fewer
    /// than two days of use.
    pub daily_usage: Option<f64>,
    /// Units used in the last 7 days, today included.
    pub usage_7d: i64,
    /// Units used in the last 28 days, today included.
    pub usage_28d: i64,
    /// Units used on each of the last 28 days, oldest first, today last.
    pub series: Vec<DailyUse>,
    /// Whole days the usable stock lasts at the recent rate; empty without a projection.
    pub days_cover: Option<i64>,
    /// The day the stock runs out, `YYYY-MM-DD`; empty without a projection.
    pub runs_out_on: Option<String>,
    /// At or below this the item is low.
    pub reorder_level: i64,
    /// Days from ordering to delivery.
    pub lead_time_days: i16,
    /// Whether the item raises stock alerts.
    pub alerts_enabled: bool,
    /// Units to order to cover the lead time plus two weeks; empty without a projection, zero
    /// when the stock already covers it.
    pub suggested_reorder_qty: Option<i64>,
    /// Whether the item needs reordering now.
    pub needs_reorder: bool,
    /// Why, as `low` or `projected`.
    pub reorder_reason: Option<String>,
}

impl From<ItemInsight> for StockInsight {
    fn from(item: ItemInsight) -> Self {
        Self {
            item_id: item.item_id.uuid(),
            name: item.name,
            unit: item.unit,
            on_hand: item.on_hand,
            daily_usage: item.daily_usage,
            usage_7d: item.usage_7d,
            usage_28d: item.usage_28d,
            series: item
                .series
                .into_iter()
                .map(|(day, quantity)| DailyUse {
                    day: day.to_string(),
                    quantity,
                })
                .collect(),
            days_cover: item.days_cover,
            runs_out_on: item.runs_out_on.map(|day| day.to_string()),
            reorder_level: item.reorder_level,
            lead_time_days: item.lead_time_days,
            alerts_enabled: item.alerts_enabled,
            suggested_reorder_qty: item.suggested_reorder_qty,
            needs_reorder: item.needs_reorder,
            reorder_reason: item.reason.map(|reason| reason.as_str().to_owned()),
        }
    }
}

/// Usage and projection per item, and the items to reorder.
#[derive(Debug, Serialize, ToSchema)]
pub struct StockAnalytics {
    /// Active items by name, or the one asked for.
    pub items: Vec<StockInsight>,
    /// The items that need reordering, soonest to run out first.
    pub reorder_list: Vec<StockInsight>,
}

impl From<Analytics> for StockAnalytics {
    fn from(all: Analytics) -> Self {
        Self {
            items: all.items.into_iter().map(StockInsight::from).collect(),
            reorder_list: all
                .reorder_list
                .into_iter()
                .map(StockInsight::from)
                .collect(),
        }
    }
}

/// Filters for the analytics.
#[derive(Debug, Deserialize)]
pub struct AnalyticsParams {
    /// One item; every active item by default.
    pub item_id: Option<String>,
}

/// How fast each item is used, how long it lasts and what to reorder.
#[utoipa::path(
    get,
    path = "/api/v1/stock/analytics",
    operation_id = "getStockAnalytics",
    tag = "inventory",
    params(("item_id" = Option<String>, Query, description = "One item; every active item by default")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = StockAnalytics),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.read"),
        (status = 404, description = "No such item in this clinic, or not a member of it")
    )
)]
pub(crate) async fn analytics(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryRead>,
    ApiQuery(params): ApiQuery<AnalyticsParams>,
) -> Result<Json<StockAnalytics>, ApiFailure> {
    let item_id = params
        .item_id
        .as_deref()
        .map(|text| parse_id("item_id", text))
        .transpose()?
        .map(InventoryItemId::from_uuid);
    let all = app::analytics(
        state.db(),
        &request.actor,
        request.request_id,
        item_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(all.into()))
}

/// An item's alert settings, to change; fields left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AlertChanges {
    /// Days from ordering to delivery, 0 to 120 (7 by default).
    pub lead_time_days: Option<i16>,
    /// Whether the item raises stock alerts.
    pub alerts_enabled: Option<bool>,
}

/// An item's alert settings.
#[derive(Debug, Serialize, ToSchema)]
pub struct AlertSettingsBody {
    /// The item.
    #[schema(value_type = String)]
    pub item_id: Uuid,
    /// Days from ordering to delivery.
    pub lead_time_days: i16,
    /// Whether the item raises stock alerts.
    pub alerts_enabled: bool,
}

impl From<AlertSettings> for AlertSettingsBody {
    fn from(settings: AlertSettings) -> Self {
        Self {
            item_id: settings.item_id.uuid(),
            lead_time_days: settings.lead_time_days,
            alerts_enabled: settings.alerts_enabled,
        }
    }
}

/// Changes how long an item takes to arrive and whether it raises stock alerts.
#[utoipa::path(
    patch,
    path = "/api/v1/inventory-items/{id}/alerts",
    operation_id = "updateInventoryItemAlerts",
    tag = "inventory",
    params(("id" = String, Path, description = "The item")),
    request_body = AlertChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = AlertSettingsBody),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks inventory.manage"),
        (status = 404, description = "No such item in this clinic")
    )
)]
pub(crate) async fn update_alerts(
    State(state): State<AppState>,
    Require { request, .. }: Require<InventoryManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<AlertChanges>,
) -> Result<Json<AlertSettingsBody>, ApiFailure> {
    let settings = app::update_alert_settings(
        state.db(),
        &request.actor,
        request.request_id,
        InventoryItemId::from_uuid(id),
        body.lead_time_days,
        body.alerts_enabled,
    )
    .await?;
    Ok(Json(settings.into()))
}
