//! Role editing: the permission catalogue and templates, one role in detail with its change
//! history, and the statements that change a role's access. Every function takes the
//! connection of an open clinic transaction. Each write records who changed what in
//! `role_changes`, in the same statement.

use sakalya_db::DbError;
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use sqlx::types::Json;
use time::OffsetDateTime;
use uuid::Uuid;

/// A permission at a scope, as stored and as the change history records it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrantRow {
    /// Permission key, such as `patients.read`.
    pub key: String,
    /// `all`, `own` or `assigned`.
    pub scope: String,
}

/// A permission in the catalogue.
#[derive(Debug, Clone, Deserialize)]
pub struct CatalogueRow {
    /// Key, such as `billing.read`.
    pub key: String,
    /// Module, such as `billing`.
    pub module: String,
    /// What it allows, in plain words.
    pub description: String,
    /// The scopes it can be narrowed to.
    pub scopes: Vec<String>,
}

/// A standard role's default permissions.
#[derive(Debug, Clone, Deserialize)]
pub struct TemplateRow {
    /// Key, such as `front_desk`.
    pub key: String,
    /// Name, such as `Front desk`.
    pub name: String,
    /// What it is for.
    pub description: String,
    /// Its permissions, sorted by key.
    pub permissions: Vec<GrantRow>,
}

/// The permission catalogue and the standard roles' defaults.
#[derive(Debug, Clone)]
pub struct Catalogue {
    /// Every permission, by module, then key.
    pub permissions: Vec<CatalogueRow>,
    /// Every template, by name.
    pub templates: Vec<TemplateRow>,
}

/// The catalogue, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn catalogue(conn: &mut PgConnection) -> Result<Catalogue, DbError> {
    let row = sqlx::query!(
        r#"select
             (select coalesce(jsonb_agg(jsonb_build_object(
                        'key', p.key, 'module', p.module, 'description', p.description,
                        'scopes', p.scopes) order by p.module, p.key collate "C"), '[]')
              from aarogyam.permissions p) as "permissions!: Json<Vec<CatalogueRow>>",
             (select coalesce(jsonb_agg(jsonb_build_object(
                        'key', t.key, 'name', t.name, 'description', t.description,
                        'permissions', coalesce((
                          select jsonb_agg(jsonb_build_object('key', tp.permission, 'scope', tp.scope)
                                           order by tp.permission collate "C")
                          from aarogyam.role_template_permissions tp
                          where tp.role_template_id = t.id), '[]')) order by t.name), '[]')
              from aarogyam.role_templates t) as "templates!: Json<Vec<TemplateRow>>""#
    )
    .fetch_one(conn)
    .await?;
    Ok(Catalogue {
        permissions: row.permissions.0,
        templates: row.templates.0,
    })
}

/// A change to a role's access.
#[derive(Debug, Clone, Deserialize)]
pub struct ChangeRow {
    /// The change.
    pub id: Uuid,
    /// `created`, `permissions_changed` or `deleted`.
    pub action: String,
    /// When.
    #[serde(with = "crate::json::timestamp")]
    pub at: OffsetDateTime,
    /// Who made it.
    pub changed_by: Uuid,
    /// Their name.
    pub changed_by_name: Option<String>,
    /// The permissions before.
    pub before: Vec<GrantRow>,
    /// The permissions after.
    pub after: Vec<GrantRow>,
}

/// One role in detail.
#[derive(Debug, Clone)]
pub struct RoleDetailRow {
    /// The role.
    pub id: Uuid,
    /// Key.
    pub key: String,
    /// Name.
    pub name: String,
    /// What it is for.
    pub description: Option<String>,
    /// Whether it is a standard role.
    pub is_template: bool,
    /// The template its defaults come from: its own key for a standard role.
    pub template_key: Option<String>,
    /// Its permissions, sorted by key.
    pub permissions: Vec<GrantRow>,
    /// The template's permissions, for "reset to default"; empty without a template.
    pub defaults: Vec<GrantRow>,
    /// Members who have it (invited, active or suspended).
    pub members: i64,
    /// The latest changes, newest first.
    pub history: Vec<ChangeRow>,
}

/// How many changes [`role`] returns.
pub const HISTORY_LIMIT: i64 = 10;

/// The role with `key`, its defaults, member count and latest changes, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn role(conn: &mut PgConnection, key: &str) -> Result<Option<RoleDetailRow>, DbError> {
    let row = sqlx::query!(
        r#"select r.id, r.key, r.name, r.description, r.is_template, t.key as "template_key?",
                  coalesce((select jsonb_agg(jsonb_build_object('key', rp.permission, 'scope', rp.scope)
                                             order by rp.permission collate "C")
                            from aarogyam.role_permissions rp
                            where rp.org_id = r.org_id and rp.role_id = r.id), '[]')
                    as "permissions!: Json<Vec<GrantRow>>",
                  coalesce((select jsonb_agg(jsonb_build_object('key', tp.permission, 'scope', tp.scope)
                                             order by tp.permission collate "C")
                            from aarogyam.role_template_permissions tp
                            where tp.role_template_id = t.id), '[]')
                    as "defaults!: Json<Vec<GrantRow>>",
                  (select count(*) from aarogyam.memberships m
                   where m.org_id = r.org_id and m.role_id = r.id
                     and m.status in ('invited', 'active', 'suspended')) as "members!",
                  coalesce((select jsonb_agg(h order by h.at desc)
                            from (select c.id, c.action, c.created_at as at, c.changed_by,
                                         u.display_name as changed_by_name, c.before, c.after
                                  from aarogyam.role_changes c
                                  left join aarogyam.users u on u.id = c.changed_by
                                  where c.org_id = r.org_id and c.role_id = r.id
                                  order by c.created_at desc, c.id desc
                                  limit $2) h), '[]')
                    as "history!: Json<Vec<ChangeRow>>"
           from aarogyam.roles r
           left join aarogyam.role_templates t
             on t.id = r.template_id or (r.template_id is null and r.is_template and t.key = r.key)
           where r.key = $1 and r.deleted_at is null"#,
        key,
        HISTORY_LIMIT
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| RoleDetailRow {
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        is_template: row.is_template,
        template_key: row.template_key,
        permissions: row.permissions.0,
        defaults: row.defaults.0,
        members: row.members,
        history: row.history.0,
    }))
}

/// A role's new permission list.
#[derive(Debug, Clone)]
pub struct SetPermissions<'a> {
    /// The role.
    pub key: &'a str,
    /// The permissions it will have, sorted by key, with their scopes in `scopes`.
    pub keys: &'a [String],
    /// Each permission's scope, in the same order.
    pub scopes: &'a [String],
    /// Grants the actor doesn't hold: allowed only if the role already has each at that scope
    /// or wider. Keys, with their scopes in `kept_scopes`.
    pub kept_keys: &'a [String],
    /// Scopes of `kept_keys`, in the same order.
    pub kept_scopes: &'a [String],
    /// The member's user making the change.
    pub changed_by: Uuid,
}

/// What [`set_permissions`] did.
#[derive(Debug, Clone)]
pub struct SetOutcome {
    /// The role.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// What it is for.
    pub description: Option<String>,
    /// Whether it is a standard role.
    pub is_template: bool,
    /// False when the change granted something the actor lacks; nothing was written.
    pub allowed: bool,
    /// Whether anything changed (and was recorded).
    pub changed: bool,
}

/// Replaces a live role's permissions and records the change, in one statement. `None` when
/// the role doesn't exist. The role row is locked, so two edits of one role queue up.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_permissions(
    conn: &mut PgConnection,
    change: &SetPermissions<'_>,
) -> Result<Option<SetOutcome>, DbError> {
    let row = sqlx::query!(
        r#"with target as (
             select r.org_id, r.id, r.name, r.description, r.is_template
             from aarogyam.roles r
             where r.key = $1 and r.deleted_at is null
             for update
           ),
           current as (
             select rp.permission, rp.scope
             from aarogyam.role_permissions rp join target t on rp.org_id = t.org_id and rp.role_id = t.id
           ),
           before as (
             select coalesce(jsonb_agg(jsonb_build_object('key', c.permission, 'scope', c.scope)
                                       order by c.permission collate "C"), '[]') as grants
             from current c
           ),
           wanted as (
             select w.permission, w.scope from unnest($2::text[], $3::text[]) as w(permission, scope)
           ),
           after as (
             select coalesce(jsonb_agg(jsonb_build_object('key', w.permission, 'scope', w.scope)
                                       order by w.permission collate "C"), '[]') as grants
             from wanted w
           ),
           check_held as (
             select not exists (
               select 1 from unnest($4::text[], $5::text[]) as k(permission, scope)
               where not exists (select 1 from current c
                                 where c.permission = k.permission
                                   and (c.scope = k.scope or c.scope = 'all'))
             ) as allowed
           ),
           go as (
             select t.org_id, t.id, (b.grants <> a.grants) as changed, b.grants as before, a.grants as after
             from target t, before b, after a, check_held h
             where h.allowed
           ),
           removed as (
             delete from aarogyam.role_permissions rp
             using go
             where go.changed and rp.org_id = go.org_id and rp.role_id = go.id
               and not exists (select 1 from wanted w where w.permission = rp.permission)
             returning 1
           ),
           upserted as (
             insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
             select go.org_id, go.id, w.permission, w.scope from go, wanted w
             where go.changed
             on conflict (org_id, role_id, permission) do update set scope = excluded.scope
               where aarogyam.role_permissions.scope is distinct from excluded.scope
             returning 1
           ),
           logged as (
             insert into aarogyam.role_changes (org_id, role_id, action, changed_by, before, after)
             select go.org_id, go.id, 'permissions_changed', $6, go.before, go.after
             from go where go.changed
             returning 1
           )
           select t.id, t.name, t.description, t.is_template,
                  (select h.allowed from check_held h) as "allowed!",
                  coalesce((select go.changed from go), false) as "changed!"
           from target t"#,
        change.key,
        change.keys,
        change.scopes,
        change.kept_keys,
        change.kept_scopes,
        change.changed_by
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| SetOutcome {
        id: row.id,
        name: row.name,
        description: row.description,
        is_template: row.is_template,
        allowed: row.allowed,
        changed: row.changed,
    }))
}

/// A template's permissions, sorted by key; `None` when there is no such template.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn template_grants(
    conn: &mut PgConnection,
    key: &str,
) -> Result<Option<Vec<GrantRow>>, DbError> {
    let row = sqlx::query!(
        r#"select coalesce((select jsonb_agg(jsonb_build_object('key', tp.permission, 'scope', tp.scope)
                                             order by tp.permission collate "C")
                            from aarogyam.role_template_permissions tp
                            where tp.role_template_id = t.id), '[]')
                    as "grants!: Json<Vec<GrantRow>>"
           from aarogyam.role_templates t where t.key = $1"#,
        key
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| row.grants.0))
}

/// A custom role to create from a template.
#[derive(Debug, Clone)]
pub struct NewRole<'a> {
    /// Identifier chosen by the caller.
    pub id: Uuid,
    /// Its key, unique among the clinic's live roles.
    pub key: &'a str,
    /// Its name.
    pub name: &'a str,
    /// What it is for.
    pub description: Option<&'a str>,
    /// The template whose permissions it starts with.
    pub template_key: &'a str,
    /// The member's user creating it.
    pub changed_by: Uuid,
}

/// Creates a custom role with its template's permissions and records it, in one statement.
/// Returns `false` when the template doesn't exist. A taken key fails on `roles_key`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn create_role(conn: &mut PgConnection, role: &NewRole<'_>) -> Result<bool, DbError> {
    let created = sqlx::query_scalar!(
        r#"with template as (
             select t.id from aarogyam.role_templates t where t.key = $5
           ),
           grants as (
             select tp.permission, tp.scope
             from aarogyam.role_template_permissions tp join template t on tp.role_template_id = t.id
           ),
           created as (
             insert into aarogyam.roles (id, key, name, description, is_template, template_id)
             select $1, $2, $3, $4, false, t.id from template t
             returning org_id, id
           ),
           granted as (
             insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
             select c.org_id, c.id, g.permission, g.scope from created c, grants g
             returning 1
           ),
           logged as (
             insert into aarogyam.role_changes (org_id, role_id, action, changed_by, after)
             select c.org_id, c.id, 'created', $6,
                    coalesce((select jsonb_agg(jsonb_build_object('key', g.permission, 'scope', g.scope)
                                               order by g.permission collate "C") from grants g), '[]')
             from created c
             returning 1
           )
           select (select count(*) from created) as "created!""#,
        role.id,
        role.key,
        role.name,
        role.description,
        role.template_key,
        role.changed_by
    )
    .fetch_one(conn)
    .await?;
    Ok(created == 1)
}

/// What [`delete_role`] found or did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteOutcome {
    /// No live role with that key.
    NotFound,
    /// A standard role; kept.
    Standard,
    /// People have it or are invited with it; kept.
    InUse,
    /// Removed, and the removal recorded.
    Deleted,
}

/// Removes a custom role nobody has or is invited with, and records it, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_role(
    conn: &mut PgConnection,
    key: &str,
    changed_by: Uuid,
) -> Result<DeleteOutcome, DbError> {
    let row = sqlx::query!(
        r#"with target as (
             select r.org_id, r.id, r.is_template,
                    exists (select 1 from aarogyam.memberships m
                            where m.org_id = r.org_id and m.role_id = r.id
                              and m.status in ('invited', 'active', 'suspended'))
                    or exists (select 1 from aarogyam.invitations i
                               where i.org_id = r.org_id and i.role_id = r.id
                                 and i.accepted_at is null and i.expires_at > now()) as in_use
             from aarogyam.roles r
             where r.key = $1 and r.deleted_at is null
             for update
           ),
           removed as (
             update aarogyam.roles r set deleted_at = now()
             from target t
             where r.org_id = t.org_id and r.id = t.id and not t.is_template and not t.in_use
             returning r.org_id, r.id
           ),
           logged as (
             insert into aarogyam.role_changes (org_id, role_id, action, changed_by, before)
             select d.org_id, d.id, 'deleted', $2,
                    coalesce((select jsonb_agg(jsonb_build_object('key', rp.permission, 'scope', rp.scope)
                                               order by rp.permission collate "C")
                              from aarogyam.role_permissions rp
                              where rp.org_id = d.org_id and rp.role_id = d.id), '[]')
             from removed d
             returning 1
           )
           select t.is_template, t.in_use as "in_use!",
                  (select count(*) from logged) as "deleted!"
           from target t"#,
        key,
        changed_by
    )
    .fetch_optional(conn)
    .await?;
    Ok(match row {
        None => DeleteOutcome::NotFound,
        Some(row) if row.deleted > 0 => DeleteOutcome::Deleted,
        Some(row) if row.is_template => DeleteOutcome::Standard,
        Some(_) => DeleteOutcome::InUse,
    })
}
