//! Use cases for the clinic's staff-operations settings: whether staff time off needs the
//! owner's approval, and how often an open task is reminded. Reading and changing need
//! `settings.manage`; code that acts for the clinic reads them with [`settings_in`].

use aarogyam_dal::staff_ops as dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::time_off::{StaffOpsChanges, StaffOpsSettings};
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;

/// The clinic's settings, with defaults for what was never set.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Db`] on database failures.
pub async fn settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<StaffOpsSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        settings_in(tx).await
    })
    .await
}

/// The settings inside an open clinic transaction, for the code a setting controls. No
/// permission check: callers are acting for the clinic already.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn settings_in(tx: &mut sakalya_db::ScopedTx) -> Result<StaffOpsSettings, AppError> {
    Ok(StaffOpsSettings::from_stored(&dal::get(tx.conn()).await?))
}

/// Changes the settings; what is left out stays, and keys other features keep in the same
/// object are untouched. The change history records each change.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] naming a bad value;
/// [`AppError::Db`] on database failures.
pub async fn update_settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    changes: StaffOpsChanges,
) -> Result<StaffOpsSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let mut stored = dal::for_update(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let mut settings = StaffOpsSettings::from_stored(&stored);
        settings
            .apply(&changes)
            .map_err(|error| AppError::invalid(error.field(), error))?;
        settings.merge_into(&mut stored);
        dal::save(tx.conn(), &stored).await?;
        Ok(settings)
    })
    .await
}
