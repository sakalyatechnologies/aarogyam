//! Purchase orders, their lines and what has been received against them. Every function takes
//! the connection of an open clinic transaction, so row-level security limits it to that
//! clinic.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// An order as stored, with its supplier's name and the sums over its lines.
#[derive(Debug, Clone)]
pub struct OrderRow {
    /// Identifier.
    pub id: Uuid,
    /// `PO-12`.
    pub number: String,
    /// The supplier.
    pub supplier_id: Uuid,
    /// The supplier's name.
    pub supplier_name: String,
    /// `draft`, `ordered`, `received` or `cancelled`.
    pub status: String,
    /// When the goods are expected.
    pub expected_on: Option<Date>,
    /// Notes.
    pub notes: Option<String>,
    /// When it was sent to the supplier.
    pub ordered_at: Option<OffsetDateTime>,
    /// When everything had come in.
    pub received_at: Option<OffsetDateTime>,
    /// When it was cancelled.
    pub cancelled_at: Option<OffsetDateTime>,
    /// When it was made.
    pub created_at: OffsetDateTime,
    /// Ordered quantity times cost, over the lines, in paise; lines without a cost count zero.
    pub total_paise: i64,
}

/// Which orders to read.
#[derive(Debug, Clone, Copy, Default)]
pub struct OrderFilter<'a> {
    /// One order.
    pub id: Option<Uuid>,
    /// Only this status.
    pub status: Option<&'a str>,
    /// Only this supplier.
    pub supplier_id: Option<Uuid>,
    /// Most rows.
    pub limit: i64,
}

/// Orders not deleted, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn orders(
    conn: &mut PgConnection,
    filter: &OrderFilter<'_>,
) -> Result<Vec<OrderRow>, DbError> {
    let rows = sqlx::query_as!(
        OrderRow,
        r#"select o.id, o.number, o.supplier_id, s.name as supplier_name, o.status, o.expected_on,
                  o.notes, o.ordered_at, o.received_at, o.cancelled_at, o.created_at,
                  coalesce((select sum(l.quantity * coalesce(l.unit_cost_paise, 0))
                            from aarogyam.purchase_order_lines l
                            where l.org_id = o.org_id and l.order_id = o.id), 0)::bigint as "total_paise!"
           from aarogyam.purchase_orders o
           join aarogyam.suppliers s on s.org_id = o.org_id and s.id = o.supplier_id
           where o.deleted_at is null
             and ($1::uuid is null or o.id = $1)
             and ($2::text is null or o.status = $2)
             and ($3::uuid is null or o.supplier_id = $3)
           order by o.created_at desc, o.id desc
           limit $4"#,
        filter.id,
        filter.status,
        filter.supplier_id,
        filter.limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Locks an order that is not deleted for the rest of the transaction; its status.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_order(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!(
        "select status from aarogyam.purchase_orders where id = $1 and deleted_at is null for update",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(status)
}

/// A new order.
#[derive(Debug, Clone)]
pub struct NewOrder<'a> {
    /// Identifier.
    pub id: Uuid,
    /// `PO-12`.
    pub number: &'a str,
    /// The supplier.
    pub supplier_id: Uuid,
    /// `draft` or `ordered`.
    pub status: &'a str,
    /// When the goods are expected.
    pub expected_on: Option<Date>,
    /// Notes.
    pub notes: Option<&'a str>,
    /// Set when the order starts as `ordered`.
    pub ordered_at: Option<OffsetDateTime>,
}

/// Adds an order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_order(conn: &mut PgConnection, new: &NewOrder<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.purchase_orders
             (id, number, supplier_id, status, expected_on, notes, ordered_at)
           values ($1, $2, $3, $4, $5, $6, $7)"#,
        new.id,
        new.number,
        new.supplier_id,
        new.status,
        new.expected_on,
        new.notes,
        new.ordered_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// What a change to an order sets.
#[derive(Debug, Clone)]
pub struct OrderValues<'a> {
    /// The supplier.
    pub supplier_id: Uuid,
    /// When the goods are expected.
    pub expected_on: Option<Date>,
    /// Notes.
    pub notes: Option<&'a str>,
}

/// Saves an order's supplier, expected date and notes.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_order(
    conn: &mut PgConnection,
    id: Uuid,
    values: &OrderValues<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.purchase_orders
           set supplier_id = $2, expected_on = $3, notes = $4
           where id = $1 and deleted_at is null"#,
        id,
        values.supplier_id,
        values.expected_on,
        values.notes
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Moves an order to `ordered`, `received` or `cancelled`, stamping the time.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_status(
    conn: &mut PgConnection,
    id: Uuid,
    status: &str,
    at: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.purchase_orders
           set status = $2,
               ordered_at = case when $2 = 'ordered' then $3 else ordered_at end,
               received_at = case when $2 = 'received' then $3 else received_at end,
               cancelled_at = case when $2 = 'cancelled' then $3 else cancelled_at end
           where id = $1 and deleted_at is null"#,
        id,
        status,
        at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Removes an order from the lists.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_order(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.purchase_orders set deleted_at = now() where id = $1 and deleted_at is null",
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A line as stored, with its item.
#[derive(Debug, Clone)]
pub struct LineRow {
    /// Identifier.
    pub id: Uuid,
    /// The order.
    pub order_id: Uuid,
    /// Position, from 1.
    pub line_no: i16,
    /// The item.
    pub item_id: Uuid,
    /// The item's name.
    pub item_name: String,
    /// The item's unit.
    pub unit: String,
    /// Units ordered.
    pub quantity: i64,
    /// Cost of one unit in paise.
    pub unit_cost_paise: Option<i64>,
    /// Units received so far.
    pub received_quantity: i64,
}

/// The lines of the given orders, in order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lines(conn: &mut PgConnection, order_ids: &[Uuid]) -> Result<Vec<LineRow>, DbError> {
    let rows = sqlx::query_as!(
        LineRow,
        r#"select l.id, l.order_id, l.line_no, l.item_id, i.name as item_name, i.unit, l.quantity,
                  l.unit_cost_paise, l.received_quantity
           from aarogyam.purchase_order_lines l
           join aarogyam.inventory_items i on i.org_id = l.org_id and i.id = l.item_id
           where l.order_id = any($1)
           order by l.order_id, l.line_no"#,
        order_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A line to add.
#[derive(Debug, Clone, Copy)]
pub struct NewLine {
    /// Identifier.
    pub id: Uuid,
    /// The item.
    pub item_id: Uuid,
    /// Units.
    pub quantity: i64,
    /// Cost of one unit in paise.
    pub unit_cost_paise: Option<i64>,
}

/// Adds lines to an order, numbered from 1 in the order given.
///
/// # Errors
/// [`DbError`] on a database failure, including an item twice (a conflict).
pub async fn insert_lines(
    conn: &mut PgConnection,
    order_id: Uuid,
    lines: &[NewLine],
) -> Result<(), DbError> {
    for (index, line) in lines.iter().enumerate() {
        let line_no = i16::try_from(index + 1).unwrap_or(i16::MAX);
        sqlx::query!(
            r#"insert into aarogyam.purchase_order_lines
                 (id, order_id, line_no, item_id, quantity, unit_cost_paise)
               values ($1, $2, $3, $4, $5, $6)"#,
            line.id,
            order_id,
            line_no,
            line.item_id,
            line.quantity,
            line.unit_cost_paise
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Removes every line of an order (a draft; the database refuses lines with receipts).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_lines(conn: &mut PgConnection, order_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "delete from aarogyam.purchase_order_lines where order_id = $1",
        order_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Locks an order's lines, in order, for a receipt.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_lines(conn: &mut PgConnection, order_id: Uuid) -> Result<Vec<LineRow>, DbError> {
    let rows = sqlx::query_as!(
        LineRow,
        r#"select l.id, l.order_id, l.line_no, l.item_id, i.name as item_name, i.unit, l.quantity,
                  l.unit_cost_paise, l.received_quantity
           from aarogyam.purchase_order_lines l
           join aarogyam.inventory_items i on i.org_id = l.org_id and i.id = l.item_id
           where l.order_id = $1
           order by l.line_no
           for update of l"#,
        order_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Adds to what has been received on a line. The database refuses going past the ordered
/// quantity.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn add_received(
    conn: &mut PgConnection,
    line_id: Uuid,
    quantity: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.purchase_order_lines set received_quantity = received_quantity + $2 where id = $1",
        line_id,
        quantity
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Records which batch a line's delivery made.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_receipt(
    conn: &mut PgConnection,
    order_id: Uuid,
    line_id: Uuid,
    batch_id: Uuid,
    quantity: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.purchase_order_receipts (order_id, line_id, batch_id, quantity)
           values ($1, $2, $3, $4)"#,
        order_id,
        line_id,
        batch_id,
        quantity
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Stock that came in against an order's lines.
#[derive(Debug, Clone)]
pub struct ReceiptRow {
    /// The order.
    pub order_id: Uuid,
    /// The line.
    pub line_id: Uuid,
    /// The stock batch it made.
    pub batch_id: Uuid,
    /// Units.
    pub quantity: i64,
    /// When.
    pub at: OffsetDateTime,
}

/// The receipts of the given orders, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn receipts(
    conn: &mut PgConnection,
    order_ids: &[Uuid],
) -> Result<Vec<ReceiptRow>, DbError> {
    let rows = sqlx::query_as!(
        ReceiptRow,
        r#"select order_id, line_id, batch_id, quantity, created_at as "at!"
           from aarogyam.purchase_order_receipts
           where order_id = any($1)
           order by created_at, id"#,
        order_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
