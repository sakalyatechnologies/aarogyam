//! Changes to a lab order after it is recorded: its items, and the log of contacting the lab.
//! Each records a `lab_order_events` row in the same statement. Callers lock the order first
//! (`lab_orders::lock`), which also checks reach.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::Date;
use uuid::Uuid;

/// The order an item is on, when that order is within reach (`member` `None` for all).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn item_order(
    conn: &mut PgConnection,
    item_id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<Uuid>, DbError> {
    let row = sqlx::query_scalar!(
        r#"select o.id from aarogyam.lab_order_items i
           join aarogyam.lab_orders o on o.org_id = i.org_id and o.id = i.lab_order_id
           where i.id = $1 and app.clinical_in_reach(o.doctor_id, o.created_by, o.encounter_id, $2)"#,
        item_id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The line numbers in use on an order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lines(conn: &mut PgConnection, order_id: Uuid) -> Result<Vec<i16>, DbError> {
    let rows = sqlx::query_scalar!(
        "select line_no from aarogyam.lab_order_items where lab_order_id = $1 order by line_no",
        order_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// An item's values, checked.
#[derive(Debug, Clone)]
pub struct ItemValues<'a> {
    /// What to make.
    pub work_type: &'a str,
    /// FDI tooth numbers, sorted.
    pub teeth: &'a [i16],
    /// Shade.
    pub shade: Option<&'a str>,
    /// Material.
    pub material: Option<&'a str>,
    /// How many.
    pub qty: i32,
    /// What the lab charges for one.
    pub unit_cost_paise: Option<i64>,
}

/// Adds an item at `line_no` and records `item_added`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn add_item(
    conn: &mut PgConnection,
    order_id: Uuid,
    line_no: i16,
    item: &ItemValues<'_>,
    actor: Uuid,
) -> Result<Uuid, DbError> {
    let id = sqlx::query_scalar!(
        r#"with i as (
             insert into aarogyam.lab_order_items
               (lab_order_id, line_no, work_type, teeth, shade, material, qty, unit_cost_paise)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             returning id
           ), e as (
             insert into aarogyam.lab_order_events (lab_order_id, kind, line_no, actor_id)
             select $1, 'item_added', $2, $9 from i
           )
           select id as "id!" from i"#,
        order_id,
        line_no,
        item.work_type,
        item.teeth,
        item.shade,
        item.material,
        item.qty,
        item.unit_cost_paise,
        actor
    )
    .fetch_one(conn)
    .await?;
    Ok(id)
}

/// An item as stored, for a change.
#[derive(Debug, Clone)]
pub struct StoredItem {
    /// Position.
    pub line_no: i16,
    /// What to make.
    pub work_type: String,
    /// FDI teeth.
    pub teeth: Vec<i16>,
    /// Shade.
    pub shade: Option<String>,
    /// Material.
    pub material: Option<String>,
    /// How many.
    pub qty: i32,
    /// What the lab charges for one.
    pub unit_cost_paise: Option<i64>,
}

/// One item of a (locked) order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn item(conn: &mut PgConnection, item_id: Uuid) -> Result<Option<StoredItem>, DbError> {
    let row = sqlx::query_as!(
        StoredItem,
        "select line_no, work_type, teeth, shade, material, qty, unit_cost_paise
         from aarogyam.lab_order_items where id = $1",
        item_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Replaces an item's values and records `item_changed`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_item(
    conn: &mut PgConnection,
    order_id: Uuid,
    item_id: Uuid,
    item: &ItemValues<'_>,
    actor: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"with i as (
             update aarogyam.lab_order_items
             set work_type = $3, teeth = $4, shade = $5, material = $6, qty = $7,
                 unit_cost_paise = $8
             where id = $2 and lab_order_id = $1
             returning line_no
           )
           insert into aarogyam.lab_order_events (lab_order_id, kind, line_no, actor_id)
           select $1, 'item_changed', line_no, $9 from i"#,
        order_id,
        item_id,
        item.work_type,
        item.teeth,
        item.shade,
        item.material,
        item.qty,
        item.unit_cost_paise,
        actor
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Removes an item and records `item_removed`. Other items keep their line numbers.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn remove_item(
    conn: &mut PgConnection,
    order_id: Uuid,
    item_id: Uuid,
    actor: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"with i as (
             delete from aarogyam.lab_order_items where id = $2 and lab_order_id = $1
             returning line_no
           )
           insert into aarogyam.lab_order_events (lab_order_id, kind, line_no, actor_id)
           select $1, 'item_removed', line_no, $3 from i"#,
        order_id,
        item_id,
        actor
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A contact with the lab, checked.
#[derive(Debug, Clone, Copy)]
pub struct ContactLog<'a> {
    /// call, whatsapp, email or visit.
    pub channel: &'a str,
    /// Who at the lab: a live contact of the order's lab.
    pub contact_id: Option<Uuid>,
    /// reached, `no_answer`, `promised_date` or other.
    pub outcome: Option<&'a str>,
    /// Free text, up to 500 characters.
    pub note: Option<&'a str>,
    /// The date the lab promised; becomes the order's due date.
    pub promised_on: Option<Date>,
    /// The member.
    pub actor: Uuid,
}

/// Records a `contacted` event on a locked order, marks the lab contacted now by the member,
/// and moves the due date to `promised_on` when given (the trigger then clears the reminder
/// steps), in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn log_contact(
    conn: &mut PgConnection,
    order_id: Uuid,
    log: &ContactLog<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"with o as (
             update aarogyam.lab_orders
             set last_contacted_at = now(), last_contacted_by = $7,
                 due_on = coalesce($6, due_on)
             where id = $1
             returning id
           )
           insert into aarogyam.lab_order_events
             (lab_order_id, kind, channel, contact_id, outcome, note, due_on, actor_id)
           select id, 'contacted', $2, $3, $4, $5, $6, $7 from o"#,
        order_id,
        log.channel,
        log.contact_id,
        log.outcome,
        log.note,
        log.promised_on,
        log.actor
    )
    .execute(conn)
    .await?;
    Ok(())
}
