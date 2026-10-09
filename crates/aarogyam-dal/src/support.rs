//! Support grants: a clinic's time-limited grant of read access to one Sakalya staff member.
//!
//! [`authorize`] and [`staff_grants`] run before any clinic is known, through definer
//! functions (`db/migrations/0341_support_access.sql`); the rest run in the clinic's scoped
//! transaction.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// What `app.support_authorize` found: an active grant for the person at the clinic.
#[derive(Debug, Clone)]
pub struct SupportAccessRow {
    /// The staff member's user.
    pub user_id: Uuid,
    /// The grant.
    pub grant_id: Uuid,
    /// Whether this sign-in session was revoked.
    pub session_revoked: bool,
}

/// What a request under a grant is: its method and route template, never a value.
#[derive(Debug, Clone, Copy)]
pub struct Action<'a> {
    /// `GET`, `POST` ...
    pub method: &'a str,
    /// The route template, such as `/api/v1/patients/{id}`.
    pub route: &'a str,
    /// The request ID.
    pub request_id: Option<&'a str>,
}

/// Support access for a token's subject at a clinic, in one round trip; records the session
/// and the action. `None`: not staff, or no active grant.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn authorize(
    pool: &PgPool,
    clinic_id: Uuid,
    auth_uid: Uuid,
    session: (Uuid, OffsetDateTime),
    action: Action<'_>,
) -> Result<Option<SupportAccessRow>, DbError> {
    let row = sqlx::query_as!(
        SupportAccessRow,
        r#"select user_id as "user_id!", grant_id as "grant_id!",
                  session_revoked as "session_revoked!"
           from app.support_authorize($1, $2, $3, $4, $5, $6, $7)"#,
        clinic_id,
        auth_uid,
        session.0,
        session.1,
        action.method,
        action.route,
        action.request_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// A grant a staff member holds, as the console lists it.
#[derive(Debug, Clone)]
pub struct StaffGrantRow {
    /// The grant.
    pub grant_id: Uuid,
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub clinic_name: String,
    /// Its verified portal host.
    pub portal_host: Option<String>,
    /// `read`.
    pub access: String,
    /// Why the clinic granted it.
    pub reason: String,
    /// When it started.
    pub starts_at: OffsetDateTime,
    /// When it ends.
    pub ends_at: OffsetDateTime,
    /// When the clinic revoked it.
    pub revoked_at: Option<OffsetDateTime>,
    /// Who granted it.
    pub granted_by_name: String,
}

/// The grants `user_id` (a staff member) holds at every clinic, newest end first, at most 100.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn staff_grants(pool: &PgPool, user_id: Uuid) -> Result<Vec<StaffGrantRow>, DbError> {
    let rows = sqlx::query_as!(
        StaffGrantRow,
        r#"select grant_id as "grant_id!", org_id as "org_id!", slug as "slug!",
                  clinic_name as "clinic_name!", portal_host, access as "access!",
                  reason as "reason!", starts_at as "starts_at!", ends_at as "ends_at!",
                  revoked_at, granted_by_name as "granted_by_name!"
           from app.my_support_grants($1)"#,
        user_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
