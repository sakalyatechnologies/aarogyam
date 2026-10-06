//! Staff: listing members and roles, inviting people, and changing a member's role or status.
//! Every function needs `staff.manage` and runs in one clinic transaction.

use aarogyam_dal::{clinic, staff as dal};
use aarogyam_domain::access::{ClinicActor, MembershipStatus};
use aarogyam_domain::ids::{InvitationId, MembershipId};
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::patient::Email;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::staff::{MemberState, StaffRefusal, check_change, check_invite};
use sakalya_db::Db;
use serde_json::json;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_offset;
use crate::error::AppError;
use crate::outbox::{StaffEmail, enqueue_staff_email};
use crate::scope::staff_scope;

/// How long a staff invitation stays valid.
pub const INVITE_VALID_FOR: Duration = Duration::days(7);

pub use aarogyam_dal::staff::{InvitationRow, MemberRow, RoleRow};

/// The clinic's staff.
#[derive(Debug, Clone)]
pub struct StaffList {
    /// Members, active first, then by name.
    pub members: Vec<MemberRow>,
    /// Invitations neither accepted nor expired.
    pub invitations: Vec<InvitationRow>,
}

impl From<StaffRefusal> for AppError {
    fn from(refusal: StaffRefusal) -> Self {
        match refusal {
            StaffRefusal::OwnersOnly => Self::Forbidden(refusal.message()),
            StaffRefusal::Status => Self::invalid("status", refusal),
            StaffRefusal::OwnRole | StaffRefusal::LastOwner => Self::Conflict(refusal.message()),
        }
    }
}

/// The clinic's members and pending invitations.
///
/// # Errors
/// [`AppError::Denied`] without `staff.manage`; [`AppError::Db`] on database failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<StaffList, AppError> {
    actor.require(Permission::StaffManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let (members, invitations) = dal::members_and_invitations(tx.conn()).await?;
        Ok(StaffList {
            members,
            invitations,
        })
    })
    .await
}

/// The clinic's roles and their permissions.
///
/// # Errors
/// [`AppError::Denied`] without `staff.manage`; [`AppError::Db`] on database failures.
pub async fn roles(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<RoleRow>, AppError> {
    actor.require(Permission::StaffManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(dal::roles(tx.conn()).await?)
    })
    .await
}

/// Someone to invite, as received.
#[derive(Debug, Clone)]
pub struct InviteStaff {
    /// Their email; they sign in with it to accept.
    pub email: String,
    /// The role they will get.
    pub role_key: String,
}

/// An invitation just created. The token is shown once and emailed; only its hash is stored.
#[derive(Debug, Clone)]
pub struct Invited {
    /// The invitation.
    pub id: InvitationId,
    /// Who was invited.
    pub email: String,
    /// The role they will get.
    pub role_key: String,
    /// When it expires.
    pub expires_at: OffsetDateTime,
    /// The secret for the invitation link.
    pub token: String,
    /// The clinic's portal host, where the link points.
    pub portal_host: String,
}

/// Invites someone to the clinic's staff and queues the invitation email in the same
/// transaction.
///
/// # Errors
/// [`AppError::Denied`] without `staff.manage`; [`AppError::Invalid`] for a bad email or an
/// unknown role; [`AppError::Forbidden`] when a non-owner invites an owner; [`AppError::Db`]
/// on database failures.
pub async fn invite(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: InviteStaff,
    now: OffsetDateTime,
) -> Result<Invited, AppError> {
    actor.require(Permission::StaffManage)?;
    let email = Email::parse(&input.email).map_err(|error| AppError::invalid("email", error))?;
    let role_key = input.role_key.trim().to_owned();
    check_invite(&actor.role_key, &role_key)?;
    invite_in_scope(
        db,
        &staff_scope(actor, request_id),
        actor.user_id.uuid(),
        email,
        role_key,
        now,
    )
    .await
}

/// Creates an invitation and queues its email in one transaction in `scope`'s clinic. The
/// caller has checked who may invite whom.
pub(crate) async fn invite_in_scope(
    db: &Db,
    scope: &sakalya_db::Scope,
    invited_by: Uuid,
    email: Email,
    role_key: String,
    now: OffsetDateTime,
) -> Result<Invited, AppError> {
    let (token, token_hash) = crate::tokens::new_token()?;
    let expires_at = now + INVITE_VALID_FOR;
    let id = InvitationId::new_v7();
    let portal_host = db.scoped(scope, async |tx| {
        let (role_id, role_name) = dal::role_by_key(tx.conn(), &role_key)
            .await?
            .ok_or_else(|| AppError::invalid("role_key", "is not a role in this clinic"))?;
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let host = dal::portal_host(tx.conn())
            .await?
            .ok_or(AppError::Conflict("the clinic has no portal address yet"))?;
        dal::insert_invitation(
            tx.conn(),
            &dal::NewInvitation {
                id: id.uuid(),
                email: email.as_str(),
                role_id,
                invited_by,
                token_hash: &token_hash,
                expires_at,
            },
        )
        .await?;
        let expires_on = expires_at.to_offset(clinic_offset(&profile.timezone)).date();
        enqueue_staff_email(
            tx,
            &StaffEmail {
                kind: MessageKind::StaffInvited,
                to: &email,
                payload: json!({
                    "invitation_id": id.uuid(),
                    "clinic_name": profile.name,
                    "role_name": role_name,
                    "portal_host": host,
                    "expires_on": format!("{} {} {}", expires_on.day(), expires_on.month(), expires_on.year()),
                }),
                secret: Some(&token),
            },
        )
        .await?;
        Ok::<_, AppError>(host)
    })
    .await?;
    Ok(Invited {
        id,
        email: email.as_str().to_owned(),
        role_key,
        expires_at,
        token,
        portal_host,
    })
}

/// A change to a member, as received. `None` leaves it as it is.
#[derive(Debug, Clone, Default)]
pub struct ChangeMember {
    /// The new role key.
    pub role_key: Option<String>,
    /// `active`, `suspended` or `left`.
    pub status: Option<String>,
}

/// Changes a member's role or status. Nobody changes their own role, only owners make or change
/// owners, and the last active owner can't be removed or demoted.
///
/// # Errors
/// [`AppError::Denied`] without `staff.manage`; [`AppError::NotFound`] when the membership isn't
/// in this clinic; [`AppError::Invalid`] for an unknown role or status; [`AppError::Conflict`]
/// for the own-role and last-owner guards; [`AppError::Forbidden`] for the owners-only rule.
pub async fn change(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    membership_id: MembershipId,
    input: ChangeMember,
) -> Result<MemberRow, AppError> {
    actor.require(Permission::StaffManage)?;
    let new_status = input
        .status
        .as_deref()
        .map(|text| {
            MembershipStatus::parse(text.trim())
                .ok_or_else(|| AppError::invalid("status", StaffRefusal::Status))
        })
        .transpose()?;
    let new_role = input.role_key.as_deref().map(str::trim);
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let owners = dal::lock_active_owners(tx.conn()).await?;
        let target = dal::lock_membership(tx.conn(), membership_id.uuid())
            .await?
            .ok_or(AppError::NotFound("member"))?;
        let status = MembershipStatus::parse(&target.status)
            .ok_or(AppError::Internal("unknown membership status"))?;
        check_change(
            &MemberState {
                id: actor.membership_id,
                role_key: &actor.role_key,
                status: MembershipStatus::Active,
            },
            &MemberState {
                id: membership_id,
                role_key: &target.role_key,
                status,
            },
            new_role,
            new_status,
            owners.iter().filter(|id| **id != target.id).count(),
        )?;
        let role_key = new_role.unwrap_or(&target.role_key);
        let status = new_status.unwrap_or(status);
        if !dal::update_membership(tx.conn(), target.id, role_key, status.as_str()).await? {
            return Err(AppError::invalid(
                "role_key",
                "is not a role in this clinic",
            ));
        }
        dal::member(tx.conn(), target.id)
            .await?
            .ok_or(AppError::NotFound("member"))
    })
    .await
}
