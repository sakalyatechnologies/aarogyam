//! Possible duplicate patients from online booking, and merging a self-registered record into
//! the existing patient it duplicates. Matching by phone never merges by itself: the booking
//! goes to a new self-registered record and the front desk decides (docs/decisions.md,
//! "Online sign-ups: duplicates by phone and completion at arrival").

use aarogyam_dal::duplicates::{self as dal, DuplicateRow};
use aarogyam_dal::merge;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::PhoneE164;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::patients::age_on;
use crate::scope::staff_scope as scope;

/// Flags a just-registered online patient against existing patients with the same phone,
/// inside the booking's transaction.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub(crate) async fn flag_by_phone(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    phone: &PhoneE164,
) -> Result<(), AppError> {
    dal::flag_by_phone(tx.conn(), patient_id, phone.as_e164()).await?;
    Ok(())
}

/// An open flag with both patients' ages today.
#[derive(Debug, Clone)]
pub struct DuplicateView {
    /// The flag and both records.
    pub row: DuplicateRow,
    /// The self-registered record's age in whole years.
    pub patient_age_years: Option<u16>,
    /// The existing patient's age in whole years.
    pub candidate_age_years: Option<u16>,
}

/// Open possible duplicates whose records are both within the member's `patients.read` reach.
///
/// # Errors
/// [`AppError::Denied`] without `patients.read`.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Vec<DuplicateView>, AppError> {
    actor.require(Permission::PatientsRead)?;
    let member = actor.reach(Permission::PatientsRead).member();
    let today = clinic_today(&actor.timezone, now);
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(dal::list_open(tx.conn(), member).await?)
        })
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| DuplicateView {
            patient_age_years: age_on(row.patient_date_of_birth, false, today),
            candidate_age_years: age_on(row.candidate_date_of_birth, false, today),
            row,
        })
        .collect())
}

/// Dismisses a flag: the two records are different people.
///
/// # Errors
/// [`AppError::Denied`] without `patients.write`; [`AppError::NotFound`] when there is no
/// such open flag in reach.
pub async fn dismiss(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    let member = actor.reach(Permission::PatientsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::dismiss(tx.conn(), id, actor.membership_id.uuid(), member).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("duplicate"))
        }
    })
    .await
}

/// Merges the self-registered record `source` into the existing patient `target`: its
/// appointments, queue tokens, app links, identifiers and consents move, and it is marked
/// merged. Every change is in the change history. Returns how many appointments moved.
///
/// # Errors
/// [`AppError::Denied`] without `patients.write`; [`AppError::NotFound`] when either isn't in
/// this clinic or in reach; [`AppError::Invalid`] when `source` is the target or not
/// self-registered; [`AppError::Conflict`] when either is merged already or `source` has any
/// clinical or billing record.
pub async fn merge(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    source: PatientId,
    target: PatientId,
) -> Result<i64, AppError> {
    actor.require(Permission::PatientsWrite)?;
    if source == target {
        return Err(AppError::invalid(
            "into_patient_id",
            "must be another patient",
        ));
    }
    let member = actor.reach(Permission::PatientsWrite).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        // Lock in id order so two merges of the same pair can't deadlock.
        let (first, second) = if source.uuid() < target.uuid() {
            (source, target)
        } else {
            (target, source)
        };
        let a = merge::lock_side(tx.conn(), first.uuid(), member).await?;
        let b = merge::lock_side(tx.conn(), second.uuid(), member).await?;
        let (Some(a), Some(b)) = (a, b) else {
            return Err(AppError::NotFound("patient"));
        };
        let (from, into) = if a.id == source.uuid() { (a, b) } else { (b, a) };
        if from.status == "merged" || into.status == "merged" {
            return Err(AppError::Conflict("that record was already merged"));
        }
        if !from.self_registered {
            return Err(AppError::invalid(
                "patient",
                "only a self-registered record can be merged into another",
            ));
        }
        if from.has_clinical {
            return Err(AppError::Conflict(
                "the self-registered record already has clinical or billing records; it can't be merged",
            ));
        }
        Ok(merge::merge_into(tx.conn(), from.id, into.id, actor.membership_id.uuid()).await?)
    })
    .await
}
