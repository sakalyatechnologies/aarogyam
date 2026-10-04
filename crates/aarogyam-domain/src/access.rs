//! Who is acting, in which clinic, and with what rights.

use std::fmt;

use crate::ids::{ClinicId, MembershipId, UserId};
use crate::permission::{Permission, PermissionSet};

/// Who is acting, as recorded in the change history and the access record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorKind {
    /// Clinic staff or a doctor.
    Staff,
    /// A patient opening their own record (share link or patient app).
    Patient,
    /// Sakalya support under a time-limited grant.
    Support,
    /// The system itself (worker, migrations).
    System,
}

impl ActorKind {
    /// The value stored in `app.actor_kind`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Staff => "staff",
            Self::Patient => "patient",
            Self::Support => "support",
            Self::System => "system",
        }
    }
}

/// A clinic's lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClinicStatus {
    /// Trying Aarogyam.
    Trial,
    /// Paying customer.
    Active,
    /// Access paused (unpaid, or on request).
    Suspended,
    /// Left.
    Churned,
}

impl ClinicStatus {
    /// Parses the stored value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "trial" => Some(Self::Trial),
            "active" => Some(Self::Active),
            "suspended" => Some(Self::Suspended),
            "churned" => Some(Self::Churned),
            _ => None,
        }
    }

    /// Whether members may use the clinic.
    #[must_use]
    pub const fn is_open(self) -> bool {
        matches!(self, Self::Trial | Self::Active)
    }
}

/// A membership's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MembershipStatus {
    /// Invited, not yet joined.
    Invited,
    /// Working at the clinic.
    Active,
    /// Access paused by the clinic.
    Suspended,
    /// No longer at the clinic.
    Left,
}

impl MembershipStatus {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Invited => "invited",
            Self::Active => "active",
            Self::Suspended => "suspended",
            Self::Left => "left",
        }
    }

    /// Parses the stored value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "invited" => Some(Self::Invited),
            "active" => Some(Self::Active),
            "suspended" => Some(Self::Suspended),
            "left" => Some(Self::Left),
            _ => None,
        }
    }
}

/// Why a signed-in person may not use a clinic. Each maps to an HTTP answer that reveals no
/// more than the caller already knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denied {
    /// The host is not a clinic, or the clinic is closed to members.
    UnknownClinic,
    /// Not a member, or the membership isn't active.
    NotAMember,
    /// The user account is disabled.
    UserDisabled,
    /// This sign-in session was revoked.
    SessionRevoked,
    /// A member, but the role lacks the permission.
    MissingPermission(Permission),
}

impl fmt::Display for Denied {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownClinic => f.write_str("unknown clinic"),
            Self::NotAMember => f.write_str("not a member of this clinic"),
            Self::UserDisabled => f.write_str("account disabled"),
            Self::SessionRevoked => f.write_str("session revoked"),
            Self::MissingPermission(permission) => write!(f, "missing permission {permission}"),
        }
    }
}

/// What the database reported about a person and a clinic (`app.authorize`).
#[derive(Debug, Clone)]
pub struct Authorization {
    /// The user.
    pub user_id: UserId,
    /// Whether the user account is active.
    pub user_active: bool,
    /// The membership in this clinic.
    pub membership_id: MembershipId,
    /// The membership's state.
    pub membership_status: Option<MembershipStatus>,
    /// The role's key, such as `doctor`.
    pub role_key: String,
    /// The role's permissions.
    pub permissions: PermissionSet,
    /// Whether this sign-in session was revoked.
    pub session_revoked: bool,
}

/// A member acting in a clinic: the result of every check, carried by each clinic request.
#[derive(Debug, Clone)]
pub struct ClinicActor {
    /// The clinic, from the host name.
    pub clinic_id: ClinicId,
    /// The person.
    pub user_id: UserId,
    /// Their membership.
    pub membership_id: MembershipId,
    /// Their role key.
    pub role_key: String,
    /// What they may do.
    pub permissions: PermissionSet,
}

impl ClinicActor {
    /// Decides whether `authorization` lets the person act in `clinic_id`.
    ///
    /// # Errors
    /// The first [`Denied`] reason that applies.
    pub fn admit(clinic_id: ClinicId, authorization: Authorization) -> Result<Self, Denied> {
        if authorization.session_revoked {
            return Err(Denied::SessionRevoked);
        }
        if !authorization.user_active {
            return Err(Denied::UserDisabled);
        }
        if authorization.membership_status != Some(MembershipStatus::Active) {
            return Err(Denied::NotAMember);
        }
        Ok(Self {
            clinic_id,
            user_id: authorization.user_id,
            membership_id: authorization.membership_id,
            role_key: authorization.role_key,
            permissions: authorization.permissions,
        })
    }

    /// Checks one permission.
    ///
    /// # Errors
    /// [`Denied::MissingPermission`] when the role lacks it.
    pub fn require(&self, permission: Permission) -> Result<(), Denied> {
        if self.permissions.allows(permission) {
            Ok(())
        } else {
            Err(Denied::MissingPermission(permission))
        }
    }

    /// Why this person is reading a patient's record, for the access record.
    #[must_use]
    pub fn access_purpose(&self) -> &'static str {
        match self.role_key.as_str() {
            "front_desk" => "front_desk",
            "finance" => "billing",
            _ => "care",
        }
    }
}

/// A Sakalya staff role in the console.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformRole {
    /// Runs the platform.
    Owner,
    /// Helps clinics, under time-limited grants.
    Support,
    /// Sets up new clinics.
    Onboarding,
    /// Reads platform metrics.
    Analyst,
}

impl PlatformRole {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Support => "support",
            Self::Onboarding => "onboarding",
            Self::Analyst => "analyst",
        }
    }

    /// Parses the stored value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "owner" => Some(Self::Owner),
            "support" => Some(Self::Support),
            "onboarding" => Some(Self::Onboarding),
            "analyst" => Some(Self::Analyst),
            _ => None,
        }
    }

    /// Whether this role may create clinics.
    #[must_use]
    pub const fn can_create_clinics(self) -> bool {
        matches!(self, Self::Owner | Self::Onboarding)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permission::Scope;

    fn authorization() -> Authorization {
        Authorization {
            user_id: UserId::new_v7(),
            user_active: true,
            membership_id: MembershipId::new_v7(),
            membership_status: Some(MembershipStatus::Active),
            role_key: "front_desk".into(),
            permissions: PermissionSet::EMPTY.with(Permission::PatientsRead, Scope::All),
            session_revoked: false,
        }
    }

    #[test]
    fn active_members_are_admitted() {
        let actor = ClinicActor::admit(ClinicId::new_v7(), authorization()).unwrap();
        assert!(actor.require(Permission::PatientsRead).is_ok());
        assert_eq!(
            actor.require(Permission::FinanceView),
            Err(Denied::MissingPermission(Permission::FinanceView))
        );
        assert_eq!(actor.access_purpose(), "front_desk");
    }

    #[test]
    fn revoked_disabled_and_inactive_are_refused() {
        let clinic = ClinicId::new_v7();
        let revoked = Authorization {
            session_revoked: true,
            ..authorization()
        };
        assert_eq!(
            ClinicActor::admit(clinic, revoked).unwrap_err(),
            Denied::SessionRevoked
        );
        let disabled = Authorization {
            user_active: false,
            ..authorization()
        };
        assert_eq!(
            ClinicActor::admit(clinic, disabled).unwrap_err(),
            Denied::UserDisabled
        );
        for status in [
            Some(MembershipStatus::Invited),
            Some(MembershipStatus::Suspended),
            Some(MembershipStatus::Left),
            None,
        ] {
            let inactive = Authorization {
                membership_status: status,
                ..authorization()
            };
            assert_eq!(
                ClinicActor::admit(clinic, inactive).unwrap_err(),
                Denied::NotAMember
            );
        }
    }

    #[test]
    fn clinic_and_platform_states() {
        assert!(ClinicStatus::parse("trial").unwrap().is_open());
        assert!(!ClinicStatus::parse("suspended").unwrap().is_open());
        assert!(
            PlatformRole::parse("onboarding")
                .unwrap()
                .can_create_clinics()
        );
        assert!(!PlatformRole::parse("analyst").unwrap().can_create_clinics());
        assert_eq!(PlatformRole::parse("root"), None);
    }
}
