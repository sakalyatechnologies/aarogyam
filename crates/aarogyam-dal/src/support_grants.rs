//! A clinic's support grants, inside its scoped transaction: who may read, why, until when,
//! and what they did.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A grant as the clinic sees it.
#[derive(Debug, Clone)]
pub struct GrantRow {
    /// Identifier.
    pub id: Uuid,
    /// The staff member's platform record.
    pub platform_user_id: Uuid,
    /// Their name.
    pub staff_name: Option<String>,
    /// Their email.
    pub staff_email: Option<String>,
    /// `read`.
    pub access: String,
    /// Why.
    pub reason: String,
    /// When it started.
    pub starts_at: OffsetDateTime,
    /// When it ends.
    pub ends_at: OffsetDateTime,
    /// The member who granted it.
    pub granted_by_name: Option<String>,
    /// When it was revoked.
    pub revoked_at: Option<OffsetDateTime>,
    /// The member who revoked it.
    pub revoked_by_name: Option<String>,
    /// Requests made under it.
    pub actions: i64,
    /// The latest of them.
    pub last_action_at: Option<OffsetDateTime>,
}

/// Active Sakalya staff (owner or support role) with this email: their platform record and name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn staff_by_email(
    conn: &mut PgConnection,
    email: &str,
) -> Result<Option<(Uuid, String)>, DbError> {
    let row = sqlx::query!(
        r#"select platform_user_id as "id!", display_name as "name!"
           from app.support_staff_by_email($1)"#,
        email
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.id, row.name)))
}

/// Whether the staff member already holds an active grant here.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn has_active(conn: &mut PgConnection, platform_user_id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.support_grants
                          where platform_user_id = $1 and revoked_at is null
                            and ends_at > now()) as "found!""#,
        platform_user_id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// Adds a grant starting now.
///
/// # Errors
/// [`DbError`] on a database failure (a check: ends too late or too soon).
pub async fn create(
    conn: &mut PgConnection,
    id: Uuid,
    platform_user_id: Uuid,
    reason: &str,
    ends_at: OffsetDateTime,
    granted_by: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.support_grants (id, platform_user_id, reason, ends_at, granted_by)
           values ($1, $2, $3, $4, $5)"#,
        id,
        platform_user_id,
        reason,
        ends_at,
        granted_by
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Revokes a grant that is still open. `Some(false)` when it had already ended or was revoked;
/// `None` when no such grant is in this clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn revoke(
    conn: &mut PgConnection,
    id: Uuid,
    revoked_by: Uuid,
) -> Result<Option<bool>, DbError> {
    let row = sqlx::query_scalar!(
        r#"with target as (select id, revoked_at is null and ends_at > now() as open
                           from aarogyam.support_grants where id = $1 for update),
                done as (update aarogyam.support_grants g
                         set revoked_at = now(), revoked_by = $2
                         from target t where g.id = t.id and t.open
                         returning g.id)
           select (select open from target) as "open?" from (select 1) one
           where exists (select 1 from target)"#,
        id,
        revoked_by
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|open| open.unwrap_or(false)))
}

/// The clinic's grants, newest first (at most 100), or the one with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(conn: &mut PgConnection, id: Option<Uuid>) -> Result<Vec<GrantRow>, DbError> {
    let rows = sqlx::query_as!(
        GrantRow,
        r#"select g.id, g.platform_user_id, s.display_name as "staff_name?", s.email as "staff_email?",
                  g.access, g.reason, g.starts_at, g.ends_at,
                  (select u.display_name from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
                   where m.org_id = g.org_id and m.id = g.granted_by) as granted_by_name,
                  g.revoked_at,
                  (select u.display_name from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
                   where m.org_id = g.org_id and m.id = g.revoked_by) as revoked_by_name,
                  a.actions as "actions!", a.last_action_at
           from aarogyam.support_grants g
           left join lateral app.support_staff_name(g.platform_user_id) s on true
           cross join lateral (select count(*) as actions, max(x.at) as last_action_at
                               from audit.support_actions x
                               where x.org_id = g.org_id and x.grant_id = g.id) a
           where $1::uuid is null or g.id = $1
           order by g.created_at desc, g.id desc
           limit 100"#,
        id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A request made under a grant.
#[derive(Debug, Clone)]
pub struct ActionRow {
    /// When.
    pub at: OffsetDateTime,
    /// `GET`, `POST` ...
    pub method: String,
    /// The route template.
    pub route: String,
}

/// The latest requests made under a grant (at most 200), or `None` when no such grant is in
/// this clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn actions(
    conn: &mut PgConnection,
    grant_id: Uuid,
) -> Result<Option<Vec<ActionRow>>, DbError> {
    let rows = sqlx::query!(
        r#"select g.id as "grant_id!", x.at as "at?", x.method as "method?", x.route as "route?"
           from aarogyam.support_grants g
           left join lateral (select a.at, a.method, a.route from audit.support_actions a
                              where a.org_id = g.org_id and a.grant_id = g.id
                              order by a.at desc limit 200) x on true
           where g.id = $1
           order by x.at desc nulls last"#,
        grant_id
    )
    .fetch_all(conn)
    .await?;
    if rows.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        rows.into_iter()
            .filter_map(|row| {
                Some(ActionRow {
                    at: row.at?,
                    method: row.method?,
                    route: row.route?,
                })
            })
            .collect(),
    ))
}
