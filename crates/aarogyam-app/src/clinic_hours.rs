//! The clinic's opening hours: when each branch is open, by weekday, split shifts allowed.
//! Anyone who sees the calendar may read them; changing them needs `settings.manage`. The
//! Analytics page counts a chair's open minutes from them (docs/decisions.md, "Analytics: chair
//! utilization and material costs").

use aarogyam_dal::clinic_hours::{self as dal, OpeningRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::BranchId;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{Shift, WeeklyHours};
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::schedule::resolve_branch;
use crate::scope::staff_scope as scope;

/// Every branch's opening shifts, by branch, weekday and start.
///
/// # Errors
/// [`AppError::Denied`] without `appointments.read`; [`AppError::Db`] on failures.
pub async fn hours(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<OpeningRow>, AppError> {
    actor.require(Permission::AppointmentsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::list(tx.conn(), None).await?)
    })
    .await
}

/// Replaces one branch's opening hours (the default branch when `branch_id` is absent) and
/// returns them. An empty list clears them, and the Analytics page falls back to nine hours a
/// day.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for bad or overlapping
/// shifts or an unknown branch.
pub async fn set_hours(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    branch_id: Option<BranchId>,
    shifts: Vec<Shift>,
) -> Result<Vec<OpeningRow>, AppError> {
    actor.require(Permission::SettingsManage)?;
    let week = WeeklyHours::new(shifts).map_err(|error| AppError::invalid("shifts", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let branch = resolve_branch(tx, branch_id).await?;
        let rows: Vec<OpeningRow> = week
            .shifts()
            .iter()
            .map(|shift| OpeningRow {
                branch_id: branch,
                weekday: i16::from(shift.weekday),
                starts: shift.starts,
                ends: shift.ends,
            })
            .collect();
        dal::replace(tx.conn(), branch, &rows).await?;
        Ok(rows)
    })
    .await
}
