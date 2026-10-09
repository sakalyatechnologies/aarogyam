//! Changes to a lab order after it is recorded (`labs.write`): its items, and the log of
//! contacting the lab. Each returns the order with its history.

use aarogyam_app::lab_order_changes::{self as app, ContactLogInput, ItemChanges};
use aarogyam_app::lab_orders::ItemInput;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{LabContactId, LabOrderId, LabOrderItemId};
use aarogyam_domain::lab::{ContactLogChannel, ContactOutcome};
use aarogyam_domain::permission::require::LabsWrite;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use sakalya_types::Paise;
use serde::{Deserialize, Deserializer};
use utoipa::ToSchema;
use uuid::Uuid;

use super::lab_orders::{LabOrder, NewLabOrderItem};
use super::parse_day;
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

/// A change to a lab order item. Fields left out stay; an empty shade or material clears.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LabOrderItemChanges {
    /// What to make, up to 80 characters.
    pub work_type: Option<String>,
    /// FDI tooth numbers, each once, up to 32.
    pub teeth: Option<Vec<i64>>,
    /// Shade, up to 20 characters.
    pub shade: Option<String>,
    /// Material, up to 80 characters.
    pub material: Option<String>,
    /// How many, 1 to 100.
    pub qty: Option<i32>,
    /// Paise for one; `null` clears. Setting or clearing needs `finance.view`.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<i64>)]
    #[expect(clippy::option_option, reason = "null clears, absent keeps")]
    pub unit_cost_paise: Option<Option<i64>>,
}

/// How the lab was contacted.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabContactLogChannel {
    /// A phone call.
    Call,
    /// A `WhatsApp` message.
    Whatsapp,
    /// An email.
    Email,
    /// In person.
    Visit,
}

/// What came of contacting the lab.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabContactLogOutcome {
    /// Spoke to someone.
    Reached,
    /// Nobody answered.
    NoAnswer,
    /// The lab promised a date.
    PromisedDate,
    /// Anything else; see the note.
    Other,
}

/// A call, message, email or visit to the lab about an order.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LabContactLogEntry {
    /// How.
    pub channel: LabContactLogChannel,
    /// Who at the lab: a contact of the order's lab.
    #[schema(value_type = Option<String>)]
    pub contact_id: Option<Uuid>,
    /// What came of it.
    pub outcome: Option<LabContactLogOutcome>,
    /// Up to 500 characters.
    pub note: Option<String>,
    /// The date the lab promised, `YYYY-MM-DD`: becomes the due date and restarts reminders.
    pub promised_on: Option<String>,
}

fn item_input(body: NewLabOrderItem) -> ItemInput {
    ItemInput {
        work_type: body.work_type,
        teeth: body.teeth,
        shade: body.shade,
        material: body.material,
        qty: body.qty,
        unit_cost: body.unit_cost_paise.map(Paise::new),
    }
}

/// Adds an item to a lab order that isn't fitted, reworked or cancelled.
#[utoipa::path(
    post,
    path = "/api/v1/lab-orders/{id}/items",
    operation_id = "addLabOrderItem",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order")),
    request_body = NewLabOrderItem,
    security(("bearer" = [])),
    responses(
        (status = 201, body = LabOrder),
        (status = 400, description = "Invalid values, or the order has 50 items"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write, or finance.view for a cost"),
        (status = 404, description = "No such lab order in this clinic or within reach"),
        (status = 409, description = "The order is fitted, reworked or cancelled")
    )
)]
pub(crate) async fn add_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewLabOrderItem>,
) -> Result<(StatusCode, Json<LabOrder>), ApiFailure> {
    let order = LabOrderId::from_uuid(id);
    let input = item_input(body);
    let view = app::add_item(
        state.db(),
        &request.actor,
        request.request_id,
        order,
        &input,
    )
    .await?;
    tracing::info!(event = Event::LabOrderUpdated.as_str(), lab_order_id = %id, "lab order item added");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Changes a lab order item, with the checks of a new one.
#[utoipa::path(
    patch,
    path = "/api/v1/lab-order-items/{id}",
    operation_id = "updateLabOrderItem",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order item")),
    request_body = LabOrderItemChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabOrder),
        (status = 400, description = "Invalid values"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write, or finance.view for a cost"),
        (status = 404, description = "No such item in this clinic or within reach"),
        (status = 409, description = "The order is fitted, reworked or cancelled")
    )
)]
pub(crate) async fn update_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LabOrderItemChanges>,
) -> Result<Json<LabOrder>, ApiFailure> {
    let changes = ItemChanges {
        work_type: body.work_type,
        teeth: body.teeth,
        shade: body.shade,
        material: body.material,
        qty: body.qty,
        unit_cost: body.unit_cost_paise.map(|c| c.map(Paise::new)),
    };
    let item = LabOrderItemId::from_uuid(id);
    let view = app::update_item(
        state.db(),
        &request.actor,
        request.request_id,
        item,
        changes,
    )
    .await?;
    tracing::info!(event = Event::LabOrderUpdated.as_str(), lab_order_id = %view.id.uuid(), "lab order item changed");
    Ok(Json(view.into()))
}

/// Removes a lab order item; an order keeps at least one.
#[utoipa::path(
    delete,
    path = "/api/v1/lab-order-items/{id}",
    operation_id = "removeLabOrderItem",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order item")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabOrder),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such item in this clinic or within reach"),
        (status = 409, description = "The order is final, or this is its last item")
    )
)]
pub(crate) async fn remove_item(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<LabOrder>, ApiFailure> {
    let item = LabOrderItemId::from_uuid(id);
    let view = app::remove_item(state.db(), &request.actor, request.request_id, item).await?;
    tracing::info!(event = Event::LabOrderUpdated.as_str(), lab_order_id = %view.id.uuid(), "lab order item removed");
    Ok(Json(view.into()))
}

impl From<LabContactLogChannel> for ContactLogChannel {
    fn from(channel: LabContactLogChannel) -> Self {
        match channel {
            LabContactLogChannel::Call => Self::Call,
            LabContactLogChannel::Whatsapp => Self::Whatsapp,
            LabContactLogChannel::Email => Self::Email,
            LabContactLogChannel::Visit => Self::Visit,
        }
    }
}

impl From<LabContactLogOutcome> for ContactOutcome {
    fn from(outcome: LabContactLogOutcome) -> Self {
        match outcome {
            LabContactLogOutcome::Reached => Self::Reached,
            LabContactLogOutcome::NoAnswer => Self::NoAnswer,
            LabContactLogOutcome::PromisedDate => Self::PromisedDate,
            LabContactLogOutcome::Other => Self::Other,
        }
    }
}

/// Logs a call, `WhatsApp` message, email or visit to the lab about an order: a `contacted`
/// event by the caller, the order's last contact, and a promised date as its due date.
#[utoipa::path(
    post,
    path = "/api/v1/lab-orders/{id}/contacts-log",
    operation_id = "logLabContact",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order")),
    request_body = LabContactLogEntry,
    security(("bearer" = [])),
    responses(
        (status = 201, body = LabOrder),
        (status = 400, description = "A long note, a bad date, or a contact at another lab"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such lab order in this clinic or within reach"),
        (status = 409, description = "A promised date on a fitted, reworked or cancelled order")
    )
)]
pub(crate) async fn log_contact(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LabContactLogEntry>,
) -> Result<(StatusCode, Json<LabOrder>), ApiFailure> {
    let promised_on = body
        .promised_on
        .as_deref()
        .map(|t| parse_day("promised_on", t))
        .transpose()?;
    let input = ContactLogInput {
        channel: body.channel.into(),
        contact_id: body.contact_id.map(LabContactId::from_uuid),
        outcome: body.outcome.map(Into::into),
        note: body.note,
        promised_on,
    };
    let order = LabOrderId::from_uuid(id);
    let view = app::log_contact(
        state.db(),
        &request.actor,
        request.request_id,
        order,
        &input,
    )
    .await?;
    tracing::info!(event = Event::LabOrderContacted.as_str(), lab_order_id = %id, "lab contacted");
    Ok((StatusCode::CREATED, Json(view.into())))
}
