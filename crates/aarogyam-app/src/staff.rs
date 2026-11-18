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
use sakalya_types::{CallingCode, PhoneE164};
use serde_json::json;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::accounts::SignInAccounts;
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
/// [`AppError::Denied`] without `staff.manage` or `roles.manage` (the roles editor lists roles
/// too); [`AppError::Db`] on database failures.
pub async fn roles(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<RoleRow>, AppError> {
    if actor.require(Permission::StaffManage).is_err() {
        actor.require(Permission::RolesManage)?;
    }
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
    /// Their name, which becomes their display name when they join; 1 to 200 characters.
    pub display_name: Option<String>,
    /// Their mobile number; a 10-digit number is taken as Indian.
    pub phone: Option<String>,
}

/// The checked name and phone of an invitee.
#[derive(Debug, Clone, Default)]
pub(crate) struct InviteeDetails {
    display_name: Option<String>,
    phone: Option<PhoneE164>,
}

impl InviteStaff {
    /// Checks the optional name and phone.
    pub(crate) fn details(&self) -> Result<InviteeDetails, AppError> {
        let display_name = match self.display_name.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(name) if name.chars().count() > 200 => {
                return Err(AppError::invalid(
                    "display_name",
                    "is longer than 200 characters",
                ));
            }
            Some(name) => Some(name.to_owned()),
        };
        let phone = match self.phone.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(phone) => Some(
                PhoneE164::parse_with_default(phone, CallingCode::INDIA)
                    .map_err(|_| AppError::invalid("phone", "is not a phone number"))?,
            ),
        };
        Ok(InviteeDetails {
            display_name,
            phone,
        })
    }
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
/// transaction. With `accounts`, the invitee's sign-in account is made first, as the console
/// does: sign-ups are off, so without it the emailed code never arrives.
///
/// # Errors
/// [`AppError::Denied`] without `staff.manage`; [`AppError::Invalid`] for a bad email or an
/// unknown role; [`AppError::Forbidden`] when a non-owner invites an owner;
/// [`AppError::Accounts`] when Supabase fails; [`AppError::Db`] on database failures.
pub async fn invite(
    db: &Db,
    actor: &ClinicActor,
    accounts: Option<&dyn SignInAccounts>,
    request_id: Option<Uuid>,
    input: InviteStaff,
    now: OffsetDateTime,
) -> Result<Invited, AppError> {
    actor.require(Permission::StaffManage)?;
    let email = Email::parse(&input.email).map_err(|error| AppError::invalid("email", error))?;
    let details = input.details()?;
    let role_key = input.role_key.trim().to_owned();
    check_invite(&actor.role_key, &role_key)?;
    let scope = staff_scope(actor, request_id);
    if let Some(accounts) = accounts {
        // The role is checked before an account is made for someone who can't be invited.
        let role_known = db
            .scoped(&scope, async |tx| {
                Ok::<_, AppError>(dal::role_by_key(tx.conn(), &role_key).await?.is_some())
            })
            .await?;
        if !role_known {
            return Err(AppError::invalid(
                "role_key",
                "is not a role in this clinic",
            ));
        }
        accounts.ensure_user(&email).await?;
    }
    invite_in_scope(
        db,
        &scope,
        actor.user_id.uuid(),
        email,
        &details,
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
    details: &InviteeDetails,
    role_key: String,
    now: OffsetDateTime,
) -> Result<Invited, AppError> {
    let (token, token_hash) = crate::tokens::new_token()?;
    let expires_at = now + INVITE_VALID_FOR;
    let id = InvitationId::new_v7();
    let portal_host = db
        .scoped(scope, async |tx| {
            let (role_id, role_name) = dal::role_by_key(tx.conn(), &role_key)
                .await?
                .ok_or_else(|| AppError::invalid("role_key", "is not a role in this clinic"))?;
            let host = dal::portal_host(tx.conn())
                .await?
                .ok_or(AppError::Conflict("the clinic has no portal address yet"))?;
            dal::insert_invitation(
                tx.conn(),
                &dal::NewInvitation {
                    id: id.uuid(),
                    email: email.as_str(),
                    display_name: details.display_name.as_deref(),
                    phone_e164: details.phone.as_ref().map(PhoneE164::as_e164),
                    role_id,
                    invited_by,
                    token_hash: &token_hash,
                    expires_at,
                },
            )
            .await?;
            queue_invite_email(tx, id, &email, &role_name, &host, &token, expires_at).await?;
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

/// Queues the invitation email with its link secret in the caller's clinic transaction.
async fn queue_invite_email(
    tx: &mut sakalya_db::ScopedTx,
    id: InvitationId,
    email: &Email,
    role_name: &str,
    host: &str,
    token: &str,
    expires_at: OffsetDateTime,
) -> Result<(), AppError> {
    let profile = clinic::profile(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    let expires_on = expires_at
        .to_offset(clinic_offset(&profile.timezone))
        .date();
    enqueue_staff_email(
        tx,
        &StaffEmail {
            kind: MessageKind::StaffInvited,
            to: email,
            payload: json!({
                "invitation_id": id.uuid(),
                "clinic_name": profile.name,
                "role_name": role_name,
                "portal_host": host,
                "expires_on": format!("{} {} {}", expires_on.day(), expires_on.month(), expires_on.year()),
            }),
            secret: Some(token),
        },
    )
    .await?;
    Ok(())
}

/// Locks a pending invitation the actor may change: only owners touch an owner's invitation.
async fn lock_invitation(
    tx: &mut sakalya_db::ScopedTx,
    actor: &ClinicActor,
    id: InvitationId,
) -> Result<dal::LockedInvitation, AppError> {
    let invitation = dal::lock_pending_invitation(tx.conn(), id.uuid())
        .await?
        .ok_or(AppError::NotFound("invitation"))?;
    check_invite(&actor.role_key, &invitation.role_key)?;
    Ok(invitation)
}

/// Sends a pending invitation again with a new link, valid for another
/// [`INVITE_VALID_FOR`]; the old link stops working and an unsent earlier email is dropped.
/// With `accounts`, the invitee's sign-in account is made first, so an invitation sent before
/// accounts were made with it can still be accepted.
///
/// # Errors
/// [`AppError::Denied`] without `staff.manage`; [`AppError::NotFound`] when no pending
/// invitation has this id; [`AppError::Forbidden`] when a non-owner resends an owner's
/// invitation; [`AppError::Conflict`] when it has no email or the clinic has no portal address;
/// [`AppError::Accounts`] when Supabase fails; [`AppError::Db`] on database failures.
pub async fn resend_invitation(
    db: &Db,
    actor: &ClinicActor,
    accounts: Option<&dyn SignInAccounts>,
    request_id: Option<Uuid>,
    id: InvitationId,
    now: OffsetDateTime,
) -> Result<Invited, AppError> {
    actor.require(Permission::StaffManage)?;
    let scope = staff_scope(actor, request_id);
    let email = db
        .scoped(&scope, async |tx| {
            let invitation = lock_invitation(tx, actor, id).await?;
            invitation
                .email
                .ok_or(AppError::Conflict("the invitation has no email address"))
        })
        .await?;
    let email = Email::parse(&email).map_err(|error| AppError::invalid("email", error))?;
    if let Some(accounts) = accounts {
        accounts.ensure_user(&email).await?;
    }
    let (token, token_hash) = crate::tokens::new_token()?;
    let expires_at = now + INVITE_VALID_FOR;
    db.scoped(&scope, async |tx| {
        let invitation = lock_invitation(tx, actor, id).await?;
        let host = dal::portal_host(tx.conn())
            .await?
            .ok_or(AppError::Conflict("the clinic has no portal address yet"))?;
        dal::renew_invitation(tx.conn(), id.uuid(), &token_hash, expires_at).await?;
        dal::abandon_invitation_emails(tx.conn(), id.uuid(), MessageKind::StaffInvited.as_str())
            .await?;
        queue_invite_email(
            tx,
            id,
            &email,
            &invitation.role_name,
            &host,
            &token,
            expires_at,
        )
        .await?;
        Ok(Invited {
            id,
            email: email.as_str().to_owned(),
            role_key: invitation.role_key,
            expires_at,
            token,
            portal_host: host,
        })
    })
    .await
}

/// Cancels a pending invitation: its link stops working, an unsent email is dropped, and it
/// leaves the pending list.
///
/// # Errors
/// [`AppError::Denied`] without `staff.manage`; [`AppError::NotFound`] when no pending
/// invitation has this id; [`AppError::Forbidden`] when a non-owner cancels an owner's
/// invitation; [`AppError::Db`] on database failures.
pub async fn cancel_invitation(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: InvitationId,
) -> Result<(), AppError> {
    actor.require(Permission::StaffManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        lock_invitation(tx, actor, id).await?;
        dal::cancel_invitation(tx.conn(), id.uuid()).await?;
        dal::abandon_invitation_emails(tx.conn(), id.uuid(), MessageKind::StaffInvited.as_str())
            .await?;
        Ok(())
    })
    .await
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
