//! Purchase orders: what the clinic orders from a supplier, from draft to received.
//!
//! - A draft can be edited freely (supplier, lines, dates) and deleted. Sending it makes it
//!   `ordered`; after that only the expected date and notes change, and it can be cancelled
//!   while nothing has been received against it.
//! - Receiving (in whole or in parts) goes through the same path as a delivery keyed in by hand
//!   ([`crate::inventory`]): every line received makes a stock batch and a `receive` movement.
//!   When every line is in, the order is `received`.
//! - Costs on lines, and the order's total, need `finance.view` to read or set; the stock a
//!   receipt makes takes the line's cost.
//!
//! Reading needs `inventory.read`; everything else needs `inventory.manage`.

use aarogyam_dal::purchase_orders::{
    self as dal, LineRow, NewLine, NewOrder, OrderFilter, OrderRow, OrderValues, ReceiptRow,
};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{
    InventoryItemId, PurchaseOrderId, PurchaseOrderLineId, StockBatchId, SupplierId,
};
use aarogyam_domain::inventory::{MAX_MOVEMENT, StockError, StockUnit};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::inventory::{ReceiveInput, check_receive, receive_in, trimmed};
use crate::scope::staff_scope as scope;

/// Most lines on one order.
pub const MAX_LINES: usize = 100;
/// Most orders a list returns.
pub const LIST_LIMIT: i64 = 200;

/// Where an order stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    /// Being put together; not sent.
    Draft,
    /// Sent to the supplier; waiting for the goods.
    Ordered,
    /// Every line has come in.
    Received,
    /// Dropped.
    Cancelled,
}

impl OrderStatus {
    /// The stored and API name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Ordered => "ordered",
            Self::Received => "received",
            Self::Cancelled => "cancelled",
        }
    }

    /// Parses the stored name.
    ///
    /// # Errors
    /// [`AppError::Invalid`] for an unknown status.
    pub fn parse(text: &str) -> Result<Self, AppError> {
        match text {
            "draft" => Ok(Self::Draft),
            "ordered" => Ok(Self::Ordered),
            "received" => Ok(Self::Received),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(AppError::invalid(
                "status",
                "must be draft, ordered, received or cancelled",
            )),
        }
    }
}

/// One line of an order as the API shows it.
#[derive(Debug, Clone)]
pub struct LineView {
    /// Identifier.
    pub id: PurchaseOrderLineId,
    /// Position, from 1.
    pub line_no: i16,
    /// The item.
    pub item_id: InventoryItemId,
    /// Its name.
    pub item_name: String,
    /// Its unit.
    pub unit: StockUnit,
    /// Units ordered.
    pub quantity: i64,
    /// Units received so far.
    pub received_quantity: i64,
    /// Cost of one unit; `None` without `finance.view` or when not given.
    pub unit_cost: Option<Paise>,
}

/// Stock that came in against a line.
#[derive(Debug, Clone)]
pub struct ReceiptView {
    /// The line.
    pub line_id: PurchaseOrderLineId,
    /// The stock batch it made.
    pub batch_id: StockBatchId,
    /// Units.
    pub quantity: i64,
    /// When.
    pub at: OffsetDateTime,
}

/// An order as the API shows it.
#[derive(Debug, Clone)]
pub struct OrderView {
    /// Identifier.
    pub id: PurchaseOrderId,
    /// `PO-12`.
    pub number: String,
    /// The supplier.
    pub supplier_id: SupplierId,
    /// The supplier's name.
    pub supplier_name: String,
    /// Where it stands.
    pub status: OrderStatus,
    /// When the goods are expected.
    pub expected_on: Option<Date>,
    /// Notes.
    pub notes: Option<String>,
    /// When it was sent.
    pub ordered_at: Option<OffsetDateTime>,
    /// When everything had come in.
    pub received_at: Option<OffsetDateTime>,
    /// When it was cancelled.
    pub cancelled_at: Option<OffsetDateTime>,
    /// When it was made.
    pub created_at: OffsetDateTime,
    /// Ordered quantity times cost; `None` without `finance.view`.
    pub total: Option<Paise>,
    /// The lines.
    pub lines: Vec<LineView>,
    /// What has come in against them, oldest first.
    pub receipts: Vec<ReceiptView>,
}

fn line_view(row: LineRow, costs: bool) -> LineView {
    LineView {
        id: PurchaseOrderLineId::from_uuid(row.id),
        line_no: row.line_no,
        item_id: InventoryItemId::from_uuid(row.item_id),
        item_name: row.item_name,
        unit: StockUnit::parse(&row.unit).unwrap_or_default(),
        quantity: row.quantity,
        received_quantity: row.received_quantity,
        unit_cost: if costs {
            row.unit_cost_paise.map(Paise::new)
        } else {
            None
        },
    }
}

fn receipt_view(row: &ReceiptRow) -> ReceiptView {
    ReceiptView {
        line_id: PurchaseOrderLineId::from_uuid(row.line_id),
        batch_id: StockBatchId::from_uuid(row.batch_id),
        quantity: row.quantity,
        at: row.at,
    }
}

/// Orders read as the API shows them, with their lines and receipts.
async fn load(
    tx: &mut ScopedTx,
    filter: &OrderFilter<'_>,
    costs: bool,
) -> Result<Vec<OrderView>, AppError> {
    let orders = dal::orders(tx.conn(), filter).await?;
    let ids: Vec<Uuid> = orders.iter().map(|order| order.id).collect();
    let lines = dal::lines(tx.conn(), &ids).await?;
    let receipts = dal::receipts(tx.conn(), &ids).await?;
    Ok(orders
        .into_iter()
        .map(|order: OrderRow| OrderView {
            id: PurchaseOrderId::from_uuid(order.id),
            number: order.number,
            supplier_id: SupplierId::from_uuid(order.supplier_id),
            supplier_name: order.supplier_name,
            status: OrderStatus::parse(&order.status).unwrap_or(OrderStatus::Draft),
            expected_on: order.expected_on,
            notes: order.notes,
            ordered_at: order.ordered_at,
            received_at: order.received_at,
            cancelled_at: order.cancelled_at,
            created_at: order.created_at,
            total: costs.then(|| Paise::new(order.total_paise)),
            lines: lines
                .iter()
                .filter(|line| line.order_id == order.id)
                .cloned()
                .map(|line| line_view(line, costs))
                .collect(),
            receipts: receipts
                .iter()
                .filter(|receipt| receipt.order_id == order.id)
                .map(receipt_view)
                .collect(),
        })
        .collect())
}

async fn load_one(tx: &mut ScopedTx, id: Uuid, costs: bool) -> Result<OrderView, AppError> {
    load(
        tx,
        &OrderFilter {
            id: Some(id),
            limit: 1,
            ..OrderFilter::default()
        },
        costs,
    )
    .await?
    .into_iter()
    .next()
    .ok_or(AppError::NotFound("purchase order"))
}

fn can_see_costs(actor: &ClinicActor) -> bool {
    actor.require(Permission::FinanceView).is_ok()
}

/// Orders, newest first, optionally of one status or supplier.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::Db`] on failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    status: Option<OrderStatus>,
    supplier_id: Option<SupplierId>,
) -> Result<Vec<OrderView>, AppError> {
    actor.require(Permission::InventoryRead)?;
    let costs = can_see_costs(actor);
    db.scoped(&scope(actor, request_id), async |tx| {
        load(
            tx,
            &OrderFilter {
                status: status.map(OrderStatus::as_str),
                supplier_id: supplier_id.map(SupplierId::uuid),
                limit: LIST_LIMIT,
                ..OrderFilter::default()
            },
            costs,
        )
        .await
    })
    .await
}

/// One order.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::NotFound`] for an unknown order.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PurchaseOrderId,
) -> Result<OrderView, AppError> {
    actor.require(Permission::InventoryRead)?;
    let costs = can_see_costs(actor);
    db.scoped(&scope(actor, request_id), async |tx| {
        load_one(tx, id.uuid(), costs).await
    })
    .await
}

/// A line to order.
#[derive(Debug, Clone, Copy)]
pub struct LineInput {
    /// The item.
    pub item_id: InventoryItemId,
    /// Units, 1 to 1,000,000.
    pub quantity: i64,
    /// Cost of one unit in paise; needs `finance.view`.
    pub unit_cost_paise: Option<i64>,
}

fn check_lines(lines: &[LineInput], costs: bool) -> Result<(), AppError> {
    if lines.is_empty() {
        return Err(AppError::invalid("lines", "needs at least one line"));
    }
    if lines.len() > MAX_LINES {
        return Err(AppError::invalid(
            "lines",
            format!("can have at most {MAX_LINES} lines"),
        ));
    }
    for (index, line) in lines.iter().enumerate() {
        if !(1..=MAX_MOVEMENT).contains(&line.quantity) {
            return Err(AppError::invalid("lines.quantity", StockError::Quantity));
        }
        if let Some(cost) = line.unit_cost_paise {
            if !costs {
                return Err(AppError::Forbidden("setting costs needs finance.view"));
            }
            if !(0..=100_000_000).contains(&cost) {
                return Err(AppError::invalid("lines.unit_cost_paise", StockError::Cost));
            }
        }
        if lines[..index]
            .iter()
            .any(|other| other.item_id == line.item_id)
        {
            return Err(AppError::invalid(
                "lines.item_id",
                "an item is on the order twice",
            ));
        }
    }
    Ok(())
}

/// Checks every item exists and returns the new lines.
async fn new_lines(tx: &mut ScopedTx, lines: &[LineInput]) -> Result<Vec<NewLine>, AppError> {
    let mut out = Vec::with_capacity(lines.len());
    for line in lines {
        aarogyam_dal::inventory::item(tx.conn(), line.item_id.uuid())
            .await?
            .ok_or(AppError::NotFound("item"))?;
        out.push(NewLine {
            id: PurchaseOrderLineId::new_v7().uuid(),
            item_id: line.item_id.uuid(),
            quantity: line.quantity,
            unit_cost_paise: line.unit_cost_paise,
        });
    }
    Ok(out)
}

fn notes_of(text: Option<&str>) -> Result<Option<String>, AppError> {
    trimmed(text, "notes", 1000)
}

/// An order to make.
#[derive(Debug, Clone)]
pub struct NewOrderInput {
    /// The supplier.
    pub supplier_id: SupplierId,
    /// When the goods are expected.
    pub expected_on: Option<Date>,
    /// Notes.
    pub notes: Option<String>,
    /// What to order: 1 to 100 lines, an item once each.
    pub lines: Vec<LineInput>,
    /// Whether it is sent now; otherwise it is a draft.
    pub order_now: bool,
}

/// Makes an order, as a draft or sent at once.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Forbidden`] for costs without
/// `finance.view`; [`AppError::Invalid`] for bad lines; [`AppError::NotFound`] for an unknown
/// supplier or item.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewOrderInput,
    now: OffsetDateTime,
) -> Result<OrderView, AppError> {
    actor.require(Permission::InventoryManage)?;
    let costs = can_see_costs(actor);
    check_lines(&input.lines, costs)?;
    let notes = notes_of(input.notes.as_deref())?;
    db.scoped(&scope(actor, request_id), async |tx| {
        aarogyam_dal::inventory::supplier(tx.conn(), input.supplier_id.uuid())
            .await?
            .ok_or(AppError::NotFound("supplier"))?;
        let lines = new_lines(tx, &input.lines).await?;
        let serial = aarogyam_dal::patients::next_number(tx.conn(), "purchase_order").await?;
        let number = format!("PO-{serial}");
        let id = PurchaseOrderId::new_v7();
        dal::insert_order(
            tx.conn(),
            &NewOrder {
                id: id.uuid(),
                number: &number,
                supplier_id: input.supplier_id.uuid(),
                status: if input.order_now {
                    OrderStatus::Ordered.as_str()
                } else {
                    OrderStatus::Draft.as_str()
                },
                expected_on: input.expected_on,
                notes: notes.as_deref(),
                ordered_at: input.order_now.then_some(now),
            },
        )
        .await?;
        dal::insert_lines(tx.conn(), id.uuid(), &lines).await?;
        load_one(tx, id.uuid(), costs).await
    })
    .await
}

/// A change to an order. Fields left out stay as they are.
#[derive(Debug, Clone, Default)]
pub struct OrderChanges {
    /// Another supplier (draft only).
    pub supplier_id: Option<SupplierId>,
    /// A new expected date; `Some(None)` clears it.
    pub expected_on: Option<Option<Date>>,
    /// New notes; an empty string clears them.
    pub notes: Option<String>,
    /// Replaces every line (draft only).
    pub lines: Option<Vec<LineInput>>,
    /// Send it (`Ordered`, from a draft) or drop it (`Cancelled`).
    pub status: Option<OrderStatus>,
}

/// Changes an order.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::NotFound`];
/// [`AppError::Conflict`] when the order's state doesn't allow the change (lines or supplier
/// after it was sent, any change once received or cancelled, cancelling after stock came in,
/// a status other than ordered or cancelled); [`AppError::Invalid`] for bad values.
pub async fn update(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PurchaseOrderId,
    changes: OrderChanges,
    now: OffsetDateTime,
) -> Result<OrderView, AppError> {
    actor.require(Permission::InventoryManage)?;
    let costs = can_see_costs(actor);
    if let Some(lines) = &changes.lines {
        check_lines(lines, costs)?;
    }
    let notes = match changes.notes.as_deref() {
        Some(text) => Some(notes_of(Some(text))?),
        None => None,
    };
    if matches!(
        changes.status,
        Some(OrderStatus::Draft | OrderStatus::Received)
    ) {
        return Err(AppError::Conflict(
            "an order becomes received by receiving stock, and never goes back to a draft",
        ));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let status = dal::lock_order(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("purchase order"))
            .and_then(|text| OrderStatus::parse(&text))?;
        let current = load_one(tx, id.uuid(), true).await?;
        match status {
            OrderStatus::Received | OrderStatus::Cancelled => {
                return Err(AppError::Conflict(
                    "a received or cancelled order is final",
                ));
            }
            OrderStatus::Ordered => {
                if changes.lines.is_some() || changes.supplier_id.is_some() {
                    return Err(AppError::Conflict(
                        "an order that was sent keeps its supplier and lines; cancel it and make another",
                    ));
                }
            }
            OrderStatus::Draft => {}
        }
        if changes.status == Some(OrderStatus::Cancelled) && !current.receipts.is_empty() {
            return Err(AppError::Conflict(
                "stock has been received against this order",
            ));
        }
        if changes.status == Some(OrderStatus::Ordered) && status != OrderStatus::Draft {
            return Err(AppError::Conflict("the order was already sent"));
        }
        let supplier_id = changes.supplier_id.unwrap_or(current.supplier_id);
        if supplier_id != current.supplier_id {
            aarogyam_dal::inventory::supplier(tx.conn(), supplier_id.uuid())
                .await?
                .ok_or(AppError::NotFound("supplier"))?;
        }
        let new_notes = match &notes {
            Some(value) => value.as_deref(),
            None => current.notes.as_deref(),
        };
        dal::update_order(
            tx.conn(),
            id.uuid(),
            &OrderValues {
                supplier_id: supplier_id.uuid(),
                expected_on: changes.expected_on.unwrap_or(current.expected_on),
                notes: new_notes,
            },
        )
        .await?;
        if let Some(lines) = &changes.lines {
            let lines = new_lines(tx, lines).await?;
            dal::delete_lines(tx.conn(), id.uuid()).await?;
            dal::insert_lines(tx.conn(), id.uuid(), &lines).await?;
        }
        if let Some(next @ (OrderStatus::Ordered | OrderStatus::Cancelled)) = changes.status {
            dal::set_status(tx.conn(), id.uuid(), next.as_str(), now).await?;
        }
        load_one(tx, id.uuid(), costs).await
    })
    .await
}

/// Deletes a draft.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::NotFound`];
/// [`AppError::Conflict`] unless the order is a draft.
pub async fn delete(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PurchaseOrderId,
) -> Result<(), AppError> {
    actor.require(Permission::InventoryManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let status = dal::lock_order(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("purchase order"))
            .and_then(|text| OrderStatus::parse(&text))?;
        if status != OrderStatus::Draft {
            return Err(AppError::Conflict(
                "only a draft can be deleted; cancel an order that was sent",
            ));
        }
        dal::delete_order(tx.conn(), id.uuid()).await?;
        Ok(())
    })
    .await
}

/// A delivery against one line.
#[derive(Debug, Clone)]
pub struct ReceiveLine {
    /// The order's line.
    pub line_id: PurchaseOrderLineId,
    /// Units that arrived, up to what is still to come.
    pub quantity: i64,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used.
    pub expiry: Option<Date>,
    /// What one unit really cost, if not the line's cost; needs `finance.view`.
    pub unit_cost_paise: Option<i64>,
}

/// A receipt of goods against an order.
#[derive(Debug, Clone, Default)]
pub struct ReceiveInputs {
    /// What arrived. Empty receives everything still to come, at the line costs.
    pub lines: Vec<ReceiveLine>,
    /// The day it arrived; today by default.
    pub received_on: Option<Date>,
}

/// Receives goods against an ordered order: every line makes a stock batch and a `receive`
/// movement through the usual receive path. The order becomes `received` once every line is in.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::NotFound`] for an unknown order
/// or line; [`AppError::Conflict`] unless the order is `ordered`; [`AppError::Invalid`] for a
/// quantity past what is still to come, a line twice, or bad values;
/// [`AppError::Forbidden`] for a cost without `finance.view`.
pub async fn receive(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PurchaseOrderId,
    input: ReceiveInputs,
    now: OffsetDateTime,
) -> Result<OrderView, AppError> {
    actor.require(Permission::InventoryManage)?;
    let costs = can_see_costs(actor);
    for (index, line) in input.lines.iter().enumerate() {
        if line.unit_cost_paise.is_some() && !costs {
            return Err(AppError::Forbidden("setting costs needs finance.view"));
        }
        if input.lines[..index]
            .iter()
            .any(|other| other.line_id == line.line_id)
        {
            return Err(AppError::invalid(
                "lines.line_id",
                "a line is received twice",
            ));
        }
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        let status = dal::lock_order(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("purchase order"))
            .and_then(|text| OrderStatus::parse(&text))?;
        if status != OrderStatus::Ordered {
            return Err(AppError::Conflict(
                "only an order that was sent can be received",
            ));
        }
        let order = load_one(tx, id.uuid(), false).await?;
        let lines = dal::lock_lines(tx.conn(), id.uuid()).await?;
        // What to receive, line by line.
        let plan: Vec<(LineRow, ReceiveLine)> = if input.lines.is_empty() {
            lines
                .iter()
                .filter(|line| line.received_quantity < line.quantity)
                .map(|line| {
                    (
                        line.clone(),
                        ReceiveLine {
                            line_id: PurchaseOrderLineId::from_uuid(line.id),
                            quantity: line.quantity - line.received_quantity,
                            batch_no: None,
                            expiry: None,
                            unit_cost_paise: None,
                        },
                    )
                })
                .collect()
        } else {
            let mut plan = Vec::with_capacity(input.lines.len());
            for wanted in &input.lines {
                let line = lines
                    .iter()
                    .find(|line| line.id == wanted.line_id.uuid())
                    .ok_or(AppError::NotFound("purchase order line"))?;
                plan.push((line.clone(), wanted.clone()));
            }
            plan
        };
        if plan.is_empty() {
            return Err(AppError::Conflict("everything has been received"));
        }
        for (line, wanted) in &plan {
            if wanted.quantity > line.quantity - line.received_quantity {
                return Err(AppError::invalid(
                    "lines.quantity",
                    "is more than is still to come on the line",
                ));
            }
        }
        for (line, wanted) in plan {
            let receive = ReceiveInput {
                item_id: InventoryItemId::from_uuid(line.item_id),
                supplier_id: Some(order.supplier_id),
                batch_no: wanted.batch_no.clone(),
                expiry: wanted.expiry,
                quantity: wanted.quantity,
                unit_cost_paise: wanted.unit_cost_paise.or(line.unit_cost_paise).unwrap_or(0),
                received_on: Some(input.received_on.unwrap_or(today)),
            };
            let batch_no = check_receive(&receive)?;
            let (batch, _) = receive_in(tx, &receive, batch_no.as_deref(), today).await?;
            dal::add_received(tx.conn(), line.id, wanted.quantity).await?;
            dal::insert_receipt(tx.conn(), id.uuid(), line.id, batch.id, wanted.quantity).await?;
        }
        let done = dal::lines(tx.conn(), &[id.uuid()])
            .await?
            .iter()
            .all(|line| line.received_quantity >= line.quantity);
        if done {
            dal::set_status(tx.conn(), id.uuid(), OrderStatus::Received.as_str(), now).await?;
        }
        load_one(tx, id.uuid(), costs).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(item: InventoryItemId, quantity: i64, cost: Option<i64>) -> LineInput {
        LineInput {
            item_id: item,
            quantity,
            unit_cost_paise: cost,
        }
    }

    #[test]
    fn lines_are_checked() {
        let (a, b) = (InventoryItemId::new_v7(), InventoryItemId::new_v7());
        assert!(check_lines(&[line(a, 5, None), line(b, 1, Some(100))], true).is_ok());
        assert!(check_lines(&[], true).is_err());
        assert!(check_lines(&[line(a, 0, None)], true).is_err());
        assert!(check_lines(&[line(a, 2_000_000, None)], true).is_err());
        assert!(check_lines(&[line(a, 1, None), line(a, 2, None)], true).is_err());
        assert!(check_lines(&[line(a, 1, Some(-1))], true).is_err());
        // A cost without finance.view is refused, not dropped.
        assert!(matches!(
            check_lines(&[line(a, 1, Some(100))], false),
            Err(AppError::Forbidden(_))
        ));
    }

    #[test]
    fn statuses_round_trip() {
        for status in [
            OrderStatus::Draft,
            OrderStatus::Ordered,
            OrderStatus::Received,
            OrderStatus::Cancelled,
        ] {
            assert_eq!(OrderStatus::parse(status.as_str()).unwrap(), status);
        }
        assert!(OrderStatus::parse("shipped").is_err());
    }
}
