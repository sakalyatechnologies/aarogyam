//! Roles and access: the permission catalogue, one role in detail, and changing what a role
//! may do. Every route needs `roles.manage`, which only the owner role has by default.

use aarogyam_app::roles::{self as app, ChangeRow, GrantRow, NewCustomRole, RoleDetailRow};
use aarogyam_domain::event::Event;
use aarogyam_domain::permission::require::RolesManage;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use super::staff::RolePermission;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

impl From<GrantRow> for RolePermission {
    fn from(row: GrantRow) -> Self {
        Self {
            key: row.key,
            scope: row.scope,
        }
    }
}

fn grants(rows: Vec<GrantRow>) -> Vec<RolePermission> {
    rows.into_iter().map(RolePermission::from).collect()
}

/// A permission in the catalogue.
#[derive(Debug, Serialize, ToSchema)]
pub struct CataloguePermission {
    /// Key, such as `billing.read`.
    pub key: String,
    /// Module, such as `billing`.
    pub module: String,
    /// What it allows, in plain words, such as "See bills and payments".
    pub description: String,
    /// The scopes it can be narrowed to: always `all`, sometimes `own` and `assigned`.
    pub scopes: Vec<String>,
}

/// A standard role and the permissions it starts with.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoleTemplate {
    /// Key, such as `front_desk`.
    pub key: String,
    /// Name, such as `Front desk`.
    pub name: String,
    /// What it is for.
    pub description: String,
    /// Its default permissions, sorted by key.
    pub permissions: Vec<RolePermission>,
}

/// Every permission and the standard roles' defaults.
#[derive(Debug, Serialize, ToSchema)]
pub struct AccessCatalogue {
    /// Every permission, by module, then key.
    pub permissions: Vec<CataloguePermission>,
    /// The standard roles, by name: presets for the roles editor.
    pub templates: Vec<RoleTemplate>,
}

/// The permission catalogue, with plain-language descriptions and the scopes each permission
/// can take, and the standard roles' defaults.
#[utoipa::path(
    get,
    path = "/api/v1/permissions",
    operation_id = "getAccessCatalogue",
    tag = "staff",
    security(("bearer" = [])),
    responses(
        (status = 200, body = AccessCatalogue),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks roles.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn catalogue(
    State(state): State<AppState>,
    Require { request, .. }: Require<RolesManage>,
) -> Result<Json<AccessCatalogue>, ApiFailure> {
    let catalogue = app::catalogue(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(AccessCatalogue {
        permissions: catalogue
            .permissions
            .into_iter()
            .map(|row| CataloguePermission {
                key: row.key,
                module: row.module,
                description: row.description,
                scopes: row.scopes,
            })
            .collect(),
        templates: catalogue
            .templates
            .into_iter()
            .map(|row| RoleTemplate {
                key: row.key,
                name: row.name,
                description: row.description,
                permissions: grants(row.permissions),
            })
            .collect(),
    }))
}

/// A change to a role's access.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoleChange {
    /// The change.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `created`, `permissions_changed` or `deleted`.
    pub action: String,
    /// When (RFC 3339).
    pub at: String,
    /// The user who made it.
    #[schema(value_type = String)]
    pub changed_by: Uuid,
    /// Their name.
    pub changed_by_name: Option<String>,
    /// The permissions before.
    pub before: Vec<RolePermission>,
    /// The permissions after.
    pub after: Vec<RolePermission>,
}

impl From<ChangeRow> for RoleChange {
    fn from(row: ChangeRow) -> Self {
        Self {
            id: row.id,
            action: row.action,
            at: rfc3339(row.at),
            changed_by: row.changed_by,
            changed_by_name: row.changed_by_name,
            before: grants(row.before),
            after: grants(row.after),
        }
    }
}

/// A role in detail.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoleDetail {
    /// The role.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Key, such as `doctor`.
    pub key: String,
    /// Name, such as `Doctor`.
    pub name: String,
    /// What it is for.
    pub description: Option<String>,
    /// Whether it is one of the standard roles.
    pub is_template: bool,
    /// The standard role its defaults come from; its own key for a standard role.
    pub template_key: Option<String>,
    /// Whether it can be changed: every role but the owner.
    pub editable: bool,
    /// What it may do, sorted by key.
    pub permissions: Vec<RolePermission>,
    /// What "reset to default" restores; empty without a template.
    pub default_permissions: Vec<RolePermission>,
    /// Members who have it (invited, active or suspended).
    pub member_count: i64,
    /// The latest changes, newest first (at most 10).
    pub history: Vec<RoleChange>,
}

impl From<RoleDetailRow> for RoleDetail {
    fn from(row: RoleDetailRow) -> Self {
        Self {
            id: row.id,
            editable: row.key != aarogyam_domain::staff::OWNER_ROLE,
            key: row.key,
            name: row.name,
            description: row.description,
            is_template: row.is_template,
            template_key: row.template_key,
            permissions: grants(row.permissions),
            default_permissions: grants(row.defaults),
            member_count: row.members,
            history: row.history.into_iter().map(RoleChange::from).collect(),
        }
    }
}

/// One role: what it may do, its defaults, how many people have it and who changed it last.
#[utoipa::path(
    get,
    path = "/api/v1/roles/{key}",
    operation_id = "getRole",
    tag = "staff",
    params(("key" = String, Path, description = "The role's key, such as `front_desk`")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = RoleDetail),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks roles.manage"),
        (status = 404, description = "No such role in this clinic")
    )
)]
pub(crate) async fn role(
    State(state): State<AppState>,
    Require { request, .. }: Require<RolesManage>,
    ApiPath(key): ApiPath<String>,
) -> Result<Json<RoleDetail>, ApiFailure> {
    let row = app::role(state.db(), &request.actor, request.request_id, &key).await?;
    Ok(Json(row.into()))
}

/// A role's complete new permission list. Anything left out is taken away.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RolePermissionsUpdate {
    /// Every permission the role will have, each once.
    pub permissions: Vec<RolePermissionInput>,
}

/// A permission to grant.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RolePermissionInput {
    /// Permission key, such as `billing.read`.
    pub key: String,
    /// `all`, `own` or `assigned`; only scopes the catalogue lists for the permission.
    /// Default `all`.
    pub scope: Option<String>,
}

/// A role after its permissions were set.
#[derive(Debug, Serialize, ToSchema)]
pub struct SavedRole {
    /// The role.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Key.
    pub key: String,
    /// Name.
    pub name: String,
    /// What it is for.
    pub description: Option<String>,
    /// Whether it is one of the standard roles.
    pub is_template: bool,
    /// What it may do now, sorted by key.
    pub permissions: Vec<RolePermission>,
    /// Whether anything changed; an unchanged list records nothing.
    pub changed: bool,
}

/// Sets what a role may do, replacing its permission list. Takes effect on the next request
/// of everyone with the role, and is recorded with who changed it and the list before and
/// after. The owner role can't be changed, nobody changes their own role, and nobody grants
/// a permission (or a wider scope) they don't hold.
#[utoipa::path(
    put,
    path = "/api/v1/roles/{key}/permissions",
    operation_id = "setRolePermissions",
    tag = "staff",
    params(("key" = String, Path, description = "The role's key, such as `front_desk`")),
    request_body = RolePermissionsUpdate,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SavedRole),
        (status = 400, description = "Unknown permission or scope, or a permission listed twice"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks roles.manage, the owner role, or a permission the caller doesn't hold"),
        (status = 404, description = "No such role in this clinic"),
        (status = 409, description = "The caller's own role")
    )
)]
pub(crate) async fn set_permissions(
    State(state): State<AppState>,
    Require { request, .. }: Require<RolesManage>,
    ApiPath(key): ApiPath<String>,
    ApiJson(body): ApiJson<RolePermissionsUpdate>,
) -> Result<Json<SavedRole>, ApiFailure> {
    let permissions: Vec<(String, String)> = body
        .permissions
        .into_iter()
        .map(|item| (item.key, item.scope.unwrap_or_else(|| "all".to_owned())))
        .collect();
    let saved = app::set_permissions(
        state.db(),
        &request.actor,
        request.request_id,
        &key,
        &permissions,
    )
    .await?;
    if saved.changed {
        state.forget_role(request.actor.clinic_id, saved.key.as_str());
        tracing::info!(
            event = Event::RoleChanged.as_str(),
            role_id = %saved.id.uuid(),
            role_key = %saved.key,
            permissions = saved.grants.as_slice().len(),
            "role permissions changed"
        );
    }
    Ok(Json(SavedRole {
        id: saved.id.uuid(),
        key: saved.key.as_str().to_owned(),
        name: saved.name,
        description: saved.description,
        is_template: saved.is_template,
        permissions: saved
            .grants
            .as_slice()
            .iter()
            .map(|grant| RolePermission {
                key: grant.permission.key().to_owned(),
                scope: grant.scope.key().to_owned(),
            })
            .collect(),
        changed: saved.changed,
    }))
}

/// A custom role to create.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewRole {
    /// Its name, such as `Senior nurse`.
    pub name: String,
    /// Its key, 2 to 40 lower-case letters and underscores; made from the name when left out.
    pub key: Option<String>,
    /// What it is for.
    pub description: Option<String>,
    /// The standard role it starts as a copy of, such as `assistant` (not `owner`).
    pub template_key: String,
}

/// Creates a custom role as a copy of a standard role's defaults, then edit it with
/// `PUT /api/v1/roles/{key}/permissions`.
#[utoipa::path(
    post,
    path = "/api/v1/roles",
    operation_id = "createRole",
    tag = "staff",
    request_body = NewRole,
    security(("bearer" = [])),
    responses(
        (status = 201, body = RoleDetail),
        (status = 400, description = "Bad name or key, or an unknown or owner template"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks roles.manage, or the template grants something the caller doesn't hold"),
        (status = 404, description = "Not a clinic, or not a member of it"),
        (status = 409, description = "A role with that key exists")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<RolesManage>,
    ApiJson(body): ApiJson<NewRole>,
) -> Result<(StatusCode, Json<RoleDetail>), ApiFailure> {
    let row = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        NewCustomRole {
            name: body.name,
            key: body.key,
            description: body.description,
            template_key: body.template_key,
        },
    )
    .await?;
    tracing::info!(
        event = Event::RoleChanged.as_str(),
        role_id = %row.id,
        role_key = %row.key,
        "role created"
    );
    Ok((StatusCode::CREATED, Json(row.into())))
}

/// Removes a custom role nobody has or is invited with. Standard roles can be reset, not
/// removed.
#[utoipa::path(
    delete,
    path = "/api/v1/roles/{key}",
    operation_id = "deleteRole",
    tag = "staff",
    params(("key" = String, Path, description = "The role's key")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks roles.manage, or the owner role"),
        (status = 404, description = "No such role in this clinic"),
        (status = 409, description = "A standard role, or people still have it")
    )
)]
pub(crate) async fn delete(
    State(state): State<AppState>,
    Require { request, .. }: Require<RolesManage>,
    ApiPath(key): ApiPath<String>,
) -> Result<StatusCode, ApiFailure> {
    app::delete(state.db(), &request.actor, request.request_id, &key).await?;
    tracing::info!(
        event = Event::RoleChanged.as_str(),
        role_key = %key,
        "role removed"
    );
    Ok(StatusCode::NO_CONTENT)
}
