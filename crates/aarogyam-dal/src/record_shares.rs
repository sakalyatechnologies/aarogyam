//! Links to a patient's records (chart, X-rays, bills): creating and listing them, and the
//! X-rays and chart a link shows. The link lookup, PIN counting and open count are shared with
//! prescription links in [`crate::prescriptions`].

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A new link to records.
#[derive(Debug, Clone)]
pub struct NewRecordLink<'a> {
    /// Identifier.
    pub id: Uuid,
    /// SHA-256 of the token.
    pub token_hash: &'a str,
    /// SHA-256 of the token and PIN.
    pub pin_hash: &'a str,
    /// The patient.
    pub patient_id: Uuid,
    /// `chart`, `xrays`, `bills`.
    pub record_types: &'a [String],
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// Records a link to a patient's records.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, link: &NewRecordLink<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.share_links
             (id, token_hash, pin_hash, resource, patient_id, record_types, channel, expires_at)
           values ($1, $2, $3, 'records', $4, $5, 'whatsapp', $6)"#,
        link.id,
        link.token_hash,
        link.pin_hash,
        link.patient_id,
        link.record_types,
        link.expires_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A link to records as the clinic sees it: never its token or PIN.
#[derive(Debug, Clone)]
pub struct RecordLinkRow {
    /// Identifier.
    pub id: Uuid,
    /// What it shows.
    pub record_types: Vec<String>,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
    /// When the clinic revoked it.
    pub revoked_at: Option<OffsetDateTime>,
    /// When too many wrong PINs locked it.
    pub locked_at: Option<OffsetDateTime>,
    /// When it was first opened.
    pub opened_at: Option<OffsetDateTime>,
    /// How many times it was opened.
    pub open_count: i32,
    /// When it was made.
    pub created_at: OffsetDateTime,
}

/// A patient's links to records, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<RecordLinkRow>, DbError> {
    let rows = sqlx::query_as!(
        RecordLinkRow,
        r#"select id, record_types as "record_types!", expires_at, revoked_at, locked_at,
                  opened_at, open_count, created_at
           from aarogyam.share_links
           where patient_id = $1 and resource = 'records'
           order by created_at desc, id desc"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// An X-ray a link shows.
#[derive(Debug, Clone)]
pub struct XrayRow {
    /// The file.
    pub id: Uuid,
    /// Its label, such as `OPG`.
    pub label: Option<String>,
    /// A caption.
    pub caption: Option<String>,
    /// The tooth it shows.
    pub tooth: Option<i16>,
    /// When it was taken.
    pub taken_at: Option<OffsetDateTime>,
    /// When it was uploaded.
    pub created_at: OffsetDateTime,
    /// Media type.
    pub mime_type: String,
}

/// A patient's X-rays, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn xrays(conn: &mut PgConnection, patient_id: Uuid) -> Result<Vec<XrayRow>, DbError> {
    let rows = sqlx::query_as!(
        XrayRow,
        r#"select id, label, caption, tooth, taken_at, created_at, mime_type
           from aarogyam.attachments
           where patient_id = $1 and kind = 'xray' and deleted_at is null
           order by coalesce(taken_at, created_at) desc, id desc"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The media type of the patient's X-ray `id`, if it is one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn xray_mime(
    conn: &mut PgConnection,
    patient_id: Uuid,
    id: Uuid,
) -> Result<Option<String>, DbError> {
    let mime = sqlx::query_scalar!(
        r#"select mime_type from aarogyam.attachments
           where id = $1 and patient_id = $2 and kind = 'xray' and deleted_at is null"#,
        id,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(mime)
}
