//! The reminder job's task steps: due, reminder and escalation notices.
//!
//! The work is one definer function across clinics (`app.run_task_reminders`, migration 0663):
//! it marks overdue tasks missed, sends the reminders that fell due and escalates tasks that
//! have used up their reminders. Notices hold ids and numbers only, and delivery is in-app.

use aarogyam_dal::task_jobs as dal;
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

/// Most tasks one run looks at per step.
const BATCH: i32 = 500;

/// What one run of the task steps did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TaskReport {
    /// Occurrences made for tasks that fell due.
    pub due: usize,
    /// Reminders sent.
    pub reminded: usize,
    /// Tasks escalated to the owners.
    pub escalated: usize,
    /// Open tasks marked missed.
    pub missed: usize,
    /// Standard tasks added to clinics that lacked them.
    pub seeded: usize,
}

/// Adds missing standard tasks, makes the occurrences that fell due, then marks missed ones,
/// reminds and escalates. Each step runs once per task, also when runs overlap.
///
/// # Errors
/// [`DbError`] when the database fails; steps already taken stay taken.
pub async fn run_tasks(db: &Db, now: OffsetDateTime) -> Result<TaskReport, DbError> {
    let seeded = dal::seed_missing_defaults(db.pool(), 50).await?;
    let due = dal::materialize(db.pool(), now, BATCH).await?;
    let steps = dal::run_reminders(db.pool(), now, BATCH).await?;
    Ok(TaskReport {
        due: usize::try_from(due).unwrap_or_default(),
        reminded: usize::try_from(steps.reminded).unwrap_or_default(),
        escalated: usize::try_from(steps.escalated).unwrap_or_default(),
        missed: usize::try_from(steps.missed).unwrap_or_default(),
        seeded: usize::try_from(seeded).unwrap_or_default(),
    })
}
