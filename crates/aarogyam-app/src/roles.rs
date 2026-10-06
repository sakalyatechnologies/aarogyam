//! Roles and access: what each role can see and do, as the owner sets it. Every function needs
//! `roles.manage` and runs in one clinic transaction. The owner role is never edited or
//! removed, nobody edits their own role, and nobody grants what they don't hold. Every change
//! is recorded with who made it and the permissions before and after.

use aarogyam_dal::roles::{self as dal, DeleteOutcome, NewRole, SetPermissions};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::RoleId;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::roles::{RoleGrants, RoleKey, RoleRefusal, check_edit};
use aarogyam_domain::staff::OWNER_ROLE;
use sakalya_db::Db;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::staff_scope;

pub use aarogyam_dal::roles::{Catalogue, ChangeRow, GrantRow, RoleDetailRow};

impl From<RoleRefusal> for AppError {
    fn from(refusal: RoleRefusal) -> Self {
        match refusal {
            RoleRefusal::OwnerRole | RoleRefusal::NotHeld => Self::Forbidden(refusal.message()),
            RoleRefusal::OwnRole | RoleRefusal::StandardRole | RoleRefusal::InUse => {
                Self::Conflict(refusal.message())
            }
            RoleRefusal::OwnerTemplate => Self::invalid("template_key", refusal),
        }
    }
}

/// A key from a path; one that can't be a role is no role.
fn role_key(text: &str) -> Result<RoleKey, AppError> {
    RoleKey::parse(text).map_err(|_| AppError::NotFound("role"))
}

/// Grants as the database and the change history store them.
fn grant_rows(grants: &RoleGrants) -> (Vec<String>, Vec<String>) {
    grants
        .as_slice()
        .iter()
        .map(|grant| {
            (
                grant.permission.key().to_owned(),
                grant.scope.key().to_owned(),
            )
        })
        .unzip()
}

/// Every permission with its plain-language description and scopes, and the standard roles'
/// defaults, for the roles editor.
///
/// # Errors
/// [`AppError::Denied`] without `roles.manage`; [`AppError::Db`] on database failures.
pub async fn catalogue(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Catalogue, AppError> {
    actor.require(Permission::RolesManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        Ok(dal::catalogue(tx.conn()).await?)
    })
    .await
}

/// One role: its permissions, its defaults, how many people have it, and its latest changes.
///
/// # Errors
/// [`AppError::Denied`] without `roles.manage`; [`AppError::NotFound`] when the clinic has no
/// such role; [`AppError::Db`] on database failures.
pub async fn role(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    key: &str,
) -> Result<RoleDetailRow, AppError> {
    actor.require(Permission::RolesManage)?;
    let key = role_key(key)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        dal::role(tx.conn(), key.as_str())
            .await?
            .ok_or(AppError::NotFound("role"))
    })
    .await
}

/// A role after its permissions were set.
#[derive(Debug, Clone)]
pub struct RoleSaved {
    /// The role.
    pub id: RoleId,
    /// Its key.
    pub key: RoleKey,
    /// Its name.
    pub name: String,
    /// What it is for.
    pub description: Option<String>,
    /// Whether it is a standard role.
    pub is_template: bool,
    /// What it may do now.
    pub grants: RoleGrants,
    /// Whether anything changed (and was recorded).
    pub changed: bool,
}

/// Replaces a role's permissions. Takes effect on the next request of everyone with the role
/// once the caller forgets their cached permissions.
///
/// # Errors
/// [`AppError::Denied`] without `roles.manage`; [`AppError::NotFound`] when the clinic has no
/// such role; [`AppError::Invalid`] for an unknown permission or scope; [`AppError::Forbidden`]
/// for the owner role or a grant the actor doesn't hold; [`AppError::Conflict`] for the
/// actor's own role; [`AppError::Db`] on database failures.
pub async fn set_permissions(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    key: &str,
    permissions: &[(String, String)],
) -> Result<RoleSaved, AppError> {
    actor.require(Permission::RolesManage)?;
    let key = role_key(key)?;
    check_edit(&actor.role_key, &key)?;
    let grants = RoleGrants::parse(
        permissions
            .iter()
            .map(|(key, scope)| (key.as_str(), scope.as_str())),
    )
    .map_err(|error| AppError::invalid("permissions", error))?;
    let (keys, scopes) = grant_rows(&grants);
    let (kept_keys, kept_scopes): (Vec<String>, Vec<String>) = grants
        .unheld_by(actor.permissions)
        .iter()
        .map(|grant| {
            (
                grant.permission.key().to_owned(),
                grant.scope.key().to_owned(),
            )
        })
        .unzip();
    let outcome = db
        .scoped(&staff_scope(actor, request_id), async |tx| {
            dal::set_permissions(
                tx.conn(),
                &SetPermissions {
                    key: key.as_str(),
                    keys: &keys,
                    scopes: &scopes,
                    kept_keys: &kept_keys,
                    kept_scopes: &kept_scopes,
                    changed_by: actor.user_id.uuid(),
                },
            )
            .await?
            .ok_or(AppError::NotFound("role"))
        })
        .await?;
    if !outcome.allowed {
        return Err(RoleRefusal::NotHeld.into());
    }
    Ok(RoleSaved {
        id: RoleId::from_uuid(outcome.id),
        key,
        name: outcome.name,
        description: outcome.description,
        is_template: outcome.is_template,
        grants,
        changed: outcome.changed,
    })
}

/// A custom role to create, as received.
#[derive(Debug, Clone)]
pub struct NewCustomRole {
    /// Its name, such as `Senior nurse`.
    pub name: String,
    /// Its key; made from the name when left out.
    pub key: Option<String>,
    /// What it is for.
    pub description: Option<String>,
    /// The standard role it starts as a copy of, such as `assistant`.
    pub template_key: String,
}

/// Creates a custom role as a copy of a standard role's defaults.
///
/// # Errors
/// [`AppError::Denied`] without `roles.manage`; [`AppError::Invalid`] for a bad name or key,
/// an unknown template or the owner template; [`AppError::Forbidden`] when the template grants
/// something the actor doesn't hold; [`AppError::Conflict`] when the key is taken;
/// [`AppError::Db`] on database failures.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewCustomRole,
) -> Result<RoleDetailRow, AppError> {
    actor.require(Permission::RolesManage)?;
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::invalid("name", "must be 1 to 80 characters"));
    }
    let key = match input.key.as_deref().map(str::trim) {
        Some(key) => RoleKey::parse(key).map_err(|error| AppError::invalid("key", error))?,
        None => RoleKey::from_name(name).map_err(|error| AppError::invalid("key", error))?,
    };
    let description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    if description.is_some_and(|text| text.chars().count() > 300) {
        return Err(AppError::invalid(
            "description",
            "must be at most 300 characters",
        ));
    }
    let template_key = input.template_key.trim();
    if template_key == OWNER_ROLE {
        return Err(RoleRefusal::OwnerTemplate.into());
    }
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let rows = dal::template_grants(tx.conn(), template_key)
            .await?
            .ok_or_else(|| AppError::invalid("template_key", "is not a standard role"))?;
        let grants = RoleGrants::parse(
            rows.iter()
                .map(|row| (row.key.as_str(), row.scope.as_str())),
        )
        .map_err(|_| AppError::Internal("a template grants an unknown permission"))?;
        if !grants.unheld_by(actor.permissions).is_empty() {
            return Err(RoleRefusal::NotHeld.into());
        }
        dal::create_role(
            tx.conn(),
            &NewRole {
                id: RoleId::new_v7().uuid(),
                key: key.as_str(),
                name,
                description,
                template_key,
                changed_by: actor.user_id.uuid(),
            },
        )
        .await
        .map_err(|error| {
            AppError::on_constraint(error, "roles_key", "a role with that key already exists")
        })?;
        dal::role(tx.conn(), key.as_str())
            .await?
            .ok_or(AppError::NotFound("role"))
    })
    .await
}

/// Removes a custom role that nobody has or is invited with.
///
/// # Errors
/// [`AppError::Denied`] without `roles.manage`; [`AppError::NotFound`] when the clinic has no
/// such role; [`AppError::Forbidden`] for the owner role; [`AppError::Conflict`] for a standard
/// role or one in use; [`AppError::Db`] on database failures.
pub async fn delete(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    key: &str,
) -> Result<(), AppError> {
    actor.require(Permission::RolesManage)?;
    let key = role_key(key)?;
    if key.is_owner() {
        return Err(RoleRefusal::OwnerRole.into());
    }
    let outcome = db
        .scoped(&staff_scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(
                dal::delete_role(tx.conn(), key.as_str(), actor.user_id.uuid()).await?,
            )
        })
        .await?;
    match outcome {
        DeleteOutcome::Deleted => Ok(()),
        DeleteOutcome::NotFound => Err(AppError::NotFound("role")),
        DeleteOutcome::Standard => Err(RoleRefusal::StandardRole.into()),
        DeleteOutcome::InUse => Err(RoleRefusal::InUse.into()),
    }
}
