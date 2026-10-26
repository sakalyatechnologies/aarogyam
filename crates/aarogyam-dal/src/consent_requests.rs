//! "Send consent to sign": a request to a patient to agree to the clinic's notice from their
//! own phone. Only the SHA-256 of the link's token is stored.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A new request.
#[derive(Debug, Clone)]
pub struct NewRequest<'a> {
    /// Identifier chosen by the API.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// SHA-256 (hex) of the link's token.
    pub token_hash: &'a str,
    /// The purposes asked about.
    pub purposes: &'a [String],
    /// The published notice the patient will read, if there is one.
    pub notice_id: Option<Uuid>,
    /// The notice's label.
    pub notice_version: &'a str,
    /// The staff membership asking.
    pub requested_by: Uuid,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
}

/// Saves a request.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, new: &NewRequest<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.consent_requests
             (id, patient_id, token_hash, purposes, notice_id, notice_version, requested_by, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        new.id,
        new.patient_id,
        new.token_hash,
        new.purposes,
        new.notice_id,
        new.notice_version,
        new.requested_by,
        new.expires_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A request as the public page and the signing step read it.
#[derive(Debug, Clone)]
pub struct RequestRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The purposes asked about.
    pub purposes: Vec<String>,
    /// The notice the patient reads.
    pub notice_id: Option<Uuid>,
    /// Its label.
    pub notice_version: String,
    /// The notice's text, when the clinic has published it.
    pub notice_body: Option<String>,
    /// The staff membership that asked.
    pub requested_by: Uuid,
    /// When the link stops working.
    pub expires_at: OffsetDateTime,
    /// When the patient signed.
    pub signed_at: Option<OffsetDateTime>,
}

/// The request with this token hash.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn by_token(
    conn: &mut PgConnection,
    token_hash: &str,
) -> Result<Option<RequestRow>, DbError> {
    let row = sqlx::query_as!(
        RequestRow,
        r#"select r.id, r.patient_id, r.purposes, r.notice_id, r.notice_version,
                  (select n.body from aarogyam.consent_notices n
                   where n.org_id = r.org_id and n.id = r.notice_id) as notice_body,
                  r.requested_by, r.expires_at, r.signed_at
           from aarogyam.consent_requests r
           where r.token_hash = $1"#,
        token_hash
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// [`by_token`], locked until the transaction ends so two signings can't both succeed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_by_token(
    conn: &mut PgConnection,
    token_hash: &str,
) -> Result<Option<RequestRow>, DbError> {
    let row = sqlx::query_as!(
        RequestRow,
        r#"select r.id, r.patient_id, r.purposes, r.notice_id, r.notice_version,
                  (select n.body from aarogyam.consent_notices n
                   where n.org_id = r.org_id and n.id = r.notice_id) as notice_body,
                  r.requested_by, r.expires_at, r.signed_at
           from aarogyam.consent_requests r
           where r.token_hash = $1
           for update of r"#,
        token_hash
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks the request signed now.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_signed(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.consent_requests set signed_at = now() where id = $1"#,
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}
