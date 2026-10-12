//! The stock-alert step: low or projected run-out notices for staff who can see stock.
//!
//! Once an hour, from 08:00 clinic-local time, it reads one snapshot of every item's shelf and
//! use (`app.stock_usage_snapshot`, which leaves out clinics that switched `low_stock` off and
//! items with alerts off), works out the projection with [`project`] and writes the alert through
//! `app.record_stock_alert` (one per item per local day, so overlapping runs and repeat runs add
//! nothing). An item that has recovered has its open alerts handled. The notice holds ids and
//! numbers only; who sees it is decided when the feed is read (everyone with `inventory.read`).

use aarogyam_dal::stock_insights as dal;
use aarogyam_domain::inventory::{ProjectionInput, project};
use sakalya_db::{Db, DbError};
use time::macros::time;
use time::{OffsetDateTime, Time};

/// The clinic-local time from which stock alerts are sent.
const FROM: Time = time!(08:00);

/// Most items one run looks at.
const LIMIT: i32 = 5000;

/// What one run of the stock step did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StockReport {
    /// Items looked at.
    pub checked: usize,
    /// Alerts written (items already alerted today are not counted).
    pub alerted: usize,
    /// Items that recovered and had open alerts handled.
    pub cleared: usize,
}

/// Looks at every item of clinics past 08:00 local time and writes or clears alerts.
///
/// # Errors
/// [`DbError`] when the database fails; alerts already written stay written.
pub async fn run_stock_alerts(db: &Db, now: OffsetDateTime) -> Result<StockReport, DbError> {
    let rows = dal::snapshot(db.pool(), now, FROM, LIMIT).await?;
    let mut report = StockReport {
        checked: rows.len(),
        ..StockReport::default()
    };
    for row in rows {
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
            today: row.local_today,
            reorder_level: row.reorder_level,
            lead_time_days: i64::from(row.lead_time_days),
            batches: &batches,
            daily_use: &daily_use,
            first_use_on: row.first_use_on,
        });
        if let (true, Some(reason)) = (projection.should_alert, projection.reason) {
            let made = dal::record_alert(
                db.pool(),
                row.org_id,
                row.item_id,
                row.local_today,
                projection.on_hand,
                projection.days_cover,
                reason.as_str(),
            )
            .await?;
            report.alerted += usize::from(made);
        } else {
            let cleared = dal::clear_alerts(db.pool(), row.org_id, row.item_id).await?;
            report.cleared += usize::from(cleared > 0);
        }
    }
    Ok(report)
}
