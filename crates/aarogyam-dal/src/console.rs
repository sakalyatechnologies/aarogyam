//! Queries behind Sakalya's console. The console sees counts and service health, never patient
//! records; each call is one `SECURITY DEFINER` function (`db/migrations/0013_platform.sql`).
//! The API checks the caller's platform role before calling these.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// A clinic as the console lists it.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ConsoleClinic {
    /// The clinic.
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// `dental` or `general`.
    pub specialty: String,
    /// `trial`, `active`, `suspended` or `churned`.
    pub status: String,
    /// When it was created.
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// The portal host name.
    pub portal_host: Option<String>,
    /// Members with an active membership.
    pub active_members: i64,
    /// Patients, excluding deleted records.
    pub patients: i64,
}

/// Every clinic, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinics(pool: &PgPool) -> Result<Vec<ConsoleClinic>, DbError> {
    let rows = sqlx::query_as!(
        ConsoleClinic,
        r#"select id as "id!", slug as "slug!", name as "name!", specialty as "specialty!", status as "status!",
                  created_at as "created_at!", portal_host, active_members as "active_members!",
                  patients as "patients!"
           from app.console_clinics()"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// What creating a clinic needs. Values are validated by the caller.
#[derive(Debug, Clone)]
pub struct NewClinic<'a> {
    /// Subdomain.
    pub slug: &'a str,
    /// Name.
    pub name: &'a str,
    /// Patient-number prefix.
    pub number_prefix: &'a str,
    /// Specialty.
    pub specialty: &'a str,
    /// Portal host name, `<slug>.<portal domain>`.
    pub portal_host: &'a str,
    /// The owner's email, invited as the clinic owner.
    pub owner_email: &'a str,
    /// SHA-256 (hex) of the invitation token; the token itself is never stored.
    pub invite_token_hash: &'a str,
    /// When the invitation expires.
    pub invite_expires_at: OffsetDateTime,
    /// The Sakalya staff member creating it.
    pub created_by: Uuid,
}

/// The clinic and owner invitation just created.
#[derive(Debug, Clone, Copy)]
pub struct CreatedClinic {
    /// The new clinic.
    pub org_id: Uuid,
    /// The owner's invitation.
    pub invitation_id: Uuid,
}

/// Creates a clinic with its portal host, branch, settings, template roles and an owner invitation.
///
/// # Errors
/// [`DbError`] on a database failure; a taken slug or host is a conflict.
pub async fn create_clinic(pool: &PgPool, new: &NewClinic<'_>) -> Result<CreatedClinic, DbError> {
    let row = sqlx::query!(
        r#"select org_id as "org_id!", invitation_id as "invitation_id!"
           from app.console_create_clinic($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        new.slug,
        new.name,
        new.number_prefix,
        new.specialty,
        new.portal_host,
        new.owner_email,
        new.invite_token_hash,
        new.invite_expires_at,
        new.created_by
    )
    .fetch_one(pool)
    .await?;
    Ok(CreatedClinic {
        org_id: row.org_id,
        invitation_id: row.invitation_id,
    })
}

/// Database health for the service dashboard, as JSON: connections, cache hit ratio, size,
/// the biggest tables and the slowest statements.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn db_health(pool: &PgPool) -> Result<serde_json::Value, DbError> {
    let value = sqlx::query_scalar!(r#"select app.db_health() as "health!""#)
        .fetch_one(pool)
        .await?;
    Ok(value)
}

/// One clinic as the console shows it: counts and hosts, never patient records.
#[derive(Debug, Clone)]
pub struct ClinicDetail {
    /// The clinic.
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// `dental` or `general`.
    pub specialty: String,
    /// `trial`, `active`, `suspended` or `churned`.
    pub status: String,
    /// Its time zone.
    pub timezone: String,
    /// When it was created.
    pub created_at: OffsetDateTime,
    /// Its host names, primary first.
    pub hosts: Vec<String>,
    /// Members with an active membership.
    pub active_members: i64,
    /// Patients, excluding deleted records.
    pub patients: i64,
    /// Invitations neither accepted nor expired.
    pub pending_invitations: i64,
}

/// A clinic, if it exists.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic(pool: &PgPool, org_id: Uuid) -> Result<Option<ClinicDetail>, DbError> {
    let row = sqlx::query_as!(
        ClinicDetail,
        r#"select id as "id!", slug as "slug!", name as "name!", specialty as "specialty!",
                  status as "status!", timezone as "timezone!", created_at as "created_at!",
                  hosts as "hosts!", active_members as "active_members!", patients as "patients!",
                  pending_invitations as "pending_invitations!"
           from app.console_clinic($1)"#,
        org_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// A clinic's member as the console lists them.
#[derive(Debug, Clone)]
pub struct ClinicMember {
    /// The membership.
    pub membership_id: Uuid,
    /// Their name.
    pub display_name: String,
    /// Their sign-in address.
    pub email: Option<String>,
    /// Role key, such as `doctor`.
    pub role_key: String,
    /// Role name.
    pub role_name: String,
    /// `invited`, `active`, `suspended` or `left`.
    pub status: String,
    /// When they joined.
    pub joined_at: Option<OffsetDateTime>,
}

/// A clinic's members.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_members(pool: &PgPool, org_id: Uuid) -> Result<Vec<ClinicMember>, DbError> {
    let rows = sqlx::query_as!(
        ClinicMember,
        r#"select membership_id as "membership_id!", display_name as "display_name!", email,
                  role_key as "role_key!", role_name as "role_name!", status as "status!", joined_at
           from app.console_clinic_members($1)"#,
        org_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// An invitation not yet accepted or expired.
#[derive(Debug, Clone)]
pub struct ClinicInvitation {
    /// The invitation.
    pub id: Uuid,
    /// Who was invited.
    pub email: Option<String>,
    /// Role key.
    pub role_key: String,
    /// Role name.
    pub role_name: String,
    /// When it expires.
    pub expires_at: OffsetDateTime,
    /// When it was sent.
    pub created_at: OffsetDateTime,
}

/// A clinic's open invitations.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_invitations(
    pool: &PgPool,
    org_id: Uuid,
) -> Result<Vec<ClinicInvitation>, DbError> {
    let rows = sqlx::query_as!(
        ClinicInvitation,
        r#"select id as "id!", email, role_key as "role_key!", role_name as "role_name!",
                  expires_at as "expires_at!", created_at as "created_at!"
           from app.console_clinic_invitations($1)"#,
        org_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Makes the person with `auth_uid` active Sakalya staff with `role`, creating their user
/// record if needed. Over the owner connection only (`aarogyam admin grant-platform`): the API
/// role can't write these tables.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn grant_platform(
    owner: &PgPool,
    auth_uid: Uuid,
    email: &str,
    display_name: &str,
    role: &str,
) -> Result<Uuid, DbError> {
    let user_id = sqlx::query_scalar!(
        r#"with person as (
             insert into aarogyam.users as u (auth_uid, email, display_name)
             values ($1, $2, $3)
             on conflict (auth_uid) do update set email = coalesce(u.email, excluded.email)
             returning u.id
           )
           insert into aarogyam.platform_users as p (user_id, role, active)
           select id, $4, true from person
           on conflict (user_id) do update set role = excluded.role, active = true
           returning p.user_id"#,
        auth_uid,
        email,
        display_name,
        role
    )
    .fetch_one(owner)
    .await?;
    Ok(user_id)
}
