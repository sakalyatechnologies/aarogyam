//! Lookups that run before the clinic is known.
//!
//! The API's login role can't read any table directly; these call the only database functions
//! it may execute outside a clinic transaction. Each function is `SECURITY DEFINER` and returns
//! just what the caller needs (see `db/migrations/0011_lookups.sql` and `0013_platform.sql`).

use aarogyam_domain::access::{Authorization, ClinicStatus, MembershipStatus, PlatformRole};
use aarogyam_domain::ids::{ClinicId, MembershipId, UserId};
use aarogyam_domain::permission::PermissionSet;
use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// The clinic a host name belongs to.
#[derive(Debug, Clone)]
pub struct HostClinic {
    /// The clinic.
    pub clinic_id: ClinicId,
    /// Its subdomain.
    pub slug: String,
    /// Its lifecycle state; `None` if the database holds a value this build doesn't know.
    pub status: Option<ClinicStatus>,
}

/// Resolves a verified host name (`sunrise.aarogyam.example`) to its clinic.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn resolve_host(pool: &PgPool, host: &str) -> Result<Option<HostClinic>, DbError> {
    let row = sqlx::query!(
        r#"select org_id as "org_id!", slug as "slug!", org_status as "org_status!"
           from app.resolve_host($1)"#,
        host
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| HostClinic {
        clinic_id: ClinicId::from_uuid(row.org_id),
        slug: row.slug,
        status: ClinicStatus::parse(&row.org_status),
    }))
}

/// What a Supabase token's subject may do in a clinic, in one round trip. `None` means the
/// person has no user record or no membership in this clinic. Remembers a session seen for
/// the first time, so it can be revoked later.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn authorize(
    pool: &PgPool,
    clinic_id: ClinicId,
    auth_uid: Uuid,
    session_id: Uuid,
    session_expires_at: OffsetDateTime,
) -> Result<Option<Authorization>, DbError> {
    let row = sqlx::query!(
        r#"select user_id as "user_id!", user_status as "user_status!",
                  membership_id as "membership_id!", membership_status as "membership_status!",
                  role_key as "role_key!", permissions as "permissions!", scopes as "scopes!",
                  session_revoked as "session_revoked!"
           from app.authorize($1, $2, $3, $4)"#,
        clinic_id.uuid(),
        auth_uid,
        session_id,
        session_expires_at
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| {
        let pairs = row
            .permissions
            .iter()
            .map(String::as_str)
            .zip(row.scopes.iter().map(String::as_str));
        let (permissions, unknown) = PermissionSet::from_keys(pairs);
        if !unknown.is_empty() {
            tracing::warn!(
                count = unknown.len(),
                "role has permission keys this build doesn't know"
            );
        }
        Authorization {
            user_id: UserId::from_uuid(row.user_id),
            user_active: row.user_status == "active",
            membership_id: MembershipId::from_uuid(row.membership_id),
            membership_status: MembershipStatus::parse(&row.membership_status),
            role_key: row.role_key,
            permissions,
            session_revoked: row.session_revoked,
        }
    }))
}

/// A clinic the person belongs to, for the clinic switcher.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MyClinic {
    /// The clinic.
    pub org_id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// The person's role key.
    pub role_key: String,
    /// The role's display name.
    pub role_name: String,
    /// The clinic portal's host name, when it has a verified one.
    pub host: Option<String>,
}

/// The clinics a person is invited to or active in, by name.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn my_clinics(pool: &PgPool, auth_uid: Uuid) -> Result<Vec<MyClinic>, DbError> {
    let rows = sqlx::query!(
        r#"select org_id as "org_id!", slug as "slug!", name as "name!", role_key as "role_key!",
                  role_name as "role_name!", portal_host
           from app.my_clinics($1)"#,
        auth_uid
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| MyClinic {
            org_id: row.org_id,
            slug: row.slug,
            name: row.name,
            role_key: row.role_key,
            role_name: row.role_name,
            host: row.portal_host,
        })
        .collect())
}

/// An active Sakalya staff member, as the console sees them.
#[derive(Debug, Clone)]
pub struct PlatformAccess {
    /// The user.
    pub user_id: UserId,
    /// Their name.
    pub display_name: String,
    /// Their console role; `None` if the database holds a value this build doesn't know.
    pub role: Option<PlatformRole>,
}

/// The console access of a token's subject, if they are active Sakalya staff.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn platform_access(
    pool: &PgPool,
    auth_uid: Uuid,
) -> Result<Option<PlatformAccess>, DbError> {
    let row = sqlx::query!(
        r#"select user_id as "user_id!", display_name as "display_name!", role as "role!"
           from app.platform_access($1)"#,
        auth_uid
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| PlatformAccess {
        user_id: UserId::from_uuid(row.user_id),
        display_name: row.display_name,
        role: PlatformRole::parse(&row.role),
    }))
}
