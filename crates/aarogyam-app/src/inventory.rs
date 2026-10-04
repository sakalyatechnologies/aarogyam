//! The clinic's stock: items, suppliers, deliveries, use and corrections. A use takes from the
//! batch that expires first; stock never goes below zero.

use aarogyam_dal::clinic;
use aarogyam_dal::inventory::{
    self as dal, BatchValues, ItemRow, ItemValues, StockRow, SupplierValues,
};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinic::Gstin;
use aarogyam_domain::ids::{InventoryItemId, StockBatchId, SupplierId};
use aarogyam_domain::inventory::{
    EXPIRY_WINDOW_DAYS, MAX_MOVEMENT, MovementKind, Shelf, StockError, StockStatus, StockUnit,
    check_quantity, is_expired, is_expiring, pick_fefo, status,
};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::{CallingCode, Paise, PhoneE164};
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// How many movements an item's detail shows.
pub const HISTORY: i64 = 50;

fn stock(field: &'static str) -> impl Fn(StockError) -> AppError {
    move |error| AppError::invalid(field, error)
}

/// Trims optional text; empty means none.
fn trimmed(
    text: Option<&str>,
    field: &'static str,
    max: usize,
) -> Result<Option<String>, AppError> {
    match text.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) if text.chars().count() > max => Err(AppError::invalid(
            field,
            format!("must be at most {max} characters"),
        )),
        Some(text) => Ok(Some(text.to_owned())),
    }
}

fn required(text: Option<&str>, field: &'static str, max: usize) -> Result<String, AppError> {
    trimmed(text, field, max)?.ok_or(AppError::invalid(field, "is required"))
}

fn is_category(text: &str) -> bool {
    let bytes = text.as_bytes();
    (1..=40).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_')
}

// ------------------------------------------------------------------ suppliers

/// A supplier as the API shows it.
#[derive(Debug, Clone)]
pub struct SupplierView {
    /// Identifier.
    pub id: SupplierId,
    /// Name.
    pub name: String,
    /// Phone in E.164.
    pub phone: Option<String>,
    /// GSTIN.
    pub gstin: Option<String>,
    /// Still bought from.
    pub active: bool,
}

impl From<dal::SupplierRow> for SupplierView {
    fn from(row: dal::SupplierRow) -> Self {
        Self {
            id: SupplierId::from_uuid(row.id),
            name: row.name,
            phone: row.phone_e164,
            gstin: row.gstin,
            active: row.active,
        }
    }
}

/// A supplier's values, as received. On a change, `None` keeps the current value and an empty
/// string clears an optional one.
#[derive(Debug, Clone, Default)]
pub struct SupplierInput {
    /// Name.
    pub name: Option<String>,
    /// Phone; +91 is assumed without a country code.
    pub phone: Option<String>,
    /// GSTIN.
    pub gstin: Option<String>,
    /// Still bought from.
    pub active: Option<bool>,
}

struct SupplierFields {
    name: String,
    phone: Option<String>,
    gstin: Option<String>,
    active: bool,
}

fn merge_supplier(
    current: Option<&dal::SupplierRow>,
    input: &SupplierInput,
) -> Result<SupplierFields, AppError> {
    let name = required(
        input.name.as_deref().or(current.map(|c| c.name.as_str())),
        "name",
        200,
    )?;
    let phone = match input.phone.as_deref() {
        Some(text) => trimmed(Some(text), "phone", 30)?,
        None => current.and_then(|c| c.phone_e164.clone()),
    };
    let phone = phone
        .map(|text| {
            PhoneE164::parse_with_default(&text, CallingCode::INDIA)
                .map(|phone| phone.as_e164().to_owned())
                .map_err(|_| AppError::invalid("phone", "must be a phone number"))
        })
        .transpose()?;
    let gstin = match input.gstin.as_deref() {
        Some(text) => trimmed(Some(text), "gstin", 15)?,
        None => current.and_then(|c| c.gstin.clone()),
    };
    let gstin = gstin
        .map(|text| {
            Gstin::parse(&text)
                .map(|gstin| gstin.as_str().to_owned())
                .map_err(|error| AppError::invalid("gstin", error))
        })
        .transpose()?;
    Ok(SupplierFields {
        name,
        phone,
        gstin,
        active: input.active.or(current.map(|c| c.active)).unwrap_or(true),
    })
}

impl SupplierFields {
    fn values(&self) -> SupplierValues<'_> {
        SupplierValues {
            name: &self.name,
            phone_e164: self.phone.as_deref(),
            gstin: self.gstin.as_deref(),
            active: self.active,
        }
    }
}

fn supplier_name_taken(error: AppError) -> AppError {
    match error {
        AppError::Db(db) => {
            AppError::on_constraint(db, "suppliers_name", "a supplier has this name")
        }
        other => other,
    }
}

/// The suppliers.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::Db`] on failures.
pub async fn suppliers(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<SupplierView>, AppError> {
    actor.require(Permission::InventoryRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::suppliers(tx.conn()).await?;
        Ok(rows.into_iter().map(SupplierView::from).collect())
    })
    .await
}

/// Adds a supplier.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Invalid`] for bad values;
/// [`AppError::Conflict`] for a taken name.
pub async fn create_supplier(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: SupplierInput,
) -> Result<SupplierView, AppError> {
    actor.require(Permission::InventoryManage)?;
    let fields = merge_supplier(None, &input)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row =
            dal::insert_supplier(tx.conn(), SupplierId::new_v7().uuid(), &fields.values()).await?;
        Ok(SupplierView::from(row))
    })
    .await
    .map_err(supplier_name_taken)
}

/// Changes a supplier.
///
/// # Errors
/// As [`create_supplier`], and [`AppError::NotFound`] for an unknown supplier.
pub async fn update_supplier(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: SupplierId,
    input: SupplierInput,
) -> Result<SupplierView, AppError> {
    actor.require(Permission::InventoryManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::supplier(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("supplier"))?;
        let fields = merge_supplier(Some(&current), &input)?;
        let row = dal::update_supplier(tx.conn(), id.uuid(), &fields.values())
            .await?
            .ok_or(AppError::NotFound("supplier"))?;
        Ok(SupplierView::from(row))
    })
    .await
    .map_err(supplier_name_taken)
}

/// Removes a supplier from the list. Batches already received keep their supplier.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::NotFound`] for an unknown one.
pub async fn delete_supplier(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: SupplierId,
) -> Result<(), AppError> {
    actor.require(Permission::InventoryManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::delete_supplier(tx.conn(), id.uuid()).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("supplier"))
        }
    })
    .await
}

// ------------------------------------------------------------------ items

/// An item as the API shows it.
#[derive(Debug, Clone)]
pub struct ItemView {
    /// Identifier.
    pub id: InventoryItemId,
    /// Name.
    pub name: String,
    /// Category.
    pub category: Option<String>,
    /// Unit.
    pub unit: StockUnit,
    /// At or below this the item is low.
    pub reorder_level: i64,
    /// Still stocked.
    pub active: bool,
}

impl From<ItemRow> for ItemView {
    fn from(row: ItemRow) -> Self {
        Self {
            id: InventoryItemId::from_uuid(row.id),
            name: row.name,
            category: row.category,
            unit: StockUnit::parse(&row.unit).unwrap_or_default(),
            reorder_level: row.reorder_level,
            active: row.active,
        }
    }
}

/// An item's values, as received. On a change, `None` keeps the current value and an empty
/// string clears the category.
#[derive(Debug, Clone, Default)]
pub struct ItemInput {
    /// Name.
    pub name: Option<String>,
    /// Category: lower case, digits and `_`.
    pub category: Option<String>,
    /// Unit: piece, ml, g, box or pack.
    pub unit: Option<String>,
    /// Reorder level.
    pub reorder_level: Option<i64>,
    /// Still stocked.
    pub active: Option<bool>,
}

struct ItemFields {
    name: String,
    category: Option<String>,
    unit: StockUnit,
    reorder_level: i64,
    active: bool,
}

fn merge_item(current: Option<&ItemRow>, input: &ItemInput) -> Result<ItemFields, AppError> {
    let name = required(
        input.name.as_deref().or(current.map(|c| c.name.as_str())),
        "name",
        200,
    )?;
    let category = match input.category.as_deref() {
        Some(text) => trimmed(Some(text), "category", 40)?.map(|text| text.to_lowercase()),
        None => current.and_then(|c| c.category.clone()),
    };
    if category.as_deref().is_some_and(|text| !is_category(text)) {
        return Err(AppError::invalid("category", "has an invalid format"));
    }
    let unit = match input.unit.as_deref() {
        Some(text) => StockUnit::parse(text.trim()).map_err(stock("unit"))?,
        None => current
            .map(|c| StockUnit::parse(&c.unit))
            .transpose()
            .map_err(stock("unit"))?
            .unwrap_or_default(),
    };
    let reorder_level = input
        .reorder_level
        .or(current.map(|c| c.reorder_level))
        .unwrap_or(0);
    if !(0..=MAX_MOVEMENT).contains(&reorder_level) {
        return Err(AppError::invalid("reorder_level", StockError::ReorderLevel));
    }
    Ok(ItemFields {
        name,
        category,
        unit,
        reorder_level,
        active: input.active.or(current.map(|c| c.active)).unwrap_or(true),
    })
}

impl ItemFields {
    fn values(&self) -> ItemValues<'_> {
        ItemValues {
            name: &self.name,
            category: self.category.as_deref(),
            unit: self.unit.as_str(),
            reorder_level: self.reorder_level,
            active: self.active,
        }
    }
}

fn item_name_taken(error: AppError) -> AppError {
    match error {
        AppError::Db(db) => {
            AppError::on_constraint(db, "inventory_items_name", "an item has this name")
        }
        other => other,
    }
}

/// An item with what is on its shelf.
#[derive(Debug, Clone)]
pub struct StockItem {
    /// The item.
    pub item: ItemView,
    /// Units on hand.
    pub on_hand: i64,
    /// Earliest expiry among batches with stock left.
    pub next_expiry: Option<Date>,
    /// Where it stands.
    pub status: StockStatus,
}

impl StockItem {
    fn new(row: StockRow, today: Date) -> Self {
        let status = status(
            row.on_hand,
            row.reorder_level,
            is_expiring(row.next_expiry, today),
        );
        Self {
            on_hand: row.on_hand,
            next_expiry: row.next_expiry,
            status,
            item: ItemView {
                id: InventoryItemId::from_uuid(row.id),
                name: row.name,
                category: row.category,
                unit: StockUnit::parse(&row.unit).unwrap_or_default(),
                reorder_level: row.reorder_level,
                active: row.active,
            },
        }
    }
}

/// The items by name, each with its level.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::Db`] on failures.
pub async fn items(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Vec<StockItem>, AppError> {
    actor.require(Permission::InventoryRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        Ok(dal::stock(tx.conn())
            .await?
            .into_iter()
            .map(|row| StockItem::new(row, today))
            .collect())
    })
    .await
}

/// Adds an item.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Invalid`] for bad values;
/// [`AppError::Conflict`] for a taken name.
pub async fn create_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: ItemInput,
) -> Result<ItemView, AppError> {
    actor.require(Permission::InventoryManage)?;
    let fields = merge_item(None, &input)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::insert_item(
            tx.conn(),
            InventoryItemId::new_v7().uuid(),
            &fields.values(),
        )
        .await?;
        Ok(ItemView::from(row))
    })
    .await
    .map_err(item_name_taken)
}

/// Changes an item.
///
/// # Errors
/// As [`create_item`], and [`AppError::NotFound`] for an unknown item.
pub async fn update_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InventoryItemId,
    input: ItemInput,
) -> Result<ItemView, AppError> {
    actor.require(Permission::InventoryManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::item(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("item"))?;
        let fields = merge_item(Some(&current), &input)?;
        let row = dal::update_item(tx.conn(), id.uuid(), &fields.values())
            .await?
            .ok_or(AppError::NotFound("item"))?;
        Ok(ItemView::from(row))
    })
    .await
    .map_err(item_name_taken)
}

/// Removes an item from the lists. Only an item with nothing on the shelf can go; its history
/// stays.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::NotFound`] for an unknown
/// item; [`AppError::Conflict`] while stock is left.
pub async fn delete_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InventoryItemId,
) -> Result<(), AppError> {
    actor.require(Permission::InventoryManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::item(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("item"))?;
        if dal::on_hand(tx.conn(), id.uuid()).await? > 0 {
            return Err(AppError::Conflict(
                "the item still has stock; use or write it off first",
            ));
        }
        dal::delete_item(tx.conn(), id.uuid()).await?;
        Ok(())
    })
    .await
}

// ------------------------------------------------------------------ batches and movements

/// A delivery as the API shows it.
#[derive(Debug, Clone)]
pub struct BatchView {
    /// Identifier.
    pub id: StockBatchId,
    /// The supplier.
    pub supplier_id: Option<SupplierId>,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used.
    pub expiry: Option<Date>,
    /// Units that arrived.
    pub received_quantity: i64,
    /// Units left.
    pub quantity: i64,
    /// Cost of one unit.
    pub unit_cost: Paise,
    /// Day it arrived.
    pub received_on: Date,
}

impl From<dal::BatchRow> for BatchView {
    fn from(row: dal::BatchRow) -> Self {
        Self {
            id: StockBatchId::from_uuid(row.id),
            supplier_id: row.supplier_id.map(SupplierId::from_uuid),
            batch_no: row.batch_no,
            expiry: row.expiry,
            received_quantity: row.received_quantity,
            quantity: row.quantity,
            unit_cost: Paise::new(row.unit_cost_paise),
            received_on: row.received_on,
        }
    }
}

/// A change in stock as the API shows it.
#[derive(Debug, Clone)]
pub struct MovementView {
    /// Identifier.
    pub id: Uuid,
    /// The batch touched.
    pub batch_id: StockBatchId,
    /// `receive`, `use`, `adjust` or `expire`.
    pub kind: String,
    /// Signed units.
    pub quantity: i64,
    /// Why.
    pub reason: Option<String>,
    /// When.
    pub at: OffsetDateTime,
    /// Who.
    pub by: Option<Uuid>,
}

impl From<dal::MovementRow> for MovementView {
    fn from(row: dal::MovementRow) -> Self {
        Self {
            id: row.id,
            batch_id: StockBatchId::from_uuid(row.batch_id),
            kind: row.kind,
            quantity: row.quantity,
            reason: row.reason,
            at: row.at,
            by: row.by_user_id,
        }
    }
}

/// An item with its shelf and history.
#[derive(Debug, Clone)]
pub struct ItemDetail {
    /// The item and where it stands.
    pub stock: StockItem,
    /// Its deliveries, those with stock first.
    pub batches: Vec<BatchView>,
    /// The latest changes, newest first.
    pub movements: Vec<MovementView>,
}

/// One item with its batches and latest movements.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::NotFound`] for an unknown item.
pub async fn item_detail(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InventoryItemId,
    now: OffsetDateTime,
) -> Result<ItemDetail, AppError> {
    actor.require(Permission::InventoryRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        item_detail_in(tx, id, today).await
    })
    .await
}

async fn item_detail_in(
    tx: &mut ScopedTx,
    id: InventoryItemId,
    today: Date,
) -> Result<ItemDetail, AppError> {
    let stock = stock_item_in(tx, id, today).await?;
    let batches = dal::batches(tx.conn(), id.uuid())
        .await?
        .into_iter()
        .map(BatchView::from)
        .collect();
    let movements = dal::movements(tx.conn(), id.uuid(), HISTORY)
        .await?
        .into_iter()
        .map(MovementView::from)
        .collect();
    Ok(ItemDetail {
        stock,
        batches,
        movements,
    })
}

async fn today_of(tx: &mut ScopedTx, now: OffsetDateTime) -> Result<Date, AppError> {
    let profile = clinic::profile(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    Ok(clinic_today(&profile.timezone, now))
}

async fn stock_item_in(
    tx: &mut ScopedTx,
    id: InventoryItemId,
    today: Date,
) -> Result<StockItem, AppError> {
    dal::stock(tx.conn())
        .await?
        .into_iter()
        .find(|row| row.id == id.uuid())
        .map(|row| StockItem::new(row, today))
        .ok_or(AppError::NotFound("item"))
}

/// A delivery as received.
#[derive(Debug, Clone)]
pub struct ReceiveInput {
    /// The item.
    pub item_id: InventoryItemId,
    /// Where it came from.
    pub supplier_id: Option<SupplierId>,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used.
    pub expiry: Option<Date>,
    /// Units that arrived.
    pub quantity: i64,
    /// Cost of one unit in paise.
    pub unit_cost_paise: i64,
    /// Day it arrived; today by default.
    pub received_on: Option<Date>,
}

/// What a change did.
#[derive(Debug, Clone)]
pub struct StockChange {
    /// The item as it stands now.
    pub stock: StockItem,
    /// The movements recorded, one per batch touched.
    pub movements: Vec<MovementView>,
}

/// Adds a delivery to stock: a batch and a `receive` movement.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Invalid`] for bad values;
/// [`AppError::NotFound`] for an unknown item or supplier.
pub async fn receive(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: ReceiveInput,
    now: OffsetDateTime,
) -> Result<StockChange, AppError> {
    actor.require(Permission::InventoryManage)?;
    check_quantity(input.quantity).map_err(stock("quantity"))?;
    if input.unit_cost_paise < 0 {
        return Err(AppError::invalid("unit_cost_paise", StockError::Cost));
    }
    let batch_no = trimmed(input.batch_no.as_deref(), "batch_no", 60)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        dal::item(tx.conn(), input.item_id.uuid())
            .await?
            .ok_or(AppError::NotFound("item"))?;
        if let Some(supplier) = input.supplier_id {
            dal::supplier(tx.conn(), supplier.uuid())
                .await?
                .ok_or(AppError::NotFound("supplier"))?;
        }
        let batch = dal::insert_batch(
            tx.conn(),
            StockBatchId::new_v7().uuid(),
            &BatchValues {
                item_id: input.item_id.uuid(),
                supplier_id: input.supplier_id.map(SupplierId::uuid),
                batch_no: batch_no.as_deref(),
                expiry: input.expiry,
                quantity: input.quantity,
                unit_cost_paise: input.unit_cost_paise,
                received_on: input.received_on.unwrap_or(today),
            },
        )
        .await?;
        let movement = dal::insert_movement(
            tx.conn(),
            Uuid::now_v7(),
            input.item_id.uuid(),
            batch.id,
            MovementKind::Receive.as_str(),
            input.quantity,
            None,
        )
        .await?;
        Ok(StockChange {
            stock: stock_item_in(tx, input.item_id, today).await?,
            movements: vec![MovementView::from(movement)],
        })
    })
    .await
}

/// Takes `quantity` units of an item, earliest expiry first, and records each batch touched.
async fn take(
    tx: &mut ScopedTx,
    item_id: InventoryItemId,
    quantity: i64,
    kind: MovementKind,
    reason: Option<&str>,
    skip_expired_on: Date,
) -> Result<Vec<MovementView>, AppError> {
    let batches = dal::lock_batches(tx.conn(), item_id.uuid()).await?;
    let shelves: Vec<Shelf<Uuid>> = batches
        .iter()
        .map(|batch| Shelf {
            id: batch.id,
            expiry: batch.expiry,
            received_on: batch.received_on,
            quantity: batch.quantity,
        })
        .collect();
    let picks = pick_fefo(&shelves, quantity, skip_expired_on).map_err(|error| match error {
        StockError::Insufficient => AppError::Conflict("not enough stock on the shelf"),
        other => AppError::invalid("quantity", other),
    })?;
    let mut movements = Vec::with_capacity(picks.len());
    for (batch_id, taken) in picks {
        let left = batches
            .iter()
            .find(|batch| batch.id == batch_id)
            .map_or(0, |batch| batch.quantity);
        dal::set_batch_quantity(tx.conn(), batch_id, left - taken).await?;
        let row = dal::insert_movement(
            tx.conn(),
            Uuid::now_v7(),
            item_id.uuid(),
            batch_id,
            kind.as_str(),
            -taken,
            reason,
        )
        .await?;
        movements.push(MovementView::from(row));
    }
    Ok(movements)
}

/// Uses stock: takes `quantity` units from the batches that expire first, skipping expired
/// ones.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Invalid`] for a bad quantity;
/// [`AppError::NotFound`] for an unknown item; [`AppError::Conflict`] when the usable stock is
/// less than asked for (nothing is taken).
pub async fn use_stock(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    item_id: InventoryItemId,
    quantity: i64,
    reason: Option<&str>,
    now: OffsetDateTime,
) -> Result<StockChange, AppError> {
    actor.require(Permission::InventoryManage)?;
    check_quantity(quantity).map_err(stock("quantity"))?;
    let reason = trimmed(reason, "reason", 300)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        dal::item(tx.conn(), item_id.uuid())
            .await?
            .ok_or(AppError::NotFound("item"))?;
        let movements = take(
            tx,
            item_id,
            quantity,
            MovementKind::Use,
            reason.as_deref(),
            today,
        )
        .await?;
        Ok(StockChange {
            stock: stock_item_in(tx, item_id, today).await?,
            movements,
        })
    })
    .await
}

/// A count correction as received.
#[derive(Debug, Clone)]
pub struct AdjustInput {
    /// The item.
    pub item_id: InventoryItemId,
    /// Signed units: negative takes off the shelf, positive adds found stock.
    pub quantity: i64,
    /// Why; required.
    pub reason: String,
    /// Expiry of found stock, if known.
    pub expiry: Option<Date>,
}

/// Corrects stock after a count. A negative `quantity` takes units off the shelf, earliest
/// expiry first and expired batches included; a positive one adds found stock as a new batch
/// (with `expiry`, if known) at the latest unit cost.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Invalid`] for a zero or
/// oversized quantity or a missing reason; [`AppError::NotFound`] for an unknown item;
/// [`AppError::Conflict`] when removing more than is on the shelf.
pub async fn adjust(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: AdjustInput,
    now: OffsetDateTime,
) -> Result<StockChange, AppError> {
    actor.require(Permission::InventoryManage)?;
    let AdjustInput {
        item_id,
        quantity,
        reason,
        expiry,
    } = input;
    check_quantity(quantity.abs()).map_err(stock("quantity"))?;
    let reason = required(Some(&reason), "reason", 300)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        dal::item(tx.conn(), item_id.uuid())
            .await?
            .ok_or(AppError::NotFound("item"))?;
        let movements = if quantity < 0 {
            // A recount sees expired stock too, so it may take from expired batches.
            take(
                tx,
                item_id,
                -quantity,
                MovementKind::Adjust,
                Some(&reason),
                Date::MIN,
            )
            .await?
        } else {
            let cost = dal::latest_unit_cost(tx.conn(), item_id.uuid())
                .await?
                .unwrap_or(0);
            let batch = dal::insert_batch(
                tx.conn(),
                StockBatchId::new_v7().uuid(),
                &BatchValues {
                    item_id: item_id.uuid(),
                    supplier_id: None,
                    batch_no: None,
                    expiry,
                    quantity,
                    unit_cost_paise: cost,
                    received_on: today,
                },
            )
            .await?;
            let row = dal::insert_movement(
                tx.conn(),
                Uuid::now_v7(),
                item_id.uuid(),
                batch.id,
                MovementKind::Adjust.as_str(),
                quantity,
                Some(&reason),
            )
            .await?;
            vec![MovementView::from(row)]
        };
        Ok(StockChange {
            stock: stock_item_in(tx, item_id, today).await?,
            movements,
        })
    })
    .await
}

/// Writes off what is left of a batch that has expired.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::NotFound`] for an unknown
/// batch; [`AppError::Conflict`] when the batch has not expired or is empty.
pub async fn expire_batch(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    batch_id: StockBatchId,
    reason: Option<&str>,
    now: OffsetDateTime,
) -> Result<StockChange, AppError> {
    actor.require(Permission::InventoryManage)?;
    let reason = trimmed(reason, "reason", 300)?.unwrap_or_else(|| "expired".to_owned());
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        let batch = dal::lock_batch(tx.conn(), batch_id.uuid())
            .await?
            .ok_or(AppError::NotFound("batch"))?;
        if batch.quantity == 0 {
            return Err(AppError::Conflict("the batch is already empty"));
        }
        if !is_expired(batch.expiry, today) {
            return Err(AppError::Conflict("the batch has not expired"));
        }
        dal::set_batch_quantity(tx.conn(), batch.id, 0).await?;
        let row = dal::insert_movement(
            tx.conn(),
            Uuid::now_v7(),
            batch.item_id,
            batch.id,
            MovementKind::Expire.as_str(),
            -batch.quantity,
            Some(&reason),
        )
        .await?;
        let item_id = InventoryItemId::from_uuid(batch.item_id);
        Ok(StockChange {
            stock: stock_item_in(tx, item_id, today).await?,
            movements: vec![MovementView::from(row)],
        })
    })
    .await
}

// ------------------------------------------------------------------ reports

/// Counts for the summary cards.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StockCounts {
    /// Items out or nearly out.
    pub critical: usize,
    /// Items at or below the reorder level.
    pub low: usize,
    /// Items with a batch expiring soon.
    pub expiring: usize,
    /// Items in good supply.
    pub ok: usize,
}

/// Every item with its level and status, critical first, then low, expiring and ok; each group
/// by name.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::Db`] on failures.
pub async fn stock_levels(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Vec<StockItem>, AppError> {
    actor.require(Permission::InventoryRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        stock_levels_in(tx, today).await
    })
    .await
}

fn rank(status: StockStatus) -> u8 {
    match status {
        StockStatus::Critical => 0,
        StockStatus::Low => 1,
        StockStatus::Expiring => 2,
        StockStatus::Ok => 3,
    }
}

/// [`stock_levels`] inside an open clinic transaction.
///
/// # Errors
/// [`AppError::Db`] on failures.
pub async fn stock_levels_in(tx: &mut ScopedTx, today: Date) -> Result<Vec<StockItem>, AppError> {
    let mut items: Vec<StockItem> = dal::stock(tx.conn())
        .await?
        .into_iter()
        .map(|row| StockItem::new(row, today))
        .collect();
    // Stable: the query's name order holds within each status.
    items.sort_by_key(|item| rank(item.status));
    Ok(items)
}

/// The counts for the summary cards.
#[must_use]
pub fn counts(items: &[StockItem]) -> StockCounts {
    let mut counts = StockCounts::default();
    for item in items.iter().filter(|item| item.item.active) {
        match item.status {
            StockStatus::Critical => counts.critical += 1,
            StockStatus::Low => counts.low += 1,
            StockStatus::Expiring => counts.expiring += 1,
            StockStatus::Ok => counts.ok += 1,
        }
    }
    counts
}

/// Active items that are low or critical, worst first.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::Db`] on failures.
pub async fn low_stock(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Vec<StockItem>, AppError> {
    actor.require(Permission::InventoryRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        low_stock_in(tx, today).await
    })
    .await
}

/// [`low_stock`] inside an open clinic transaction.
///
/// # Errors
/// [`AppError::Db`] on failures.
pub async fn low_stock_in(tx: &mut ScopedTx, today: Date) -> Result<Vec<StockItem>, AppError> {
    let mut items = stock_levels_in(tx, today).await?;
    items.retain(|item| {
        item.item.active && matches!(item.status, StockStatus::Critical | StockStatus::Low)
    });
    items.sort_by_key(|item| {
        (
            rank(item.status),
            item.on_hand * 100 / item.item.reorder_level.max(1),
        )
    });
    Ok(items)
}

/// A batch about to expire, or already expired, with stock left.
#[derive(Debug, Clone)]
pub struct ExpiringView {
    /// The batch.
    pub batch_id: StockBatchId,
    /// The item.
    pub item_id: InventoryItemId,
    /// The item's name.
    pub item_name: String,
    /// The item's unit.
    pub unit: StockUnit,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used.
    pub expiry: Date,
    /// Units left.
    pub quantity: i64,
    /// Days until expiry; negative once expired.
    pub days_left: i64,
}

/// Batches with stock left that expire within `days` days (default 30) or already have,
/// earliest first.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::Invalid`] for `days` outside 0 to
/// 3650; [`AppError::Db`] on failures.
pub async fn expiring(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    days: Option<i64>,
    now: OffsetDateTime,
) -> Result<Vec<ExpiringView>, AppError> {
    actor.require(Permission::InventoryRead)?;
    let days = days.unwrap_or(EXPIRY_WINDOW_DAYS);
    if !(0..=3650).contains(&days) {
        return Err(AppError::invalid("days", "must be between 0 and 3650"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = today_of(tx, now).await?;
        let rows = dal::expiring(tx.conn(), today + Duration::days(days)).await?;
        Ok(rows
            .into_iter()
            .map(|row| ExpiringView {
                batch_id: StockBatchId::from_uuid(row.batch_id),
                item_id: InventoryItemId::from_uuid(row.item_id),
                item_name: row.item_name,
                unit: StockUnit::parse(&row.unit).unwrap_or_default(),
                batch_no: row.batch_no,
                days_left: (row.expiry - today).whole_days(),
                expiry: row.expiry,
                quantity: row.quantity,
            })
            .collect())
    })
    .await
}
