//! A staff member deleting their own account, and the job that finishes it.
//!
//! [`delete_own`] runs the database's part in one transaction (`app.delete_own_account`): the
//! person leaves every clinic, is signed out everywhere, loses their devices and push tokens and
//! their name, email and phone. Clinic records stay: notes and appointments name the doctor
//! through the clinic's own practitioner row. Deleting the sign-in identity in Supabase Auth is
//! a call to another system, so it is queued in the same transaction and done by
//! [`drain_deletions`], which the outbox job runs: a Supabase outage then can't leave a person
//! half-deleted or unable to delete, and the identity is only deleted once the person is gone
//! from the database. Logs carry ids, never names or addresses.

use aarogyam_dal::accounts::{self as dal, Deleted};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AttachmentId, ClinicId};
use aarogyam_domain::outbox::{MAX_ATTEMPTS, retry_at};
use sakalya_db::{Db, DbError};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::accounts::{AuthUid, SignInAccounts};
use crate::error::AppError;
use crate::files::{Files, StorageKey};

/// The word the person types to confirm.
const CONFIRM: &str = "delete";
/// Most identities one run deletes.
const BATCH: i32 = 20;
/// How long to wait between tries once the outbox backoff has run out: the job never gives up.
const SLOW_RETRY: Duration = Duration::hours(1);
/// Why a finished row kept the identity.
const KEPT_FOR_PATIENT_APP: &str = "kept_for_patient_app";
/// How long a claimed identity is held before another run may retry it, in seconds.
const LEASE_SECONDS: i32 = 300;

/// Deletes the signed-in person's own account. Asking again after it worked changes nothing.
/// `current_session` is the caller's token session, signed out too even if it never made a
/// clinic request. Returns the provider ids of the sessions signed out, so the caller can drop
/// what it cached for them. Photos the person had at clinics are removed from `files` (when
/// storage is configured) once the database has committed; a failed removal only leaves an
/// orphan file, as when an avatar is cleared.
///
/// # Errors
/// [`AppError::Invalid`] unless `confirm` is `delete`; [`AppError::NoStaffAccount`] when the
/// sign-in has no staff account; [`AppError::PlatformStaff`] for active Sakalya staff;
/// [`AppError::LastOwner`] with the clinics the person alone owns; [`AppError::Db`] on database
/// failures. Nothing changes on any error.
pub async fn delete_own(
    db: &Db,
    files: Option<&Files>,
    auth_uid: Uuid,
    current_session: Option<Uuid>,
    confirm: Option<&str>,
) -> Result<Vec<Uuid>, AppError> {
    if confirm != Some(CONFIRM) {
        return Err(AppError::invalid(
            "confirm",
            format!("must be \"{CONFIRM}\""),
        ));
    }
    match dal::delete_own(db.pool(), auth_uid, current_session).await? {
        Deleted::Unknown => Err(AppError::NoStaffAccount),
        Deleted::Nothing => Ok(Vec::new()),
        Deleted::PlatformStaff => Err(AppError::PlatformStaff),
        Deleted::LastOwner(clinics) => Err(AppError::LastOwner { clinics }),
        Deleted::Done { sessions, avatars } => {
            if let Some(files) = files {
                for (clinic, file) in avatars {
                    let key =
                        StorageKey::new(ClinicId::from_uuid(clinic), AttachmentId::from_uuid(file));
                    let _ = files.storage().delete(key).await;
                }
            }
            Ok(sessions)
        }
    }
}

/// What one run of [`drain_deletions`] did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DeletionReport {
    /// Identities claimed.
    pub claimed: usize,
    /// Deleted in Supabase Auth (already gone counts).
    pub deleted: usize,
    /// Left in place on purpose: the person also uses the patient app on this identity.
    pub kept: usize,
    /// Failed, to be tried again later.
    pub retrying: usize,
}

/// Deletes the Supabase identities of accounts deleted with [`delete_own`]: claims the due ones,
/// calls `accounts`, and marks each done, or retried with the outbox backoff ([`retry_at`]) and
/// then every hour: an outage or a bad key delays a deletion and never drops it. An identity the
/// person also uses in the patient app is kept, and the row finishes with a note.
///
/// # Errors
/// [`DbError`] when the queue can't be read or written; identities already handled stay handled.
pub async fn drain_deletions(
    db: &Db,
    accounts: &dyn SignInAccounts,
    now: OffsetDateTime,
) -> Result<DeletionReport, DbError> {
    let pool = db.pool();
    let claimed = dal::claim(pool, BATCH, LEASE_SECONDS).await?;
    let mut report = DeletionReport {
        claimed: claimed.len(),
        ..DeletionReport::default()
    };
    for row in claimed {
        if row.keep_identity {
            dal::mark_done(pool, row.id, Some(KEPT_FOR_PATIENT_APP)).await?;
            report.kept += 1;
            tracing::info!(
                event = Event::AccountIdentityDeleted.as_str(),
                deletion_id = %row.id,
                note = KEPT_FOR_PATIENT_APP,
                "account identity kept for the patient app"
            );
            continue;
        }
        match accounts.delete_user(AuthUid::from_uuid(row.auth_uid)).await {
            Ok(()) => {
                dal::mark_done(pool, row.id, None).await?;
                report.deleted += 1;
                tracing::info!(
                    event = Event::AccountIdentityDeleted.as_str(),
                    deletion_id = %row.id,
                    "account identity deleted"
                );
            }
            Err(error) => {
                let attempts = u32::try_from(row.attempts).unwrap_or(u32::MAX);
                let retry = retry_at(attempts, now).unwrap_or(now + SLOW_RETRY);
                dal::mark_failed(pool, row.id, &error.to_string(), retry).await?;
                report.retrying += 1;
                if attempts >= MAX_ATTEMPTS {
                    tracing::error!(
                        event = Event::AccountIdentityFailed.as_str(),
                        deletion_id = %row.id,
                        attempts,
                        reason = %error,
                        "account identity still not deleted; trying again in an hour"
                    );
                } else {
                    tracing::warn!(
                        event = Event::AccountIdentityRetried.as_str(),
                        deletion_id = %row.id,
                        attempts,
                        reason = %error,
                        "account identity not deleted; will retry"
                    );
                }
            }
        }
    }
    Ok(report)
}
