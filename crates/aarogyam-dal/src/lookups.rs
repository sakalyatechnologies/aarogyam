//! Lookups that run before the clinic is known.
//!
//! The API's login role can't read any table directly; these call the only database functions
//! it may execute outside a clinic transaction. Each function is `SECURITY DEFINER` and returns
//! just what the caller needs (see `db/migrations/0011_lookups.sql` and `0013_platform.sql`).

use aarogyam_domain::access::{
    Authorization, ClinicPlace, ClinicStatus, MembershipStatus, PlatformRole,
};
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
    /// Its IANA time zone.
    pub timezone: String,
    /// Its patient-number prefix.
    pub number_prefix: String,
}

impl HostClinic {
    /// The clinic, its time zone and number prefix, for the request.
    #[must_use]
    pub fn place(&self) -> ClinicPlace {
        ClinicPlace {
            id: self.clinic_id,
            timezone: self.timezone.clone(),
            number_prefix: self.number_prefix.clone(),
        }
    }
}

/// Resolves a verified host name (`sunrise.aarogyam.example`) to its clinic.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn resolve_host(pool: &PgPool, host: &str) -> Result<Option<HostClinic>, DbError> {
    let row = sqlx::query!(
        r#"select org_id as "org_id!", slug as "slug!", org_status as "org_status!",
                  timezone as "timezone!", number_prefix as "number_prefix!"
           from app.resolve_clinic_host($1)"#,
        host
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| HostClinic {
        clinic_id: ClinicId::from_uuid(row.org_id),
        slug: row.slug,
        status: ClinicStatus::parse(&row.org_status),
        timezone: row.timezone,
        number_prefix: row.number_prefix,
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
        authorization(Grant {
            user_id: row.user_id,
            user_status: row.user_status,
            membership_id: row.membership_id,
            membership_status: row.membership_status,
            role_key: row.role_key,
            permissions: row.permissions,
            scopes: row.scopes,
            session_revoked: row.session_revoked,
        })
    }))
}

/// What `app.authorize` returns, before it is read into an [`Authorization`].
struct Grant {
    user_id: Uuid,
    user_status: String,
    membership_id: Uuid,
    membership_status: String,
    role_key: String,
    permissions: Vec<String>,
    scopes: Vec<String>,
    session_revoked: bool,
}

fn authorization(grant: Grant) -> Authorization {
    let pairs = grant
        .permissions
        .iter()
        .map(String::as_str)
        .zip(grant.scopes.iter().map(String::as_str));
    let (permissions, unknown) = PermissionSet::from_keys(pairs);
    if !unknown.is_empty() {
        tracing::warn!(
            count = unknown.len(),
            "role has permission keys this build doesn't know"
        );
    }
    Authorization {
        user_id: UserId::from_uuid(grant.user_id),
        user_active: grant.user_status == "active",
        membership_id: MembershipId::from_uuid(grant.membership_id),
        membership_status: MembershipStatus::parse(&grant.membership_status),
        role_key: grant.role_key,
        permissions,
        session_revoked: grant.session_revoked,
    }
}

/// [`resolve_host`] and, when the clinic is open, [`authorize`], in one round trip: for a
/// request whose host and member are both not cached. `None` for an unknown host; the
/// authorization is `None` for a closed clinic (not asked) or a non-member.
///
/// # Errors
/// [`DbError`] when the database can't be reached.
pub async fn resolve_and_authorize(
    pool: &PgPool,
    host: &str,
    auth_uid: Uuid,
    session_id: Uuid,
    session_expires_at: OffsetDateTime,
) -> Result<Option<(HostClinic, Option<Authorization>)>, DbError> {
    let open = ClinicStatus::open_values();
    // `offset 0` keeps the lateral subquery from being merged into the join, so its filter,
    // which names no column of its own, is checked once before app.authorize runs: a closed
    // clinic never records the session ("One-Time Filter" in the plan).
    let row = sqlx::query!(
        r#"select h.org_id as "org_id!", h.slug as "slug!", h.org_status as "org_status!",
                  h.timezone as "timezone!", h.number_prefix as "number_prefix!",
                  a.user_id as "user_id?", a.user_status as "user_status?",
                  a.membership_id as "membership_id?", a.membership_status as "membership_status?",
                  a.role_key as "role_key?", a.permissions as "permissions?", a.scopes as "scopes?",
                  a.session_revoked as "session_revoked?"
           from app.resolve_clinic_host($1) h
           left join lateral (
             select * from app.authorize(h.org_id, $2, $3, $4) where h.org_status = any($5)
             offset 0
           ) a on true"#,
        host,
        auth_uid,
        session_id,
        session_expires_at,
        &open as &[&str]
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|row| {
        let clinic = HostClinic {
            clinic_id: ClinicId::from_uuid(row.org_id),
            slug: row.slug,
            status: ClinicStatus::parse(&row.org_status),
            timezone: row.timezone,
            number_prefix: row.number_prefix,
        };
        let grant = (|| {
            Some(Grant {
                user_id: row.user_id?,
                user_status: row.user_status?,
                membership_id: row.membership_id?,
                membership_status: row.membership_status?,
                role_key: row.role_key?,
                permissions: row.permissions?,
                scopes: row.scopes?,
                session_revoked: row.session_revoked?,
            })
        })();
        (clinic, grant.map(authorization))
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
