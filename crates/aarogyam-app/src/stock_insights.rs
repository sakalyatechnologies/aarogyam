//! Stock analytics: usage, days of cover and run-out dates, worked out by
//! `domain::inventory::project` (the same function the alert job uses). Reading needs
//! `inventory.read`; changing an item's alert settings needs `inventory.manage`.

use std::collections::HashMap;

use aarogyam_dal::stock_insights::{self as dal, SERIES_DAYS, UsageRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::InventoryItemId;
use aarogyam_domain::inventory::{AlertReason, ProjectionInput, project};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_offset, clinic_today};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// The longest lead time an item may have, in days.
pub const MAX_LEAD_TIME_DAYS: i16 = 120;

/// One item's usage and projection.
#[derive(Debug, Clone)]
pub struct ItemInsight {
    /// The item.
    pub item_id: InventoryItemId,
    /// Name.
    pub name: String,
    /// Unit.
    pub unit: String,
    /// Units on the shelf that have not expired today.
    pub on_hand: i64,
    /// Units used per day over the projection window; `None` without enough history.
    pub daily_usage: Option<f64>,
    /// Units used in the last 7 days, today included.
    pub usage_7d: i64,
    /// Units used in the last 28 days, today included.
    pub usage_28d: i64,
    /// Units used on each of the last 28 days, oldest first, today last.
    pub series: Vec<(Date, i64)>,
    /// Whole days the usable stock lasts; `None` without enough history.
    pub days_cover: Option<i64>,
    /// The day the stock runs out; `None` without enough history.
    pub runs_out_on: Option<Date>,
    /// At or below this the item is low.
    pub reorder_level: i64,
    /// Days from ordering to delivery.
    pub lead_time_days: i16,
    /// Whether the item raises stock alerts.
    pub alerts_enabled: bool,
    /// Units to order to cover the lead time plus two weeks; `None` without enough history.
    pub suggested_reorder_qty: Option<i64>,
    /// Whether the item needs reordering now (low, or running out within lead time plus a
    /// margin).
    pub needs_reorder: bool,
    /// Why, as `low` or `projected`.
    pub reason: Option<AlertReason>,
}

/// Items with their projection, and those that need reordering.
#[derive(Debug, Clone)]
pub struct Analytics {
    /// By name.
    pub items: Vec<ItemInsight>,
    /// The items to reorder, soonest to run out first.
    pub reorder_list: Vec<ItemInsight>,
}

/// Works out one item's insight from its rows.
#[must_use]
pub fn insight_of(row: UsageRow, today: Date) -> ItemInsight {
    let batches: Vec<_> = row
        .batch_expiries
        .iter()
        .copied()
        .zip(row.batch_quantities.iter().copied())
        .collect();
    let daily_use: Vec<_> = row
        .use_days
        .iter()
        .copied()
        .zip(row.use_quantities.iter().copied())
        .collect();
    let projection = project(&ProjectionInput {
        today,
        reorder_level: row.reorder_level,
        lead_time_days: i64::from(row.lead_time_days),
        max_level: row.max_level,
        batches: &batches,
        daily_use: &daily_use,
        first_use_on: row.first_use_on,
    });
    let used_on = |day: Date| {
        daily_use
            .iter()
            .filter(|(d, _)| *d == day)
            .map(|(_, q)| *q)
            .sum::<i64>()
    };
    let series: Vec<(Date, i64)> = (0..i64::from(SERIES_DAYS))
        .rev()
        .map(|back| {
            let day = today - Duration::days(back);
            (day, used_on(day))
        })
        .collect();
    let usage_28d = series.iter().map(|(_, q)| *q).sum();
    let usage_7d = series.iter().rev().take(7).map(|(_, q)| *q).sum();
    ItemInsight {
        item_id: InventoryItemId::from_uuid(row.item_id),
        name: row.name,
        unit: row.unit,
        on_hand: projection.on_hand,
        daily_usage: projection.daily_usage,
        usage_7d,
        usage_28d,
        series,
        days_cover: projection.days_cover,
        runs_out_on: projection.runs_out_on,
        reorder_level: row.reorder_level,
        lead_time_days: row.lead_time_days,
        alerts_enabled: row.alerts_enabled,
        suggested_reorder_qty: projection.suggested_reorder_qty,
        needs_reorder: projection.should_alert,
        reason: projection.reason,
    }
}

/// Usage and run-out for every active item, or for the one named, with the reorder list.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::NotFound`] for an item that is
/// not in the clinic; [`AppError::Db`] on database failures.
pub async fn analytics(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    item_id: Option<InventoryItemId>,
    now: OffsetDateTime,
) -> Result<Analytics, AppError> {
    actor.require(Permission::InventoryRead)?;
    let today = clinic_today(&actor.timezone, now);
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(
                dal::usage(
                    tx.conn(),
                    item_id.map(InventoryItemId::uuid),
                    clinic_offset(&actor.timezone).whole_seconds(),
                    today,
                    now,
                )
                .await?,
            )
        })
        .await?;
    if item_id.is_some() && rows.is_empty() {
        return Err(AppError::NotFound("item"));
    }
    let items: Vec<ItemInsight> = rows.into_iter().map(|row| insight_of(row, today)).collect();
    let mut reorder_list: Vec<ItemInsight> = items
        .iter()
        .filter(|item| item.needs_reorder)
        .cloned()
        .collect();
    reorder_list.sort_by_key(|item| (item.days_cover.unwrap_or(-1), item.name.to_lowercase()));
    Ok(Analytics {
        items,
        reorder_list,
    })
}

/// Days of cover and run-out date for each active item that has them, by item id (for the low
/// stock list).
///
/// # Errors
/// [`AppError::Denied`] without `inventory.read`; [`AppError::Db`] on database failures.
pub async fn cover_by_item(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<HashMap<Uuid, (i64, Date)>, AppError> {
    let all = analytics(db, actor, request_id, None, now).await?;
    Ok(all
        .items
        .into_iter()
        .filter_map(|item| Some((item.item_id.uuid(), (item.days_cover?, item.runs_out_on?))))
        .collect())
}

/// An item's alert settings.
#[derive(Debug, Clone, Copy)]
pub struct AlertSettings {
    /// The item.
    pub item_id: InventoryItemId,
    /// Days from ordering to delivery.
    pub lead_time_days: i16,
    /// Whether the item raises stock alerts.
    pub alerts_enabled: bool,
}

/// Changes an item's lead time and alert switch; fields left out stay.
///
/// # Errors
/// [`AppError::Denied`] without `inventory.manage`; [`AppError::Invalid`] for a lead time
/// outside 0 to 120; [`AppError::NotFound`] for an item that is not in the clinic.
pub async fn update_alert_settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    item_id: InventoryItemId,
    lead_time_days: Option<i16>,
    alerts_enabled: Option<bool>,
) -> Result<AlertSettings, AppError> {
    actor.require(Permission::InventoryManage)?;
    if let Some(days) = lead_time_days
        && !(0..=MAX_LEAD_TIME_DAYS).contains(&days)
    {
        return Err(AppError::invalid(
            "lead_time_days",
            format!("must be between 0 and {MAX_LEAD_TIME_DAYS}"),
        ));
    }
    let row = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(
                dal::update_alert_settings(
                    tx.conn(),
                    item_id.uuid(),
                    lead_time_days,
                    alerts_enabled,
                )
                .await?,
            )
        })
        .await?
        .ok_or(AppError::NotFound("item"))?;
    Ok(AlertSettings {
        item_id,
        lead_time_days: row.lead_time_days,
        alerts_enabled: row.alerts_enabled,
    })
}
