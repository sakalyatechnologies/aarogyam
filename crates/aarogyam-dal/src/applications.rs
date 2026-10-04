//! Clinic applications from the public landing page, and the console's decisions on them.
//! The table has no grants; each call is one `SECURITY DEFINER` function
//! (`db/migrations/0050_clinic_applications.sql`). Callers validate values first.

use sakalya_db::DbError;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// An application as submitted, validated.
#[derive(Debug, Clone)]
pub struct NewApplication<'a> {
    /// The clinic's name.
    pub clinic_name: &'a str,
    /// Its city.
    pub city: &'a str,
    /// `dental` or `general`.
    pub specialty: &'a str,
    /// Who to contact.
    pub contact_name: &'a str,
    /// Their address, lower-cased.
    pub email: &'a str,
    /// Their phone, E.164.
    pub phone_e164: Option<&'a str>,
    /// Anything they added.
    pub message: Option<&'a str>,
}

/// Records an application; a second one from a pending address updates the first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn submit(pool: &PgPool, new: &NewApplication<'_>) -> Result<(), DbError> {
    sqlx::query!(
        "select app.submit_clinic_application($1, $2, $3, $4, $5, $6, $7)",
        new.clinic_name,
        new.city,
        new.specialty,
        new.contact_name,
        new.email,
        new.phone_e164,
        new.message
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// An application as the console lists it.
#[derive(Debug, Clone)]
pub struct ApplicationRow {
    /// The application.
    pub id: Uuid,
    /// The clinic's name.
    pub clinic_name: String,
    /// Its city.
    pub city: String,
    /// `dental` or `general`.
    pub specialty: String,
    /// Who to contact.
    pub contact_name: String,
    /// Their address.
    pub email: String,
    /// Their phone.
    pub phone_e164: Option<String>,
    /// Anything they added.
    pub message: Option<String>,
    /// `pending`, `approved` or `rejected`.
    pub status: String,
    /// Times the address applied while pending.
    pub submissions: i32,
    /// Why it was rejected.
    pub decision_reason: Option<String>,
    /// Who decided.
    pub decided_by_name: Option<String>,
    /// When.
    pub decided_at: Option<OffsetDateTime>,
    /// The clinic approval created.
    pub created_org_id: Option<Uuid>,
    /// When it first arrived.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// Applications with `status` (all when `None`), newest first, at most 500.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(pool: &PgPool, status: Option<&str>) -> Result<Vec<ApplicationRow>, DbError> {
    let rows = sqlx::query_as!(
        ApplicationRow,
        r#"select id as "id!", clinic_name as "clinic_name!", city as "city!",
                  specialty as "specialty!", contact_name as "contact_name!", email as "email!",
                  phone_e164, message, status as "status!", submissions as "submissions!",
                  decision_reason, decided_by_name, decided_at, created_org_id,
                  created_at as "created_at!", updated_at as "updated_at!"
           from app.console_clinic_applications($1)"#,
        status
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// What approving needs: the new clinic's values, the owner's invitation and its email.
#[derive(Debug, Clone)]
pub struct Approval<'a> {
    /// The application.
    pub id: Uuid,
    /// Subdomain.
    pub slug: &'a str,
    /// Patient-number prefix.
    pub number_prefix: &'a str,
    /// Portal host name.
    pub portal_host: &'a str,
    /// SHA-256 (hex) of the invitation token.
    pub invite_token_hash: &'a str,
    /// When the invitation expires.
    pub invite_expires_at: OffsetDateTime,
    /// The staff member approving.
    pub decided_by: Uuid,
    /// The outbox message id.
    pub message_id: Uuid,
    /// The message kind (`staff.invited`).
    pub message_event: &'a str,
    /// The template's values; the invitation id is added by the database.
    pub message_payload: &'a serde_json::Value,
    /// The invitation token, kept until the email is sent.
    pub message_secret: &'a str,
}

/// The outcome of an approval.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Approved {
    /// The clinic and the owner's invitation.
    Created {
        /// The new clinic.
        org_id: Uuid,
        /// The owner's invitation.
        invitation_id: Uuid,
    },
    /// Already decided, or no such application.
    NotPending,
}

/// Approves a pending application in one transaction: clinic, invitation, outbox email, decision.
///
/// # Errors
/// [`DbError`] on a database failure; a taken subdomain is a conflict.
pub async fn approve(pool: &PgPool, approval: &Approval<'_>) -> Result<Approved, DbError> {
    let row = sqlx::query!(
        r#"select org_id, invitation_id, outcome as "outcome!"
           from app.console_approve_application($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
        approval.id,
        approval.slug,
        approval.number_prefix,
        approval.portal_host,
        approval.invite_token_hash,
        approval.invite_expires_at,
        approval.decided_by,
        approval.message_id,
        approval.message_event,
        approval.message_payload,
        approval.message_secret
    )
    .fetch_one(pool)
    .await?;
    Ok(
        match (row.outcome.as_str(), row.org_id, row.invitation_id) {
            ("approved", Some(org_id), Some(invitation_id)) => Approved::Created {
                org_id,
                invitation_id,
            },
            _ => Approved::NotPending,
        },
    )
}

/// Rejects a pending application; `false` when it was already decided or doesn't exist.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn reject(
    pool: &PgPool,
    id: Uuid,
    reason: Option<&str>,
    decided_by: Uuid,
) -> Result<bool, DbError> {
    let rejected = sqlx::query_scalar!(
        r#"select app.console_reject_application($1, $2, $3) as "rejected!""#,
        id,
        reason,
        decided_by
    )
    .fetch_one(pool)
    .await?;
    Ok(rejected)
}
