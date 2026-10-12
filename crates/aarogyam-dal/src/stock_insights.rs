//! Stock usage and run-out queries behind the analytics and the stock alerts. The analytics read
//! through an open clinic transaction (row-level security limits them to that clinic); the alert
//! job reads and writes across clinics through the definer functions of migrations 0671 and 0672.

use sakalya_db::DbError;
use sqlx::{PgConnection, PgPool};
use time::{Date, OffsetDateTime, Time};
use uuid::Uuid;

/// Days of daily use the snapshot and the analytics look back over.
pub const SERIES_DAYS: i32 = 28;

/// One item as the projection needs it: the shelf, the daily use and the settings.
#[derive(Debug, Clone)]
pub struct UsageRow {
    /// The item.
    pub item_id: Uuid,
    /// Name.
    pub name: String,
    /// Unit.
    pub unit: String,
    /// At or below this the item is low.
    pub reorder_level: i64,
    /// Days from ordering to delivery.
    pub lead_time_days: i16,
    /// Whether the item raises stock alerts.
    pub alerts_enabled: bool,
    /// Batches with stock left and not expired today: expiry (none: never), parallel to
    /// `batch_quantities`.
    pub batch_expiries: Vec<Option<Date>>,
    /// Units in each of those batches.
    pub batch_quantities: Vec<i64>,
    /// Clinic-local days with use in the last 28 days, parallel to `use_quantities`.
    pub use_days: Vec<Date>,
    /// Units used on each of those days (movements of kind `use` only).
    pub use_quantities: Vec<i64>,
    /// The first of those days.
    pub first_use_on: Option<Date>,
}

/// The active items (or the one named, active or not) with their shelf and the last 28 clinic
/// days of use, by name. `today` is the clinic's local day and `utc_offset_seconds` its offset from UTC (the clinic's
/// days are cut there; the helper functions of schema `app` are not open to a clinic session).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn usage(
    conn: &mut PgConnection,
    item_id: Option<Uuid>,
    utc_offset_seconds: i32,
    today: Date,
    now: OffsetDateTime,
) -> Result<Vec<UsageRow>, DbError> {
    let rows = sqlx::query_as!(
        UsageRow,
        r#"select i.id as item_id, i.name, i.unit, i.reorder_level, i.lead_time_days, i.alerts_enabled,
                  coalesce(b.expiries, '{}') as "batch_expiries!: Vec<Option<Date>>",
                  coalesce(b.quantities, '{}') as "batch_quantities!: Vec<i64>",
                  coalesce(u.days, '{}') as "use_days!: Vec<Date>",
                  coalesce(u.quantities, '{}') as "use_quantities!: Vec<i64>",
                  u.first_use_on
           from aarogyam.inventory_items i
           left join lateral (
             select array_agg(sb.expiry order by sb.expiry nulls last, sb.id) as expiries,
                    array_agg(sb.quantity order by sb.expiry nulls last, sb.id) as quantities
             from aarogyam.stock_batches sb
             where sb.org_id = i.org_id and sb.item_id = i.id and sb.quantity > 0
               and (sb.expiry is null or sb.expiry >= $3)
           ) b on true
           left join lateral (
             select array_agg(x.day order by x.day) as days,
                    array_agg(x.used order by x.day) as quantities,
                    min(x.day) as first_use_on
             from (select (m.created_at at time zone 'UTC' + $2::int * interval '1 second')::date as day, (-sum(m.quantity))::bigint as used
                   from aarogyam.stock_movements m
                   where m.org_id = i.org_id and m.item_id = i.id and m.kind = 'use'
                     and m.created_at >= $4::timestamptz - interval '30 days'
                   group by 1) x
             where x.day > $3 - 28 and x.day <= $3
           ) u on true
           where i.deleted_at is null and (($1::uuid is null and i.active) or i.id = $1)
           order by lower(i.name), i.id"#,
        item_id,
        utc_offset_seconds,
        today,
        now
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// What the alert step reads for one item: [`UsageRow`] without names, plus its clinic.
#[derive(Debug, Clone)]
pub struct SnapshotRow {
    /// The clinic.
    pub org_id: Uuid,
    /// The item.
    pub item_id: Uuid,
    /// The clinic's local day.
    pub local_today: Date,
    /// At or below this the item is low.
    pub reorder_level: i64,
    /// Days from ordering to delivery.
    pub lead_time_days: i16,
    /// Batches not expired today: expiry (none: never).
    pub batch_expiries: Vec<Option<Date>>,
    /// Units in each of those batches.
    pub batch_quantities: Vec<i64>,
    /// Local days with use in the last 28.
    pub use_days: Vec<Date>,
    /// Units used on each.
    pub use_quantities: Vec<i64>,
    /// The first of those days.
    pub first_use_on: Option<Date>,
}

/// The items of clinics in use whose `low_stock` switch is on and whose local time has reached
/// `from`, with alerts on (`app.stock_usage_snapshot`, `app.orgs_past_local_time`), at most
/// `limit` of them.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn snapshot(
    pool: &PgPool,
    now: OffsetDateTime,
    from: Time,
    limit: i32,
) -> Result<Vec<SnapshotRow>, DbError> {
    let rows = sqlx::query_as!(
        SnapshotRow,
        r#"select s.org_id as "org_id!", s.item_id as "item_id!", s.local_today as "local_today!",
                  s.reorder_level as "reorder_level!", s.lead_time_days as "lead_time_days!",
                  s.batch_expiries as "batch_expiries!: Vec<Option<Date>>",
                  s.batch_quantities as "batch_quantities!: Vec<i64>",
                  s.use_days as "use_days!: Vec<Date>",
                  s.use_quantities as "use_quantities!: Vec<i64>",
                  s.first_use_on
           from app.stock_usage_snapshot($1, 5000) s
           where s.org_id in (select app.orgs_past_local_time($1, $2))
           order by s.org_id, s.item_id
           limit $3"#,
        now,
        from,
        i64::from(limit)
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Writes the alert for an item on a local day (`app.record_stock_alert`). True when it wrote
/// one, false when the item already had one that day.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_alert(
    pool: &PgPool,
    org_id: Uuid,
    item_id: Uuid,
    alert_on: Date,
    on_hand: i64,
    days_cover: Option<i64>,
    reason: &str,
) -> Result<bool, DbError> {
    let made = sqlx::query_scalar!(
        r#"select app.record_stock_alert($1, $2, $3, $4::bigint::numeric, $5::bigint::numeric, $6)
           as "made!""#,
        org_id,
        item_id,
        alert_on,
        on_hand,
        days_cover,
        reason
    )
    .fetch_one(pool)
    .await?;
    Ok(made)
}

/// Handles every open alert of an item that has recovered (`app.clear_stock_alerts`). Returns
/// how many it handled.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clear_alerts(pool: &PgPool, org_id: Uuid, item_id: Uuid) -> Result<i32, DbError> {
    let cleared = sqlx::query_scalar!(
        r#"select app.clear_stock_alerts($1, $2) as "cleared!""#,
        org_id,
        item_id
    )
    .fetch_one(pool)
    .await?;
    Ok(cleared)
}

/// An item's alert settings.
#[derive(Debug, Clone)]
pub struct AlertSettingsRow {
    /// The item.
    pub item_id: Uuid,
    /// Days from ordering to delivery.
    pub lead_time_days: i16,
    /// Whether the item raises stock alerts.
    pub alerts_enabled: bool,
}

/// Changes an item's lead time and/or alert switch; fields left `None` stay. `None` when the
/// item is not in the clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_alert_settings(
    conn: &mut PgConnection,
    item_id: Uuid,
    lead_time_days: Option<i16>,
    alerts_enabled: Option<bool>,
) -> Result<Option<AlertSettingsRow>, DbError> {
    let row = sqlx::query_as!(
        AlertSettingsRow,
        r#"update aarogyam.inventory_items
           set lead_time_days = coalesce($2, lead_time_days),
               alerts_enabled = coalesce($3, alerts_enabled)
           where id = $1 and deleted_at is null
           returning id as item_id, lead_time_days, alerts_enabled"#,
        item_id,
        lead_time_days,
        alerts_enabled
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}
