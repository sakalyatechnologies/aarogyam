//! A clinic's own medicine sets: several medicines added to a prescription in one tap, beside the
//! specialty's compiled-in ones. The doctor creates, edits and deletes them (`prescriptions.issue`);
//! anyone who may read quick picks sees them.

use aarogyam_dal::medicine_sets::{self as dal, SetRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::MedicineSetId;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::quick_picks::{SetMedicine, check_set};
use sakalya_db::{Db, DbErrorKind};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// A clinic's medicine set.
#[derive(Debug, Clone)]
pub struct SetView {
    /// Identifier.
    pub id: MedicineSetId,
    /// The chip's label.
    pub label: String,
    /// The medicines, in prescription order.
    pub items: Vec<SetMedicine>,
    /// When it was made.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

fn view(row: SetRow) -> Result<SetView, AppError> {
    Ok(SetView {
        id: MedicineSetId::from_uuid(row.id),
        label: row.label,
        items: serde_json::from_value(row.items)
            .map_err(|_| AppError::Internal("a stored medicine set is malformed"))?,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// A set as received.
#[derive(Debug, Clone)]
pub struct SetInput {
    /// The chip's label, 1 to 80 characters, unique in the clinic ignoring case.
    pub label: String,
    /// 1 to 20 medicines.
    pub items: Vec<SetMedicine>,
}

fn label_taken(error: sakalya_db::DbError) -> AppError {
    match error.kind() {
        DbErrorKind::Conflict => AppError::Conflict("a medicine set with that label exists"),
        _ => AppError::Db(error),
    }
}

/// The clinic's own sets, by label. Part of `GET /quick-picks` too.
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue` or `clinical.read`.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<SetView>, AppError> {
    if actor.require(Permission::ClinicalRead).is_err() {
        actor.require(Permission::PrescriptionsIssue)?;
    }
    list_any(db, actor, request_id).await
}

/// The clinic's own sets for a caller whose route already checked a permission.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn list_any(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<SetView>, AppError> {
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::list(tx.conn()).await?.into_iter().map(view).collect()
    })
    .await
}

/// Adds a set.
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue`; [`AppError::Invalid`] for a bad label or
/// medicine; [`AppError::Conflict`] when a set has the label.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: SetInput,
) -> Result<SetView, AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    let (label, items) = check_set(&input.label, &input.items).map_err(|e| AppError::Invalid {
        field: e.field,
        message: e.message,
    })?;
    let items = serde_json::to_value(&items)
        .map_err(|_| AppError::Internal("a medicine set did not serialise"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::insert(tx.conn(), MedicineSetId::new_v7().uuid(), &label, &items)
            .await
            .map_err(label_taken)?;
        view(row)
    })
    .await
}

/// Replaces a set's label and medicines.
///
/// # Errors
/// As [`create`], and [`AppError::NotFound`] for a set that isn't this clinic's or was deleted.
pub async fn update(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: MedicineSetId,
    input: SetInput,
) -> Result<SetView, AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    let (label, items) = check_set(&input.label, &input.items).map_err(|e| AppError::Invalid {
        field: e.field,
        message: e.message,
    })?;
    let items = serde_json::to_value(&items)
        .map_err(|_| AppError::Internal("a medicine set did not serialise"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::get_for_update(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("medicine set"))?;
        let row = dal::update(tx.conn(), id.uuid(), &label, &items)
            .await
            .map_err(label_taken)?;
        view(row)
    })
    .await
}

/// Deletes a set (it is hidden; the change history keeps it).
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue`; [`AppError::NotFound`] for a set that
/// isn't this clinic's or was deleted already.
pub async fn delete(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: MedicineSetId,
) -> Result<(), AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::get_for_update(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("medicine set"))?;
        dal::delete(tx.conn(), id.uuid()).await?;
        Ok(())
    })
    .await
}
