//! Suppliers, stock items, batches and movements. Every function takes the connection of an
//! open clinic transaction, so row-level security limits it to that clinic. Quantities are
//! whole units; money is paise.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

// ------------------------------------------------------------------ suppliers

/// A supplier as stored.
#[derive(Debug, Clone)]
pub struct SupplierRow {
    /// Identifier.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Phone in E.164.
    pub phone_e164: Option<String>,
    /// GSTIN.
    pub gstin: Option<String>,
    /// Still bought from.
    pub active: bool,
}

/// A supplier's values.
#[derive(Debug, Clone)]
pub struct SupplierValues<'a> {
    /// Name.
    pub name: &'a str,
    /// Phone in E.164.
    pub phone_e164: Option<&'a str>,
    /// GSTIN.
    pub gstin: Option<&'a str>,
    /// Still bought from.
    pub active: bool,
}

/// The suppliers, by name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn suppliers(conn: &mut PgConnection) -> Result<Vec<SupplierRow>, DbError> {
    let rows = sqlx::query_as!(
        SupplierRow,
        r#"select id, name, phone_e164, gstin, active
           from aarogyam.suppliers where deleted_at is null order by lower(name), id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One supplier.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn supplier(conn: &mut PgConnection, id: Uuid) -> Result<Option<SupplierRow>, DbError> {
    let row = sqlx::query_as!(
        SupplierRow,
        r#"select id, name, phone_e164, gstin, active
           from aarogyam.suppliers where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Adds a supplier.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken name (a conflict).
pub async fn insert_supplier(
    conn: &mut PgConnection,
    id: Uuid,
    values: &SupplierValues<'_>,
) -> Result<SupplierRow, DbError> {
    let row = sqlx::query_as!(
        SupplierRow,
        r#"insert into aarogyam.suppliers (id, name, phone_e164, gstin, active)
           values ($1, $2, $3, $4, $5)
           returning id, name, phone_e164, gstin, active"#,
        id,
        values.name,
        values.phone_e164,
        values.gstin,
        values.active
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves a supplier's values.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken name (a conflict).
pub async fn update_supplier(
    conn: &mut PgConnection,
    id: Uuid,
    values: &SupplierValues<'_>,
) -> Result<Option<SupplierRow>, DbError> {
    let row = sqlx::query_as!(
        SupplierRow,
        r#"update aarogyam.suppliers
           set name = $2, phone_e164 = $3, gstin = $4, active = $5
           where id = $1 and deleted_at is null
           returning id, name, phone_e164, gstin, active"#,
        id,
        values.name,
        values.phone_e164,
        values.gstin,
        values.active
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Removes a supplier from the lists; batches received from it keep pointing at it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_supplier(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.suppliers set deleted_at = now() where id = $1 and deleted_at is null",
        id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

// ------------------------------------------------------------------ items

/// A stock item as stored.
#[derive(Debug, Clone)]
pub struct ItemRow {
    /// Identifier.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Category.
    pub category: Option<String>,
    /// Unit: piece, ml, g, box or pack.
    pub unit: String,
    /// At or below this the item is low.
    pub reorder_level: i64,
    /// Still stocked.
    pub active: bool,
}

/// A stock item's values.
#[derive(Debug, Clone)]
pub struct ItemValues<'a> {
    /// Name.
    pub name: &'a str,
    /// Category.
    pub category: Option<&'a str>,
    /// Unit.
    pub unit: &'a str,
    /// Reorder level.
    pub reorder_level: i64,
    /// Still stocked.
    pub active: bool,
}

/// One stock item.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn item(conn: &mut PgConnection, id: Uuid) -> Result<Option<ItemRow>, DbError> {
    let row = sqlx::query_as!(
        ItemRow,
        r#"select id, name, category, unit, reorder_level, active
           from aarogyam.inventory_items where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Adds a stock item.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken name (a conflict).
pub async fn insert_item(
    conn: &mut PgConnection,
    id: Uuid,
    values: &ItemValues<'_>,
) -> Result<ItemRow, DbError> {
    let row = sqlx::query_as!(
        ItemRow,
        r#"insert into aarogyam.inventory_items (id, name, category, unit, reorder_level, active)
           values ($1, $2, $3, $4, $5, $6)
           returning id, name, category, unit, reorder_level, active"#,
        id,
        values.name,
        values.category,
        values.unit,
        values.reorder_level,
        values.active
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves a stock item's values.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken name (a conflict).
pub async fn update_item(
    conn: &mut PgConnection,
    id: Uuid,
    values: &ItemValues<'_>,
) -> Result<Option<ItemRow>, DbError> {
    let row = sqlx::query_as!(
        ItemRow,
        r#"update aarogyam.inventory_items
           set name = $2, category = $3, unit = $4, reorder_level = $5, active = $6
           where id = $1 and deleted_at is null
           returning id, name, category, unit, reorder_level, active"#,
        id,
        values.name,
        values.category,
        values.unit,
        values.reorder_level,
        values.active
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Removes an item from the lists; its history stays.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_item(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.inventory_items set deleted_at = now() where id = $1 and deleted_at is null",
        id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() > 0)
}

/// An item with what is on its shelf.
#[derive(Debug, Clone)]
pub struct StockRow {
    /// Identifier.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Category.
    pub category: Option<String>,
    /// Unit.
    pub unit: String,
    /// Reorder level.
    pub reorder_level: i64,
    /// Still stocked.
    pub active: bool,
    /// Units on hand, all batches (expired ones included until written off).
    pub on_hand: i64,
    /// Earliest expiry among batches with stock left.
    pub next_expiry: Option<Date>,
}

/// Every item with its units on hand and earliest expiry, by name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn stock(conn: &mut PgConnection) -> Result<Vec<StockRow>, DbError> {
    let rows = sqlx::query_as!(
        StockRow,
        r#"select i.id, i.name, i.category, i.unit, i.reorder_level, i.active,
                  coalesce(sum(b.quantity), 0)::bigint as "on_hand!",
                  min(b.expiry) filter (where b.quantity > 0) as next_expiry
           from aarogyam.inventory_items i
           left join aarogyam.stock_batches b on b.org_id = i.org_id and b.item_id = i.id
           where i.deleted_at is null
           group by i.org_id, i.id
           order by lower(i.name), i.id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Units on hand of one item.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn on_hand(conn: &mut PgConnection, item_id: Uuid) -> Result<i64, DbError> {
    let total = sqlx::query_scalar!(
        r#"select coalesce(sum(quantity), 0)::bigint as "total!" from aarogyam.stock_batches where item_id = $1"#,
        item_id
    )
    .fetch_one(conn)
    .await?;
    Ok(total)
}

// ------------------------------------------------------------------ batches

/// A batch as stored.
#[derive(Debug, Clone)]
pub struct BatchRow {
    /// Identifier.
    pub id: Uuid,
    /// The item.
    pub item_id: Uuid,
    /// Where it came from.
    pub supplier_id: Option<Uuid>,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used.
    pub expiry: Option<Date>,
    /// Units that arrived.
    pub received_quantity: i64,
    /// Units left.
    pub quantity: i64,
    /// Cost of one unit in paise.
    pub unit_cost_paise: i64,
    /// Day it arrived.
    pub received_on: Date,
}

/// A new batch's values.
#[derive(Debug, Clone)]
pub struct BatchValues<'a> {
    /// The item.
    pub item_id: Uuid,
    /// Where it came from.
    pub supplier_id: Option<Uuid>,
    /// The supplier's batch number.
    pub batch_no: Option<&'a str>,
    /// Last day it may be used.
    pub expiry: Option<Date>,
    /// Units that arrived.
    pub quantity: i64,
    /// Cost of one unit in paise.
    pub unit_cost_paise: i64,
    /// Day it arrived.
    pub received_on: Date,
}

/// Adds a batch, all of it on the shelf.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_batch(
    conn: &mut PgConnection,
    id: Uuid,
    values: &BatchValues<'_>,
) -> Result<BatchRow, DbError> {
    let row = sqlx::query_as!(
        BatchRow,
        r#"insert into aarogyam.stock_batches
             (id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity,
              unit_cost_paise, received_on)
           values ($1, $2, $3, $4, $5, $6, $6, $7, $8)
           returning id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity,
                     unit_cost_paise, received_on"#,
        id,
        values.item_id,
        values.supplier_id,
        values.batch_no,
        values.expiry,
        values.quantity,
        values.unit_cost_paise,
        values.received_on
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The batches of an item that still have stock, locked so concurrent uses queue up.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_batches(
    conn: &mut PgConnection,
    item_id: Uuid,
) -> Result<Vec<BatchRow>, DbError> {
    let rows = sqlx::query_as!(
        BatchRow,
        r#"select id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity,
                  unit_cost_paise, received_on
           from aarogyam.stock_batches
           where item_id = $1 and quantity > 0
           order by expiry nulls last, received_on, id
           for update"#,
        item_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One batch, locked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_batch(conn: &mut PgConnection, id: Uuid) -> Result<Option<BatchRow>, DbError> {
    let row = sqlx::query_as!(
        BatchRow,
        r#"select id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity,
                  unit_cost_paise, received_on
           from aarogyam.stock_batches where id = $1 for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The cost of one unit in the item's latest delivery, if it has had one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn latest_unit_cost(
    conn: &mut PgConnection,
    item_id: Uuid,
) -> Result<Option<i64>, DbError> {
    let cost = sqlx::query_scalar!(
        "select unit_cost_paise from aarogyam.stock_batches
         where item_id = $1 order by received_on desc, id desc limit 1",
        item_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(cost)
}

/// Sets what is left on a batch. The database refuses a negative quantity.
///
/// # Errors
/// [`DbError`] on a database failure, including a negative quantity (a check violation).
pub async fn set_batch_quantity(
    conn: &mut PgConnection,
    id: Uuid,
    quantity: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.stock_batches set quantity = $2 where id = $1",
        id,
        quantity
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A batch with stock left, with its item.
#[derive(Debug, Clone)]
pub struct ExpiringRow {
    /// The batch.
    pub batch_id: Uuid,
    /// The item.
    pub item_id: Uuid,
    /// The item's name.
    pub item_name: String,
    /// The item's unit.
    pub unit: String,
    /// The supplier's batch number.
    pub batch_no: Option<String>,
    /// Last day it may be used.
    pub expiry: Date,
    /// Units left.
    pub quantity: i64,
}

/// Batches with stock left that expire on or before `until` (already expired ones too),
/// earliest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn expiring(conn: &mut PgConnection, until: Date) -> Result<Vec<ExpiringRow>, DbError> {
    let rows = sqlx::query_as!(
        ExpiringRow,
        r#"select b.id as batch_id, i.id as item_id, i.name as item_name, i.unit, b.batch_no,
                  b.expiry as "expiry!", b.quantity
           from aarogyam.stock_batches b
           join aarogyam.inventory_items i on i.org_id = b.org_id and i.id = b.item_id
           where b.quantity > 0 and b.expiry is not null and b.expiry <= $1 and i.deleted_at is null
           order by b.expiry, lower(i.name), b.id"#,
        until
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The batches of an item, newest delivery first, with those emptied last.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn batches(conn: &mut PgConnection, item_id: Uuid) -> Result<Vec<BatchRow>, DbError> {
    let rows = sqlx::query_as!(
        BatchRow,
        r#"select id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity,
                  unit_cost_paise, received_on
           from aarogyam.stock_batches where item_id = $1
           order by (quantity = 0), expiry nulls last, received_on desc, id"#,
        item_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

// ------------------------------------------------------------------ movements

/// A movement as stored.
#[derive(Debug, Clone)]
pub struct MovementRow {
    /// Identifier.
    pub id: Uuid,
    /// The item.
    pub item_id: Uuid,
    /// The batch touched.
    pub batch_id: Uuid,
    /// `receive`, `use`, `adjust` or `expire`.
    pub kind: String,
    /// Signed units.
    pub quantity: i64,
    /// Why, for adjustments and write-offs.
    pub reason: Option<String>,
    /// When.
    pub at: OffsetDateTime,
    /// Who.
    pub by_user_id: Option<Uuid>,
}

/// Records a movement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_movement(
    conn: &mut PgConnection,
    id: Uuid,
    item_id: Uuid,
    batch_id: Uuid,
    kind: &str,
    quantity: i64,
    reason: Option<&str>,
) -> Result<MovementRow, DbError> {
    let row = sqlx::query_as!(
        MovementRow,
        r#"insert into aarogyam.stock_movements (id, item_id, batch_id, kind, quantity, reason)
           values ($1, $2, $3, $4, $5, $6)
           returning id, item_id, batch_id, kind, quantity, reason, created_at as "at!", created_by as by_user_id"#,
        id,
        item_id,
        batch_id,
        kind,
        quantity,
        reason
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The latest movements of an item, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn movements(
    conn: &mut PgConnection,
    item_id: Uuid,
    limit: i64,
) -> Result<Vec<MovementRow>, DbError> {
    let rows = sqlx::query_as!(
        MovementRow,
        r#"select id, item_id, batch_id, kind, quantity, reason, created_at as "at!", created_by as by_user_id
           from aarogyam.stock_movements where item_id = $1
           order by created_at desc, id desc limit $2"#,
        item_id,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
