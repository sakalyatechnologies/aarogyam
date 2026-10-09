//! Support grants: a clinic owner grants one named Sakalya staff member read access for up to
//! seven days, lists and revokes grants; staff use them on the clinic's host and list theirs in
//! the console (`docs/decisions.md`, "Support grants").

use aarogyam_dal::support::{self as access_dal, Action, StaffGrantRow};
use aarogyam_dal::support_grants::{self as dal, ActionRow, GrantRow};
use aarogyam_domain::access::{ClinicActor, SupportAuthorization};
use aarogyam_domain::ids::{ClinicId, SupportGrantId, UserId};
use aarogyam_domain::patient::Email;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::support::{self, GrantStatus};
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// A grant as the clinic sees it.
#[derive(Debug, Clone)]
pub struct GrantView {
    /// The stored grant.
    pub row: GrantRow,
    /// Where it stands now.
    pub status: GrantStatus,
}

/// What the owner says about a new grant.
#[derive(Debug, Clone)]
pub struct NewGrant {
    /// The staff member's sign-in email.
    pub staff_email: Email,
    /// Why they need access.
    pub reason: String,
    /// When access ends: 15 minutes to 7 days from now.
    pub ends_at: OffsetDateTime,
}

fn views(rows: Vec<GrantRow>, now: OffsetDateTime) -> Vec<GrantView> {
    rows.into_iter()
        .map(|row| GrantView {
            status: GrantStatus::at(row.ends_at, row.revoked_at, now),
            row,
        })
        .collect()
}

/// Grants the staff member read access from now until `ends_at`. Needs `support.grant`.
///
/// # Errors
/// [`AppError::Invalid`] for a bad reason or end, or an email that isn't active Sakalya support
/// staff; [`AppError::Conflict`] when they already hold an active grant here.
pub async fn grant(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: &NewGrant,
    now: OffsetDateTime,
) -> Result<GrantView, AppError> {
    actor.require(Permission::SupportGrant)?;
    let reason = support::reason(&input.reason).map_err(|e| AppError::invalid("reason", e))?;
    support::check_end(now, input.ends_at).map_err(|e| AppError::invalid("ends_at", e))?;
    let id = SupportGrantId::new_v7().uuid();
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            let (staff, _) = dal::staff_by_email(tx.conn(), input.staff_email.as_str())
                .await?
                .ok_or_else(|| AppError::invalid("staff_email", "is not Sakalya support staff"))?;
            if dal::has_active(tx.conn(), staff).await? {
                return Err(AppError::Conflict(
                    "this person already has access; revoke it first",
                ));
            }
            let by = actor.membership_id.uuid();
            dal::create(tx.conn(), id, staff, &reason, input.ends_at, by).await?;
            Ok(dal::list(tx.conn(), Some(id)).await?)
        })
        .await?;
    views(rows, now)
        .pop()
        .ok_or(AppError::Internal("a new grant can't be read back"))
}

/// The clinic's grants, newest first. Needs `support.grant`.
///
/// # Errors
/// [`AppError::Db`] on a database failure.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    now: OffsetDateTime,
) -> Result<Vec<GrantView>, AppError> {
    actor.require(Permission::SupportGrant)?;
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(dal::list(tx.conn(), None).await?)
        })
        .await?;
    Ok(views(rows, now))
}

/// Ends a grant now. Needs `support.grant`.
///
/// # Errors
/// [`AppError::NotFound`] when the grant isn't in this clinic; [`AppError::Conflict`] when it
/// already ended or was revoked.
pub async fn revoke(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: SupportGrantId,
    now: OffsetDateTime,
) -> Result<GrantView, AppError> {
    actor.require(Permission::SupportGrant)?;
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            let open = dal::revoke(tx.conn(), id.uuid(), actor.membership_id.uuid())
                .await?
                .ok_or(AppError::NotFound("support grant"))?;
            if !open {
                return Err(AppError::Conflict("this access has already ended"));
            }
            Ok(dal::list(tx.conn(), Some(id.uuid())).await?)
        })
        .await?;
    views(rows, now)
        .pop()
        .ok_or(AppError::Internal("a revoked grant can't be read back"))
}

/// What staff did under a grant, newest first. Needs `support.grant`.
///
/// # Errors
/// [`AppError::NotFound`] when the grant isn't in this clinic.
pub async fn actions(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: SupportGrantId,
) -> Result<Vec<ActionRow>, AppError> {
    actor.require(Permission::SupportGrant)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::actions(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("support grant"))
    })
    .await
}

/// The grants a staff member holds at every clinic, for the console.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn staff_grants(db: &Db, staff: UserId) -> Result<Vec<StaffGrantRow>, DbError> {
    access_dal::staff_grants(db.pool(), staff.uuid()).await
}

/// Support access for a token's subject at a clinic, recording the session and the action.
/// `None` when they aren't staff with an active grant here.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn authorize(
    db: &Db,
    clinic: ClinicId,
    auth_uid: Uuid,
    session: (Uuid, OffsetDateTime),
    action: Action<'_>,
) -> Result<Option<SupportAuthorization>, DbError> {
    let row = access_dal::authorize(db.pool(), clinic.uuid(), auth_uid, session, action).await?;
    Ok(row.map(|row| SupportAuthorization {
        user_id: UserId::from_uuid(row.user_id),
        grant_id: SupportGrantId::from_uuid(row.grant_id),
        session_revoked: row.session_revoked,
    }))
}
