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
