//! The clinic's own privacy notice, with versions: listing them, publishing a new one, and
//! choosing which notice a consent records (docs/decisions.md, "Notice and consent records").

use aarogyam_dal::notices::{self as dal, NoticeRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::consent::{self, DEFAULT_NOTICE_VERSION};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, DbErrorKind, ScopedTx};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Every version, newest first; the first is the current notice. Needs `patients.read` (the
/// desk shows it before taking consent).
///
/// # Errors
/// [`AppError::Denied`] without `patients.read`.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<NoticeRow>, AppError> {
    actor.require(Permission::PatientsRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::list(tx.conn()).await?)
    })
    .await
}

/// Publishes a new version of the notice; it becomes the current notice. Needs
/// `settings.manage`. Versions are never edited.
///
/// # Errors
/// [`AppError::Invalid`] for a bad label or text; [`AppError::Conflict`] when another version
/// was published at the same moment.
pub async fn publish(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    label: &str,
    body: &str,
) -> Result<NoticeRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    let label = consent::version(label).map_err(|error| AppError::invalid("label", error))?;
    let body = consent::notice_text(body).map_err(|error| AppError::invalid("body", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let id = dal::publish(tx.conn(), label, body, actor.membership_id.uuid())
            .await
            .map_err(|error| match error.kind() {
                DbErrorKind::Conflict => {
                    AppError::Conflict("another version was just published; reload and try again")
                }
                _ => AppError::from(error),
            })?;
        dal::list(tx.conn())
            .await?
            .into_iter()
            .find(|row| row.id == id)
            .ok_or(AppError::Internal("notice missing after publishing"))
    })
    .await
}

/// The notice a consent records, inside an open transaction: the named notice (which must be
/// this clinic's), else a label the caller gives (consents recorded before clinics published
/// notices), else the clinic's current notice, else the template's label. Returns the label
/// and the notice id, if any.
///
/// # Errors
/// [`AppError::Invalid`] for an unknown notice or a bad label.
pub(crate) async fn resolve(
    tx: &mut ScopedTx,
    notice_id: Option<Uuid>,
    label: Option<&str>,
) -> Result<(String, Option<Uuid>), AppError> {
    if let Some(id) = notice_id {
        let label = dal::label(tx.conn(), id)
            .await?
            .ok_or(AppError::invalid("notice_id", "no such notice"))?;
        return Ok((label, Some(id)));
    }
    if let Some(label) = label {
        let label =
            consent::version(label).map_err(|error| AppError::invalid("notice_version", error))?;
        return Ok((label.to_owned(), None));
    }
    Ok(match dal::current(tx.conn()).await? {
        Some((id, label)) => (label, Some(id)),
        None => (DEFAULT_NOTICE_VERSION.to_owned(), None),
    })
}
