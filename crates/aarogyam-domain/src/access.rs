//! Who is acting, in which clinic, and with what rights.

use std::fmt;

use crate::ids::{ClinicId, MembershipId, SupportGrantId, UserId};
use crate::permission::{Permission, PermissionSet, Scope};

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

    /// Every state, in lifecycle order.
    pub const ALL: [Self; 4] = [Self::Trial, Self::Active, Self::Suspended, Self::Churned];

    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Trial => "trial",
            Self::Active => "active",
            Self::Suspended => "suspended",
            Self::Churned => "churned",
        }
    }

    /// The stored values of the states members may use, for a query to filter on.
    #[must_use]
    pub fn open_values() -> Vec<&'static str> {
        Self::ALL
            .into_iter()
            .filter(|status| status.is_open())
            .map(Self::as_str)
            .collect()
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

/// The clinic a request is for, as the host lookup found it: enough to know the clinic's local
/// day and number its patients without reading the clinic first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicPlace {
    /// The clinic.
    pub id: ClinicId,
    /// Its IANA time zone, such as `Asia/Kolkata`.
    pub timezone: String,
    /// Its patient-number prefix, such as `SD`.
    pub number_prefix: String,
}

/// A member acting in a clinic: the result of every check, carried by each clinic request.
#[derive(Debug, Clone)]
pub struct ClinicActor {
    /// The clinic, from the host name.
    pub clinic_id: ClinicId,
    /// The clinic's IANA time zone, as the host lookup found it (cached briefly).
    pub timezone: String,
    /// The clinic's patient-number prefix, as the host lookup found it.
    pub number_prefix: String,
    /// The person.
    pub user_id: UserId,
    /// Their membership; the nil id for Sakalya staff acting under a support grant, who have
    /// none (a write naming it fails its foreign key).
    pub membership_id: MembershipId,
    /// Their role key (`support` under a grant).
    pub role_key: String,
    /// What they may do.
    pub permissions: PermissionSet,
    /// The support grant Sakalya staff act under; `None` for members.
    pub support_grant: Option<SupportGrantId>,
}

/// What Sakalya staff may do in a clinic under a support grant: read the records a clinic
/// member reads, at every record, and nothing else (`docs/decisions.md`, "Support grants").
/// Contact details stay masked, money totals and the change history stay hidden.
pub const SUPPORT_PERMISSIONS: PermissionSet = PermissionSet::EMPTY
    .with(Permission::PatientsRead, Scope::All)
    .with(Permission::AppointmentsRead, Scope::All)
    .with(Permission::ClinicalRead, Scope::All)
    .with(Permission::BillingRead, Scope::All)
    .with(Permission::InventoryRead, Scope::All);

/// What the database reported about Sakalya staff and a clinic (`app.support_authorize`): an
/// active grant exists.
#[derive(Debug, Clone, Copy)]
pub struct SupportAuthorization {
    /// The staff member's user.
    pub user_id: UserId,
    /// The grant they act under.
    pub grant_id: SupportGrantId,
    /// Whether this sign-in session was revoked.
    pub session_revoked: bool,
}

impl ClinicActor {
    /// Decides whether `authorization` lets the person act in `clinic`.
    ///
    /// # Errors
    /// The first [`Denied`] reason that applies.
    pub fn admit(clinic: ClinicPlace, authorization: Authorization) -> Result<Self, Denied> {
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
            clinic_id: clinic.id,
            timezone: clinic.timezone,
            number_prefix: clinic.number_prefix,
            user_id: authorization.user_id,
            membership_id: authorization.membership_id,
            role_key: authorization.role_key,
            permissions: authorization.permissions,
            support_grant: None,
        })
    }

    /// Decides whether a support grant lets Sakalya staff read in `clinic`.
    ///
    /// # Errors
    /// [`Denied::SessionRevoked`] when the sign-in session was revoked.
    pub fn support(clinic: ClinicPlace, access: SupportAuthorization) -> Result<Self, Denied> {
        if access.session_revoked {
            return Err(Denied::SessionRevoked);
        }
        Ok(Self {
            clinic_id: clinic.id,
            timezone: clinic.timezone,
            number_prefix: clinic.number_prefix,
            user_id: access.user_id,
            membership_id: MembershipId::from_uuid(uuid::Uuid::nil()),
            role_key: "support".into(),
            permissions: SUPPORT_PERMISSIONS,
            support_grant: Some(access.grant_id),
        })
    }

    /// Who is acting, for the change history and the access record.
    #[must_use]
    pub const fn kind(&self) -> ActorKind {
        if self.support_grant.is_some() {
            ActorKind::Support
        } else {
            ActorKind::Staff
        }
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

    /// Which records `permission` reaches for this person. `own` and `assigned` both narrow
    /// to the member's own records: the schema has no care-team assignment yet.
    #[must_use]
    pub fn reach(&self, permission: Permission) -> Reach {
        match self.permissions.scope(permission) {
            Some(Scope::All) => Reach::All,
            // No permission reaches nothing; the route's permission check refuses first.
            Some(Scope::Own | Scope::Assigned) | None => Reach::Own(self.membership_id),
        }
    }

    /// Why this person is reading a patient's record, for the access record.
    #[must_use]
    pub fn access_purpose(&self) -> &'static str {
        if self.support_grant.is_some() {
            return "support";
        }
        match self.role_key.as_str() {
            "front_desk" => "front_desk",
            "finance" => "billing",
            _ => "care",
        }
    }
}

/// Which records a permission reaches: every record in the clinic, or the member's own. Queries
/// take it as [`Reach::member`], a nullable parameter that the `app.*_in_reach` SQL functions
/// read: null passes every row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// Every record in the clinic.
    All,
    /// Records this membership is responsible for or created (see `docs/decisions.md`).
    Own(MembershipId),
}

impl Reach {
    /// The membership to narrow to, or `None` for every record.
    #[must_use]
    pub fn member(self) -> Option<uuid::Uuid> {
        match self {
            Self::All => None,
            Self::Own(member) => Some(member.uuid()),
        }
    }

    /// Whether a record belonging to `membership` (such as a practitioner's sign-in) is within
    /// reach.
    #[must_use]
    pub fn includes(self, membership: Option<uuid::Uuid>) -> bool {
        match self {
            Self::All => true,
            Self::Own(member) => membership == Some(member.uuid()),
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

    fn place() -> ClinicPlace {
        ClinicPlace {
            id: ClinicId::new_v7(),
            timezone: "Asia/Kolkata".into(),
            number_prefix: "SD".into(),
        }
    }

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
    fn support_reads_everything_and_writes_nothing() {
        let grant = SupportGrantId::new_v7();
        let access = SupportAuthorization {
            user_id: UserId::new_v7(),
            grant_id: grant,
            session_revoked: false,
        };
        let actor = ClinicActor::support(place(), access).unwrap();
        assert_eq!(actor.kind(), ActorKind::Support);
        assert_eq!(actor.support_grant, Some(grant));
        assert_eq!(actor.access_purpose(), "support");
        assert_eq!(actor.reach(Permission::PatientsRead), Reach::All);
        for permission in Permission::ALL {
            let reads = matches!(
                permission,
                Permission::PatientsRead
                    | Permission::AppointmentsRead
                    | Permission::ClinicalRead
                    | Permission::BillingRead
                    | Permission::InventoryRead
            );
            assert_eq!(actor.require(permission).is_ok(), reads, "{permission}");
        }
        let revoked = SupportAuthorization {
            session_revoked: true,
            ..access
        };
        assert_eq!(
            ClinicActor::support(place(), revoked).unwrap_err(),
            Denied::SessionRevoked
        );
    }

    #[test]
    fn active_members_are_admitted() {
        let actor = ClinicActor::admit(place(), authorization()).unwrap();
        assert_eq!(actor.timezone, "Asia/Kolkata");
        assert!(actor.require(Permission::PatientsRead).is_ok());
        assert_eq!(
            actor.require(Permission::FinanceView),
            Err(Denied::MissingPermission(Permission::FinanceView))
        );
        assert_eq!(actor.access_purpose(), "front_desk");
    }

    #[test]
    fn reach_follows_the_widest_scope() {
        let mut auth = authorization();
        auth.permissions = PermissionSet::EMPTY
            .with(Permission::PatientsRead, Scope::All)
            .with(Permission::ClinicalRead, Scope::Own)
            .with(Permission::ClinicalWrite, Scope::Assigned);
        let member = auth.membership_id;
        let actor = ClinicActor::admit(place(), auth).unwrap();
        assert_eq!(actor.reach(Permission::PatientsRead), Reach::All);
        assert_eq!(actor.reach(Permission::PatientsRead).member(), None);
        assert_eq!(actor.reach(Permission::ClinicalRead), Reach::Own(member));
        assert_eq!(actor.reach(Permission::ClinicalWrite), Reach::Own(member));
        assert_eq!(
            actor.reach(Permission::ClinicalWrite).member(),
            Some(member.uuid())
        );
    }

    #[test]
    fn revoked_disabled_and_inactive_are_refused() {
        let clinic = place();
        let revoked = Authorization {
            session_revoked: true,
            ..authorization()
        };
        assert_eq!(
            ClinicActor::admit(clinic.clone(), revoked).unwrap_err(),
            Denied::SessionRevoked
        );
        let disabled = Authorization {
            user_active: false,
            ..authorization()
        };
        assert_eq!(
            ClinicActor::admit(clinic.clone(), disabled).unwrap_err(),
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
                ClinicActor::admit(clinic.clone(), inactive).unwrap_err(),
                Denied::NotAMember
            );
        }
    }

    #[test]
    fn stored_clinic_states_read_back() {
        for status in ClinicStatus::ALL {
            assert_eq!(ClinicStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(ClinicStatus::open_values(), ["trial", "active"]);
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
