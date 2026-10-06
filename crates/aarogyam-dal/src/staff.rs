//! Staff queries: members, roles and invitations of the current clinic. Every function takes
//! the connection of an open clinic transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A member of the clinic's staff.
#[derive(Debug, Clone)]
pub struct MemberRow {
    /// The membership.
    pub id: Uuid,
    /// The person.
    pub user_id: Uuid,
    /// Their name.
    pub display_name: String,
    /// Role key, such as `front_desk`.
    pub role_key: String,
    /// Role name, such as `Front desk`.
    pub role_name: String,
    /// `invited`, `active`, `suspended` or `left`.
    pub status: String,
    /// When they joined.
    pub joined_at: Option<OffsetDateTime>,
    /// Branches they work at; empty means every branch.
    pub branch_ids: Vec<Uuid>,
    /// Those branches' names, in the same order.
    pub branch_names: Vec<String>,
}

/// Every member, active ones first, then by name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn members(conn: &mut PgConnection) -> Result<Vec<MemberRow>, DbError> {
    let rows = sqlx::query_as!(
        MemberRow,
        r#"select m.id, m.user_id, u.display_name, r.key as role_key, r.name as role_name, m.status,
                  m.joined_at,
                  coalesce(array_agg(b.id order by b.name) filter (where b.id is not null), '{}')
                    as "branch_ids!",
                  coalesce(array_agg(b.name order by b.name) filter (where b.id is not null), '{}')
                    as "branch_names!"
           from aarogyam.memberships m
           join aarogyam.users u on u.id = m.user_id
           join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
           left join aarogyam.membership_branches mb on mb.org_id = m.org_id and mb.membership_id = m.id
           left join aarogyam.branches b
             on b.org_id = mb.org_id and b.id = mb.branch_id and b.deleted_at is null
           group by m.id, m.user_id, u.display_name, r.key, r.name, m.status, m.joined_at
           order by m.status = 'active' desc, u.display_name, m.id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The member with membership `id`, if they belong to this clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn member(conn: &mut PgConnection, id: Uuid) -> Result<Option<MemberRow>, DbError> {
    let row = sqlx::query_as!(
        MemberRow,
        r#"select m.id, m.user_id, u.display_name, r.key as role_key, r.name as role_name, m.status,
                  m.joined_at,
                  coalesce(array_agg(b.id order by b.name) filter (where b.id is not null), '{}')
                    as "branch_ids!",
                  coalesce(array_agg(b.name order by b.name) filter (where b.id is not null), '{}')
                    as "branch_names!"
           from aarogyam.memberships m
           join aarogyam.users u on u.id = m.user_id
           join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
           left join aarogyam.membership_branches mb on mb.org_id = m.org_id and mb.membership_id = m.id
           left join aarogyam.branches b
             on b.org_id = mb.org_id and b.id = mb.branch_id and b.deleted_at is null
           where m.id = $1
           group by m.id, m.user_id, u.display_name, r.key, r.name, m.status, m.joined_at"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A membership's role and status, locked for a change.
#[derive(Debug, Clone)]
pub struct MembershipLock {
    /// The membership.
    pub id: Uuid,
    /// Role key.
    pub role_key: String,
    /// Status.
    pub status: String,
}

/// Locks every active owner's membership, in id order, and returns their ids. Taken before any
/// change that could demote an owner, so concurrent changes can't both see "another owner
/// remains" and leave none; the fixed order keeps them from deadlocking.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_active_owners(conn: &mut PgConnection) -> Result<Vec<Uuid>, DbError> {
    let ids = sqlx::query_scalar!(
        r#"select m.id
           from aarogyam.memberships m
           join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
           where r.key = 'owner' and m.status = 'active'
           order by m.id
           for update of m"#
    )
    .fetch_all(conn)
    .await?;
    Ok(ids)
}

/// Locks the membership `id` and returns its role and status.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_membership(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<MembershipLock>, DbError> {
    let row = sqlx::query_as!(
        MembershipLock,
        r#"select m.id, r.key as role_key, m.status
           from aarogyam.memberships m
           join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
           where m.id = $1
           for update of m"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Sets a membership's role (by key) and status. Returns `false` when the role doesn't exist
/// in this clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_membership(
    conn: &mut PgConnection,
    id: Uuid,
    role_key: &str,
    status: &str,
) -> Result<bool, DbError> {
    let updated = sqlx::query!(
        r#"update aarogyam.memberships m
           set role_id = r.id, status = $3,
               joined_at = case when $3 = 'active' then coalesce(m.joined_at, now()) else m.joined_at end
           from aarogyam.roles r
           where m.id = $1 and r.org_id = m.org_id and r.key = $2 and r.deleted_at is null"#,
        id,
        role_key,
        status
    )
    .execute(conn)
    .await?;
    Ok(updated.rows_affected() == 1)
}

/// A role and its permissions.
#[derive(Debug, Clone)]
pub struct RoleRow {
    /// The role.
    pub id: Uuid,
    /// Key, such as `doctor`.
    pub key: String,
    /// Name, such as `Doctor`.
    pub name: String,
    /// What it is for.
    pub description: Option<String>,
    /// Whether it came from the platform's templates.
    pub is_template: bool,
    /// Permission keys.
    pub permissions: Vec<String>,
    /// Each permission's scope, in the same order.
    pub scopes: Vec<String>,
    /// Members who have it (invited, active or suspended).
    pub members: i64,
}

/// The clinic's live roles with their permissions and member counts, templates first, then by
/// name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn roles(conn: &mut PgConnection) -> Result<Vec<RoleRow>, DbError> {
    let rows = sqlx::query_as!(
        RoleRow,
        r#"select r.id, r.key, r.name, r.description, r.is_template,
                  coalesce(array_agg(rp.permission order by rp.permission)
                             filter (where rp.permission is not null), '{}') as "permissions!",
                  coalesce(array_agg(rp.scope order by rp.permission)
                             filter (where rp.permission is not null), '{}') as "scopes!",
                  (select count(*) from aarogyam.memberships m
                   where m.org_id = r.org_id and m.role_id = r.id
                     and m.status in ('invited', 'active', 'suspended')) as "members!"
           from aarogyam.roles r
           left join aarogyam.role_permissions rp on rp.org_id = r.org_id and rp.role_id = r.id
           where r.deleted_at is null
           group by r.org_id, r.id, r.key, r.name, r.description, r.is_template
           order by r.is_template desc, r.name"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The role with `key` in this clinic: its id and name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn role_by_key(
    conn: &mut PgConnection,
    key: &str,
) -> Result<Option<(Uuid, String)>, DbError> {
    let row = sqlx::query!(
        r#"select id, name from aarogyam.roles where key = $1 and deleted_at is null"#,
        key
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.id, row.name)))
}

/// An invitation not yet accepted or expired.
#[derive(Debug, Clone)]
pub struct InvitationRow {
    /// The invitation.
    pub id: Uuid,
    /// Who was invited.
    pub email: Option<String>,
    /// Role key they will get.
    pub role_key: String,
    /// When it expires.
    pub expires_at: OffsetDateTime,
    /// When it was sent.
    pub created_at: OffsetDateTime,
}

/// Invitations neither accepted nor expired, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn pending_invitations(conn: &mut PgConnection) -> Result<Vec<InvitationRow>, DbError> {
    let rows = sqlx::query_as!(
        InvitationRow,
        r#"select i.id, i.email, r.key as role_key, i.expires_at, i.created_at
           from aarogyam.invitations i
           join aarogyam.roles r on r.org_id = i.org_id and r.id = i.role_id
           where i.accepted_at is null and i.expires_at > now()
           order by i.created_at desc"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A new invitation. Only the token's SHA-256 is stored.
#[derive(Debug, Clone)]
pub struct NewInvitation<'a> {
    /// Identifier chosen by the caller.
    pub id: Uuid,
    /// Who is invited (lower case).
    pub email: &'a str,
    /// The role they will get.
    pub role_id: Uuid,
    /// The member inviting them.
    pub invited_by: Uuid,
    /// SHA-256 of the link token, hex.
    pub token_hash: &'a str,
    /// When it expires.
    pub expires_at: OffsetDateTime,
}

/// Inserts an invitation into the current clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_invitation(
    conn: &mut PgConnection,
    invitation: &NewInvitation<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.invitations (id, email, role_id, invited_by, token_hash, expires_at)
           values ($1, $2, $3, $4, $5, $6)"#,
        invitation.id,
        invitation.email,
        invitation.role_id,
        invitation.invited_by,
        invitation.token_hash,
        invitation.expires_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The clinic's verified portal host, such as `sunrise.aarogyam.example`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn portal_host(conn: &mut PgConnection) -> Result<Option<String>, DbError> {
    let host = sqlx::query_scalar!(
        r#"select hostname from aarogyam.org_domains
           where kind = 'portal' and is_primary and verified_at is not null"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(host)
}
