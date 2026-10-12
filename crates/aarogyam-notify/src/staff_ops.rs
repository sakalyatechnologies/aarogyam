//! The staff-operations step of the reminder job: runs the task steps and the stock alerts.

use std::sync::atomic::{AtomicI64, Ordering};

use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

use crate::stock::{StockReport, run_stock_alerts};
use crate::tasks::{TaskReport, run_tasks};

/// What one run of the staff-operations step did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StaffOpsReport {
    /// The task steps.
    pub tasks: TaskReport,
    /// The stock alerts (all zero in runs that skipped the step).
    pub stock: StockReport,
}

impl StaffOpsReport {
    /// Whether anything happened, so the job logs only runs that did something.
    #[must_use]
    pub fn any(&self) -> bool {
        let t = self.tasks;
        t.due
            + t.reminded
            + t.escalated
            + t.missed
            + t.seeded
            + self.stock.alerted
            + self.stock.cleared
            > 0
    }
}

/// Runs the staff-operations step across clinics: standard tasks, each day's occurrences,
/// reminders and escalation. The stock alerts join here.
///
/// # Errors
/// [`DbError`] when the database fails; steps already taken stay taken.
pub async fn run_staff_ops(db: &Db, now: OffsetDateTime) -> Result<StaffOpsReport, DbError> {
    let tasks = run_tasks(db, now).await?;
    let stock = if stock_step_due(now) {
        run_stock_alerts(db, now).await?
    } else {
        StockReport::default()
    };
    Ok(StaffOpsReport { tasks, stock })
}

/// Hour of the last stock step this process ran (hours since the epoch); the step runs again
/// when the hour changes, however often the job ticks. Another process may run it too: the
/// alerts are once per item per day whatever runs at once.
static LAST_STOCK_HOUR: AtomicI64 = AtomicI64::new(i64::MIN);

fn stock_step_due(now: OffsetDateTime) -> bool {
    let hour = now.unix_timestamp().div_euclid(3600);
    LAST_STOCK_HOUR.swap(hour, Ordering::Relaxed) != hour
}
