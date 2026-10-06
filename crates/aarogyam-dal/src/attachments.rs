//! Patient files' details. The bytes live in storage under `storage_key`.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A file's details as stored.
#[derive(Debug, Clone)]
pub struct AttachmentRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// `photo`, `xray`, `report`, `document`, `audio` or `consent`.
    pub kind: String,
    /// Media type, from the content.
    pub mime_type: String,
    /// Size.
    pub size_bytes: i64,
    /// SHA-256, hex.
    pub sha256: String,
    /// A caption.
    pub caption: Option<String>,
    /// The tooth it shows.
    pub tooth: Option<i16>,
    /// When it was taken.
    pub taken_at: Option<OffsetDateTime>,
    /// When it was uploaded.
    pub created_at: OffsetDateTime,
    /// The note a recording belongs to.
    pub note_id: Option<Uuid>,
    /// The addendum a recording belongs to, for a signed note.
    pub addendum_id: Option<Uuid>,
    /// A recording's length in seconds.
    pub duration_seconds: Option<i32>,
    /// A recording's spoken language tag.
    pub language: Option<String>,
}

/// Values for a new file.
#[derive(Debug, Clone)]
pub struct NewAttachment<'a> {
    /// Identifier chosen by the API.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// Kind value.
    pub kind: &'a str,
    /// `<clinic>/<id>`.
    pub storage_key: &'a str,
    /// Media type.
    pub mime_type: &'a str,
    /// Size.
    pub size_bytes: i64,
    /// SHA-256, hex.
    pub sha256: &'a str,
    /// A caption.
    pub caption: Option<&'a str>,
    /// The tooth it shows.
    pub tooth: Option<i16>,
    /// Source value.
    pub source: &'a str,
    /// The note a recording belongs to.
    pub note_id: Option<Uuid>,
    /// The addendum a recording belongs to.
    pub addendum_id: Option<Uuid>,
    /// A recording's length in seconds.
    pub duration_seconds: Option<i32>,
    /// A recording's spoken language tag.
    pub language: Option<&'a str>,
}

/// Inserts a file's details.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the visit belongs to another patient.
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewAttachment<'_>,
) -> Result<AttachmentRow, DbError> {
    let row = sqlx::query_as!(
        AttachmentRow,
        r#"insert into aarogyam.attachments
             (id, patient_id, encounter_id, kind, storage_key, mime_type, size_bytes, sha256, caption,
              tooth, source, note_id, addendum_id, duration_seconds, language)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           returning id, patient_id, encounter_id, kind, mime_type, size_bytes, sha256, caption, tooth,
                     taken_at, created_at, note_id, addendum_id, duration_seconds, language"#,
        new.id,
        new.patient_id,
        new.encounter_id,
        new.kind,
        new.storage_key,
        new.mime_type,
        new.size_bytes,
        new.sha256,
        new.caption,
        new.tooth,
        new.source,
        new.note_id,
        new.addendum_id,
        new.duration_seconds,
        new.language
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The file with `id` in this clinic, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<AttachmentRow>, DbError> {
    let row = sqlx::query_as!(
        AttachmentRow,
        r#"select id, patient_id, encounter_id, kind, mime_type, size_bytes, sha256, caption, tooth,
                  taken_at, created_at, note_id, addendum_id, duration_seconds, language
           from aarogyam.attachments
           where id = $1 and deleted_at is null and app.patient_in_reach(patient_id, $2)"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A patient's files, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<AttachmentRow>, DbError> {
    let rows = sqlx::query_as!(
        AttachmentRow,
        r#"select id, patient_id, encounter_id, kind, mime_type, size_bytes, sha256, caption, tooth,
                  taken_at, created_at, note_id, addendum_id, duration_seconds, language
           from aarogyam.attachments where patient_id = $1 and deleted_at is null
           order by created_at desc, id desc"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A visit's files, in order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn of_encounter(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<AttachmentRow>, DbError> {
    let rows = sqlx::query_as!(
        AttachmentRow,
        r#"select id, patient_id, encounter_id, kind, mime_type, size_bytes, sha256, caption, tooth,
                  taken_at, created_at, note_id, addendum_id, duration_seconds, language
           from aarogyam.attachments where encounter_id = $1 and deleted_at is null
           order by created_at, id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
