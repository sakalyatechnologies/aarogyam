//! The access record for documents: who opened which bill or prescription, including
//! patients opening a link, who have no user and are identified by the link.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// One entry in the access record.
#[derive(Debug, Clone, Copy)]
pub struct DocumentAccess<'a> {
    /// The member who opened it; none for a patient opening a link.
    pub actor_user_id: Option<Uuid>,
    /// `staff` or `patient`.
    pub actor_kind: &'a str,
    /// Whose record.
    pub patient_id: Uuid,
    /// The link it was opened through.
    pub share_link_id: Option<Uuid>,
    /// `prescription` or `invoice`.
    pub resource: &'a str,
    /// The document.
    pub resource_id: Uuid,
    /// `view`, `print` or `share`.
    pub action: &'a str,
    /// `care`, `front_desk`, `billing` or `patient_self`.
    pub purpose: &'a str,
    /// The request, for tracing.
    pub request_id: Option<&'a str>,
}

/// Appends to the access record in the current clinic transaction.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record(conn: &mut PgConnection, entry: &DocumentAccess<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into audit.access_log
             (actor_user_id, actor_kind, patient_id, share_link_id, resource, resource_id, action,
              purpose, request_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        entry.actor_user_id,
        entry.actor_kind,
        entry.patient_id,
        entry.share_link_id,
        entry.resource,
        entry.resource_id,
        entry.action,
        entry.purpose,
        entry.request_id
    )
    .execute(conn)
    .await?;
    Ok(())
}
