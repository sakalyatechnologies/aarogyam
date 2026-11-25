//! The QR check-in sweep: arrival requests nobody acted on within 24 hours, and handled ones
//! (which hold only ids and a status) after 7 days, are deleted in every clinic. One definer
//! function does it (`app.sweep_self_check_ins`, migration 0759), so the job is one call.

use aarogyam_dal::self_check_ins as dal;
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

/// Deletes the arrival requests past their time; returns how many rows went.
///
/// # Errors
/// [`DbError`] when the database fails.
pub async fn sweep_self_check_ins(db: &Db, now: OffsetDateTime) -> Result<usize, DbError> {
    let deleted = dal::sweep(db.pool(), now).await?;
    Ok(usize::try_from(deleted).unwrap_or_default())
}
