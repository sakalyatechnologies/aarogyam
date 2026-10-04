//! Staff: who may change a member's role or status, and the guards that keep a clinic from
//! locking itself out.

use crate::access::MembershipStatus;
use crate::ids::MembershipId;

/// The role key of a clinic's owners, the only role that may make or change owners.
pub const OWNER_ROLE: &str = "owner";

/// Why a staff change was refused. Messages say what to do instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaffRefusal {
    /// Members can't change their own role; another member with staff.manage must.
    OwnRole,
    /// The change would leave the clinic without an active owner.
    LastOwner,
    /// Only owners may make someone an owner or change an owner's membership.
    OwnersOnly,
    /// `invited` is set by invitations, not by hand.
    Status,
}

impl StaffRefusal {
    /// What to tell the person.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::OwnRole => "you can't change your own role; ask another owner",
            Self::LastOwner => {
                "the clinic needs at least one active owner; make someone else an owner first"
            }
            Self::OwnersOnly => "only an owner can make owners or change an owner's membership",
            Self::Status => "status must be active, suspended or left",
        }
    }
}

impl std::fmt::Display for StaffRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for StaffRefusal {}

/// A member as the change sees them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemberState<'a> {
    /// The membership.
    pub id: MembershipId,
    /// Their role key.
    pub role_key: &'a str,
    /// Their status.
    pub status: MembershipStatus,
}

impl MemberState<'_> {
    fn is_active_owner(&self) -> bool {
        self.role_key == OWNER_ROLE && self.status == MembershipStatus::Active
    }
}

/// Checks a change to `target`'s role or status by `actor`.
///
/// `other_active_owners` counts active owners other than `target`, read while their
/// memberships are locked, so two owners can't demote each other at the same moment.
///
/// # Errors
/// The [`StaffRefusal`] that applies.
pub fn check_change(
    actor: &MemberState<'_>,
    target: &MemberState<'_>,
    new_role: Option<&str>,
    new_status: Option<MembershipStatus>,
    other_active_owners: usize,
) -> Result<(), StaffRefusal> {
    let role_changes = new_role.is_some_and(|role| role != target.role_key);
    if new_status == Some(MembershipStatus::Invited) {
        return Err(StaffRefusal::Status);
    }
    if role_changes && actor.id == target.id {
        return Err(StaffRefusal::OwnRole);
    }
    let makes_owner = role_changes && new_role == Some(OWNER_ROLE);
    let touches_owner = target.role_key == OWNER_ROLE
        && (role_changes || new_status.is_some_and(|status| status != target.status));
    if (makes_owner || touches_owner) && actor.role_key != OWNER_ROLE {
        return Err(StaffRefusal::OwnersOnly);
    }
    let after = MemberState {
        id: target.id,
        role_key: new_role.unwrap_or(target.role_key),
        status: new_status.unwrap_or(target.status),
    };
    if target.is_active_owner() && !after.is_active_owner() && other_active_owners == 0 {
        return Err(StaffRefusal::LastOwner);
    }
    Ok(())
}

/// Checks that `actor_role` may invite someone as `role_key`.
///
/// # Errors
/// [`StaffRefusal::OwnersOnly`] when a non-owner invites an owner.
pub fn check_invite(actor_role: &str, role_key: &str) -> Result<(), StaffRefusal> {
    if role_key == OWNER_ROLE && actor_role != OWNER_ROLE {
        return Err(StaffRefusal::OwnersOnly);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(role_key: &str, status: MembershipStatus) -> MemberState<'_> {
        MemberState {
            id: MembershipId::new_v7(),
            role_key,
            status,
        }
    }

    #[test]
    fn nobody_changes_their_own_role() {
        let owner = member(OWNER_ROLE, MembershipStatus::Active);
        assert_eq!(
            check_change(&owner, &owner, Some("doctor"), None, 3),
            Err(StaffRefusal::OwnRole)
        );
        // Sending the same role is no change.
        assert_eq!(
            check_change(&owner, &owner, Some(OWNER_ROLE), None, 0),
            Ok(())
        );
    }

    #[test]
    fn the_last_active_owner_stays() {
        let owner = member(OWNER_ROLE, MembershipStatus::Active);
        let other = member(OWNER_ROLE, MembershipStatus::Active);
        for status in [MembershipStatus::Suspended, MembershipStatus::Left] {
            assert_eq!(
                check_change(&owner, &owner, None, Some(status), 0),
                Err(StaffRefusal::LastOwner)
            );
            assert_eq!(check_change(&owner, &other, None, Some(status), 1), Ok(()));
        }
        assert_eq!(
            check_change(&other, &owner, Some("doctor"), None, 0),
            Err(StaffRefusal::LastOwner)
        );
        // A suspended owner is not the one keeping the clinic running.
        let suspended = member(OWNER_ROLE, MembershipStatus::Suspended);
        assert_eq!(
            check_change(&owner, &suspended, None, Some(MembershipStatus::Left), 0),
            Ok(())
        );
    }

    #[test]
    fn only_owners_make_or_change_owners() {
        let manager = member("manager", MembershipStatus::Active);
        let desk = member("front_desk", MembershipStatus::Active);
        let owner = member(OWNER_ROLE, MembershipStatus::Active);
        assert_eq!(
            check_change(&manager, &desk, Some(OWNER_ROLE), None, 1),
            Err(StaffRefusal::OwnersOnly)
        );
        assert_eq!(
            check_change(&manager, &owner, None, Some(MembershipStatus::Suspended), 1),
            Err(StaffRefusal::OwnersOnly)
        );
        assert_eq!(
            check_change(
                &manager,
                &desk,
                Some("doctor"),
                Some(MembershipStatus::Suspended),
                1
            ),
            Ok(())
        );
        assert_eq!(
            check_invite("manager", OWNER_ROLE),
            Err(StaffRefusal::OwnersOnly)
        );
        assert_eq!(check_invite(OWNER_ROLE, OWNER_ROLE), Ok(()));
        assert_eq!(check_invite("manager", "doctor"), Ok(()));
    }

    #[test]
    fn invited_is_not_set_by_hand() {
        let owner = member(OWNER_ROLE, MembershipStatus::Active);
        let desk = member("front_desk", MembershipStatus::Active);
        assert_eq!(
            check_change(&owner, &desk, None, Some(MembershipStatus::Invited), 1),
            Err(StaffRefusal::Status)
        );
    }
}
