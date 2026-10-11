//! The staff-operations step of the reminder job: runs the task steps and the stock alerts.

use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

use crate::tasks::{TaskReport, run_tasks};

/// What one run of the staff-operations step did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StaffOpsReport {
    /// The task steps.
    pub tasks: TaskReport,
}

impl StaffOpsReport {
    /// Whether anything happened, so the job logs only runs that did something.
    #[must_use]
    pub fn any(&self) -> bool {
        let t = self.tasks;
        t.due + t.reminded + t.escalated + t.missed + t.seeded > 0
    }
}

/// Runs the staff-operations step across clinics: standard tasks, each day's occurrences,
/// reminders and escalation. The stock alerts join here.
///
/// # Errors
/// [`DbError`] when the database fails; steps already taken stay taken.
pub async fn run_staff_ops(db: &Db, now: OffsetDateTime) -> Result<StaffOpsReport, DbError> {
    let tasks = run_tasks(db, now).await?;
    // The stock-alert step is added here by the stock task.
    Ok(StaffOpsReport { tasks })
}
