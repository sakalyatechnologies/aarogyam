//! Roles the clinic edits: their keys, the permissions they grant, and the rules that keep an
//! edit safe (the owner role stays whole, nobody edits their own access, nobody grants what
//! they don't hold).

use std::fmt;

use crate::permission::{Permission, PermissionSet, Scope};
use crate::staff::OWNER_ROLE;

/// A role's key, such as `front_desk`: 2 to 40 lower-case letters and underscores.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RoleKey(String);

impl RoleKey {
    /// Parses a key.
    ///
    /// # Errors
    /// [`RoleKeyError`] when it isn't 2 to 40 lower-case letters and underscores.
    pub fn parse(text: &str) -> Result<Self, RoleKeyError> {
        let valid = (2..=40).contains(&text.len())
            && text
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'_');
        if valid {
            Ok(Self(text.to_owned()))
        } else {
            Err(RoleKeyError)
        }
    }

    /// A key made from a role's name: `Senior nurse` gives `senior_nurse`. Letters other than
    /// a to z are dropped, so a name in another script needs a key of its own.
    ///
    /// # Errors
    /// [`RoleKeyError`] when too little of the name is left.
    pub fn from_name(name: &str) -> Result<Self, RoleKeyError> {
        let mut key = String::new();
        for ch in name.trim().chars() {
            if ch.is_ascii_alphabetic() {
                key.push(ch.to_ascii_lowercase());
            } else if !key.is_empty() && !key.ends_with('_') {
                key.push('_');
            }
        }
        let key = key.trim_end_matches('_');
        let key: String = key.chars().take(40).collect();
        Self::parse(key.trim_end_matches('_'))
    }

    /// The key.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Whether this is the owner role, which nobody edits or removes.
    #[must_use]
    pub fn is_owner(&self) -> bool {
        self.0 == OWNER_ROLE
    }
}

impl fmt::Display for RoleKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A role key that isn't 2 to 40 lower-case letters and underscores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("use 2 to 40 lower-case letters a to z and underscores")]
pub struct RoleKeyError;

/// One permission a role grants, at one scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Grant {
    /// What it may do.
    pub permission: Permission,
    /// How far it reaches.
    pub scope: Scope,
}

/// Why a role's permission list was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GrantError {
    /// A key that isn't in the catalogue.
    #[error("unknown permission {0}")]
    UnknownPermission(String),
    /// A scope other than all, own or assigned.
    #[error("scope must be all, own or assigned")]
    UnknownScope,
    /// The same permission twice.
    #[error("{0} is listed twice")]
    Duplicate(Permission),
    /// A scope the permission can't be narrowed to.
    #[error("{0} can't be limited to {1} records")]
    ScopeNotAllowed(Permission, &'static str),
}

/// A role's permissions, each once, sorted by key: the order the change history stores.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoleGrants(Vec<Grant>);

impl RoleGrants {
    /// Parses `(key, scope)` pairs as received.
    ///
    /// # Errors
    /// The first [`GrantError`] found.
    pub fn parse<'a>(
        pairs: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Result<Self, GrantError> {
        let mut grants: Vec<Grant> = Vec::new();
        for (key, scope) in pairs {
            let permission = Permission::from_key(key.trim())
                .ok_or_else(|| GrantError::UnknownPermission(key.trim().to_owned()))?;
            let scope = Scope::from_key(scope.trim()).ok_or(GrantError::UnknownScope)?;
            if !permission.scopes().contains(&scope) {
                return Err(GrantError::ScopeNotAllowed(permission, scope.key()));
            }
            if grants.iter().any(|grant| grant.permission == permission) {
                return Err(GrantError::Duplicate(permission));
            }
            grants.push(Grant { permission, scope });
        }
        grants.sort_by_key(|grant| grant.permission.key());
        Ok(Self(grants))
    }

    /// The grants, sorted by key.
    #[must_use]
    pub fn as_slice(&self) -> &[Grant] {
        &self.0
    }

    /// The grants `actor` doesn't hold at that scope. Granting them is refused unless the role
    /// already has them (keeping what is there is not granting).
    #[must_use]
    pub fn unheld_by(&self, actor: PermissionSet) -> Vec<Grant> {
        self.0
            .iter()
            .copied()
            .filter(|grant| !actor.covers(grant.permission, grant.scope))
            .collect()
    }
}

/// Why a change to a role was refused. Messages say what to do instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleRefusal {
    /// The owner role always holds everything and can't be removed.
    OwnerRole,
    /// Members can't change their own role's access; someone else with roles.manage must.
    OwnRole,
    /// The change grants something the actor doesn't hold.
    NotHeld,
    /// Standard roles can be edited or reset, not removed.
    StandardRole,
    /// People still have the role, or are invited with it.
    InUse,
    /// A new role can't start as a copy of the owner.
    OwnerTemplate,
}

impl RoleRefusal {
    /// What to tell the person.
    #[must_use]
    pub const fn message(self) -> &'static str {
        match self {
            Self::OwnerRole => {
                "the owner role always has full access and can't be changed or removed"
            }
            Self::OwnRole => "you can't change your own role's access; ask an owner",
            Self::NotHeld => "you can only give access you have yourself",
            Self::StandardRole => "standard roles can be edited or reset, not removed",
            Self::InUse => {
                "people still have this role or are invited with it; move them to another role first"
            }
            Self::OwnerTemplate => "start from another role; only the owner role has full access",
        }
    }
}

impl fmt::Display for RoleRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for RoleRefusal {}

/// Checks that a member with role `actor_role` may change role `target`'s access.
///
/// # Errors
/// [`RoleRefusal::OwnerRole`] for the owner role, [`RoleRefusal::OwnRole`] for their own.
pub fn check_edit(actor_role: &str, target: &RoleKey) -> Result<(), RoleRefusal> {
    if target.is_owner() {
        return Err(RoleRefusal::OwnerRole);
    }
    if actor_role == target.as_str() {
        return Err(RoleRefusal::OwnRole);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_letters_and_underscores() {
        assert!(RoleKey::parse("front_desk").is_ok());
        for bad in ["a", "Front", "nurse2", "nurse-1", ""] {
            assert_eq!(RoleKey::parse(bad), Err(RoleKeyError), "{bad}");
        }
        assert_eq!(
            RoleKey::from_name("  Senior   nurse!").unwrap().as_str(),
            "senior_nurse"
        );
        assert_eq!(
            RoleKey::from_name("Lab tech 2").unwrap().as_str(),
            "lab_tech"
        );
        assert_eq!(RoleKey::from_name("नर्स"), Err(RoleKeyError));
        let long = "x".repeat(60);
        assert_eq!(RoleKey::from_name(&long).unwrap().as_str().len(), 40);
    }

    #[test]
    fn grants_are_checked_and_sorted() {
        let grants =
            RoleGrants::parse([("patients.read", "assigned"), ("billing.read", "all")]).unwrap();
        assert_eq!(
            grants
                .as_slice()
                .iter()
                .map(|g| g.permission.key())
                .collect::<Vec<_>>(),
            ["billing.read", "patients.read"]
        );
        assert_eq!(
            RoleGrants::parse([("root.all", "all")]),
            Err(GrantError::UnknownPermission("root.all".into()))
        );
        assert_eq!(
            RoleGrants::parse([("patients.read", "most")]),
            Err(GrantError::UnknownScope)
        );
        assert_eq!(
            RoleGrants::parse([("finance.view", "own")]),
            Err(GrantError::ScopeNotAllowed(Permission::FinanceView, "own"))
        );
        assert_eq!(
            RoleGrants::parse([("billing.read", "all"), ("billing.read", "all")]),
            Err(GrantError::Duplicate(Permission::BillingRead))
        );
    }

    #[test]
    fn nobody_grants_what_they_lack() {
        let actor = PermissionSet::EMPTY
            .with(Permission::PatientsRead, Scope::All)
            .with(Permission::ClinicalRead, Scope::Assigned);
        let grants = RoleGrants::parse([
            ("patients.read", "own"),
            ("clinical.read", "assigned"),
            ("clinical.write", "assigned"),
            ("finance.view", "all"),
        ])
        .unwrap();
        let unheld: Vec<_> = grants
            .unheld_by(actor)
            .iter()
            .map(|g| g.permission)
            .collect();
        assert_eq!(unheld, [Permission::ClinicalWrite, Permission::FinanceView]);
        let wider = RoleGrants::parse([("clinical.read", "all")]).unwrap();
        assert_eq!(wider.unheld_by(actor).len(), 1);
    }

    #[test]
    fn the_owner_role_and_your_own_stay_put() {
        let owner = RoleKey::parse(OWNER_ROLE).unwrap();
        let desk = RoleKey::parse("front_desk").unwrap();
        assert_eq!(check_edit(OWNER_ROLE, &owner), Err(RoleRefusal::OwnerRole));
        assert_eq!(check_edit("manager", &owner), Err(RoleRefusal::OwnerRole));
        assert_eq!(check_edit("front_desk", &desk), Err(RoleRefusal::OwnRole));
        assert_eq!(check_edit(OWNER_ROLE, &desk), Ok(()));
    }
}
