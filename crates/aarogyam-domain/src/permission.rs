//! What a role may do, and how far each permission reaches.

use std::fmt;

/// Something a role may do. The keys match the `aarogyam.permissions` catalogue seeded by
/// migrations; a database test checks that both lists agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Permission {
    /// See patients and their records.
    PatientsRead,
    /// Register and edit patients.
    PatientsWrite,
    /// See full phone numbers and email addresses (otherwise masked).
    PatientsContact,
    /// See the calendar and queue.
    AppointmentsRead,
    /// Book, move and cancel appointments.
    AppointmentsWrite,
    /// See visits, notes, charts and files.
    ClinicalRead,
    /// Record visits, notes, charts and files.
    ClinicalWrite,
    /// Issue and cancel prescriptions.
    PrescriptionsIssue,
    /// See bills and payments.
    BillingRead,
    /// Create bills and take payments.
    BillingWrite,
    /// See revenue, expenses and salaries.
    FinanceView,
    /// Invite staff and change their roles.
    StaffManage,
    /// Change clinic settings, branding and templates.
    SettingsManage,
    /// See the change history and access record.
    AuditView,
    /// Export data to Excel.
    ReportsExport,
    /// See stock levels, suppliers and expiry dates.
    InventoryRead,
    /// Receive, use and adjust stock; edit items and suppliers.
    InventoryManage,
    /// Choose what each role can see and do.
    RolesManage,
    /// Record clinic expenses.
    ExpensesWrite,
    /// See the Analytics page: chair use, patients and busy hours.
    AnalyticsView,
    /// Record patient-reported allergies and "No known allergies" at registration. Grants no
    /// clinical reading.
    IntakeWrite,
    /// Let a named Sakalya staff member read the clinic's records for up to 7 days, and revoke
    /// that access.
    SupportGrant,
    /// Chat with other staff of the clinic.
    ChatUse,
}

impl Permission {
    /// Every permission, in catalogue order.
    pub const ALL: [Self; 23] = [
        Self::PatientsRead,
        Self::PatientsWrite,
        Self::PatientsContact,
        Self::AppointmentsRead,
        Self::AppointmentsWrite,
        Self::ClinicalRead,
        Self::ClinicalWrite,
        Self::PrescriptionsIssue,
        Self::BillingRead,
        Self::BillingWrite,
        Self::FinanceView,
        Self::StaffManage,
        Self::SettingsManage,
        Self::AuditView,
        Self::ReportsExport,
        Self::InventoryRead,
        Self::InventoryManage,
        Self::RolesManage,
        Self::ExpensesWrite,
        Self::AnalyticsView,
        Self::IntakeWrite,
        Self::SupportGrant,
        Self::ChatUse,
    ];

    /// The catalogue key, such as `patients.read`.
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::PatientsRead => "patients.read",
            Self::PatientsWrite => "patients.write",
            Self::PatientsContact => "patients.contact",
            Self::AppointmentsRead => "appointments.read",
            Self::AppointmentsWrite => "appointments.write",
            Self::ClinicalRead => "clinical.read",
            Self::ClinicalWrite => "clinical.write",
            Self::PrescriptionsIssue => "prescriptions.issue",
            Self::BillingRead => "billing.read",
            Self::BillingWrite => "billing.write",
            Self::FinanceView => "finance.view",
            Self::StaffManage => "staff.manage",
            Self::SettingsManage => "settings.manage",
            Self::AuditView => "audit.view",
            Self::ReportsExport => "reports.export",
            Self::InventoryRead => "inventory.read",
            Self::InventoryManage => "inventory.manage",
            Self::RolesManage => "roles.manage",
            Self::ExpensesWrite => "expenses.write",
            Self::AnalyticsView => "analytics.view",
            Self::IntakeWrite => "intake.write",
            Self::SupportGrant => "support.grant",
            Self::ChatUse => "chat.use",
        }
    }

    /// Parses a catalogue key.
    #[must_use]
    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|permission| permission.key() == key)
    }

    /// The scopes this permission can be narrowed to; [`Scope::All`] always among them.
    /// Matches the `scopes` column of the catalogue.
    #[must_use]
    pub const fn scopes(self) -> &'static [Scope] {
        match self {
            Self::PatientsRead
            | Self::AppointmentsRead
            | Self::AppointmentsWrite
            | Self::ClinicalRead
            | Self::ClinicalWrite
            | Self::PrescriptionsIssue => &[Scope::All, Scope::Own, Scope::Assigned],
            _ => &[Scope::All],
        }
    }

    const fn bit(self) -> u32 {
        1 << self as u32
    }
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.key())
    }
}

/// How far a permission reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scope {
    /// Every record in the clinic.
    All,
    /// Records the member created or is responsible for.
    Own,
    /// Records assigned to the member, such as a consultant's patients.
    Assigned,
}

impl Scope {
    /// The catalogue key: `all`, `own` or `assigned`.
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Own => "own",
            Self::Assigned => "assigned",
        }
    }

    /// Parses a catalogue key.
    #[must_use]
    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "all" => Some(Self::All),
            "own" => Some(Self::Own),
            "assigned" => Some(Self::Assigned),
            _ => None,
        }
    }
}

/// The permissions a membership holds, each with its scope. Copyable and allocation-free.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PermissionSet {
    all: u32,
    own: u32,
    assigned: u32,
}

impl PermissionSet {
    /// No permissions.
    pub const EMPTY: Self = Self {
        all: 0,
        own: 0,
        assigned: 0,
    };

    /// Returns the set with `permission` granted at `scope`.
    #[must_use]
    pub const fn with(self, permission: Permission, scope: Scope) -> Self {
        let bit = permission.bit();
        match scope {
            Scope::All => Self {
                all: self.all | bit,
                ..self
            },
            Scope::Own => Self {
                own: self.own | bit,
                ..self
            },
            Scope::Assigned => Self {
                assigned: self.assigned | bit,
                ..self
            },
        }
    }

    /// Builds a set from catalogue keys and scopes, as the database returns them. Unknown keys
    /// are returned separately so the caller can log them; they grant nothing.
    pub fn from_keys<'a>(
        pairs: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> (Self, Vec<&'a str>) {
        let mut set = Self::EMPTY;
        let mut unknown = Vec::new();
        for (key, scope) in pairs {
            match (Permission::from_key(key), Scope::from_key(scope)) {
                (Some(permission), Some(scope)) => set = set.with(permission, scope),
                _ => unknown.push(key),
            }
        }
        (set, unknown)
    }

    /// Whether `permission` is held at any scope.
    #[must_use]
    pub const fn allows(self, permission: Permission) -> bool {
        (self.all | self.own | self.assigned) & permission.bit() != 0
    }

    /// The widest scope at which `permission` is held.
    #[must_use]
    pub const fn scope(self, permission: Permission) -> Option<Scope> {
        let bit = permission.bit();
        if self.all & bit != 0 {
            Some(Scope::All)
        } else if self.assigned & bit != 0 {
            Some(Scope::Assigned)
        } else if self.own & bit != 0 {
            Some(Scope::Own)
        } else {
            None
        }
    }

    /// Whether a grant of `permission` at `scope` is within what this set holds: held at
    /// [`Scope::All`], or at exactly `scope`.
    #[must_use]
    pub const fn covers(self, permission: Permission, scope: Scope) -> bool {
        let bit = permission.bit();
        self.all & bit != 0
            || match scope {
                Scope::All => false,
                Scope::Own => self.own & bit != 0,
                Scope::Assigned => self.assigned & bit != 0,
            }
    }

    /// Every permission held with its widest scope, in catalogue order.
    pub fn grants(self) -> impl Iterator<Item = (Permission, Scope)> {
        Permission::ALL
            .into_iter()
            .filter_map(move |permission| self.scope(permission).map(|scope| (permission, scope)))
    }

    /// The permissions held, at any scope, in catalogue order.
    pub fn iter(self) -> impl Iterator<Item = Permission> {
        Permission::ALL
            .into_iter()
            .filter(move |permission| self.allows(*permission))
    }
}

/// A permission a route requires, named by a type so a route can't be registered without one.
pub trait Required: Send + Sync + 'static {
    /// The permission the route checks.
    const PERMISSION: Permission;
}

macro_rules! required {
    ($($name:ident),* $(,)?) => {
        /// Marker types for [`Required`], one per [`Permission`].
        pub mod require {
            use super::{Permission, Required};
            $(
                #[doc = concat!("Requires [`Permission::", stringify!($name), "`].")]
                #[derive(Debug, Clone, Copy)]
                pub struct $name;
                impl Required for $name {
                    const PERMISSION: Permission = Permission::$name;
                }
            )*
        }
    };
}

required!(
    PatientsRead,
    PatientsWrite,
    PatientsContact,
    AppointmentsRead,
    AppointmentsWrite,
    ClinicalRead,
    ClinicalWrite,
    PrescriptionsIssue,
    BillingRead,
    BillingWrite,
    FinanceView,
    StaffManage,
    SettingsManage,
    AuditView,
    ReportsExport,
    InventoryRead,
    InventoryManage,
    RolesManage,
    ExpensesWrite,
    AnalyticsView,
    IntakeWrite,
    SupportGrant,
    ChatUse,
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_and_are_unique() {
        let mut keys: Vec<&str> = Permission::ALL.iter().map(|p| p.key()).collect();
        for permission in Permission::ALL {
            assert_eq!(Permission::from_key(permission.key()), Some(permission));
        }
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), Permission::ALL.len());
        assert_eq!(Permission::from_key("patients.delete"), None);
    }

    #[test]
    fn set_reports_the_widest_scope() {
        let set = PermissionSet::EMPTY
            .with(Permission::PatientsRead, Scope::Assigned)
            .with(Permission::PatientsRead, Scope::All)
            .with(Permission::ClinicalWrite, Scope::Own);
        assert!(set.allows(Permission::PatientsRead));
        assert_eq!(set.scope(Permission::PatientsRead), Some(Scope::All));
        assert_eq!(set.scope(Permission::ClinicalWrite), Some(Scope::Own));
        assert!(!set.allows(Permission::FinanceView));
        assert_eq!(set.iter().count(), 2);
    }

    #[test]
    fn unknown_keys_grant_nothing() {
        let (set, unknown) = PermissionSet::from_keys([
            ("patients.read", "all"),
            ("root.everything", "all"),
            ("billing.read", "galaxy"),
        ]);
        assert!(set.allows(Permission::PatientsRead));
        assert!(!set.allows(Permission::BillingRead));
        assert_eq!(unknown, ["root.everything", "billing.read"]);
    }

    #[test]
    fn marker_types_name_their_permission() {
        assert_eq!(
            <require::PatientsRead as Required>::PERMISSION,
            Permission::PatientsRead
        );
        assert_eq!(
            <require::AuditView as Required>::PERMISSION.key(),
            "audit.view"
        );
    }
}
