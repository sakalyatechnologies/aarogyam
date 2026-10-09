//! A clinic's own dental terms: list them, rename them, retire and restore them
//! (`docs/decisions.md`, "Retiring and renaming dental terms"). Chart entries name terms by id
//! and are never rewritten.

use aarogyam_dal::dental_terms::{self as dal, OwnTermRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::dental_terms::{TermKind, seeded_match, term_label};
use aarogyam_domain::ids::DentalTermId;
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, DbErrorKind};
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// The clinic's own terms, retired ones included, by list and label. Needs `clinical.read` or
/// `settings.manage`.
///
/// # Errors
/// [`AppError::Denied`] without either permission.
pub async fn own(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<OwnTermRow>, AppError> {
    if actor.require(Permission::ClinicalRead).is_err() {
        actor.require(Permission::SettingsManage)?;
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok::<_, AppError>(dal::own(tx.conn(), None).await?)
    })
    .await
}

async fn one(tx: &mut sakalya_db::ScopedTx, id: DentalTermId) -> Result<OwnTermRow, AppError> {
    dal::own(tx.conn(), Some(id.uuid()))
        .await?
        .pop()
        .ok_or(AppError::NotFound("dental term"))
}

/// Gives a term a new label. Old chart entries show the new label; the change history keeps the
/// old one. Needs `settings.manage`.
///
/// # Errors
/// [`AppError::NotFound`] when the term isn't in this clinic; [`AppError::Invalid`] for a bad
/// label; [`AppError::Conflict`] when the list already has the label, seeded or the clinic's.
pub async fn rename(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: DentalTermId,
    label: &str,
) -> Result<OwnTermRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    let label = term_label(label).map_err(|error| AppError::invalid("label", error))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let term = one(tx, id).await?;
        let kind = TermKind::parse(&term.kind)
            .map_err(|_| AppError::Internal("a stored dental term is malformed"))?;
        if seeded_match(kind, &label).is_some_and(|t| !t.retired) {
            return Err(AppError::Conflict(
                "that is a standard term; retire this one and use the standard term",
            ));
        }
        dal::rename(tx.conn(), id.uuid(), &label)
            .await
            .map_err(|error| match error.kind() {
                DbErrorKind::Conflict => AppError::Conflict("the list already has that label"),
                _ => AppError::Db(error),
            })?;
        one(tx, id).await
    })
    .await
}

/// Retires a term (`retire`), so it is no longer offered for new entries while old entries
/// still show it, or brings it back. Needs `settings.manage`.
///
/// # Errors
/// [`AppError::NotFound`] when the term isn't in this clinic.
pub async fn set_retired(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: DentalTermId,
    retire: bool,
) -> Result<OwnTermRow, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let by = retire.then(|| actor.membership_id.uuid());
        if !dal::set_retired(tx.conn(), id.uuid(), by).await? {
            return Err(AppError::NotFound("dental term"));
        }
        one(tx, id).await
    })
    .await
}
