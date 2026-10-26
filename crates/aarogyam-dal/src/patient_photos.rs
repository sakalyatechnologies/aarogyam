//! A patient's own photo: the row that points at the bytes in file storage.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// A stored photo's details (never its bytes).
#[derive(Debug, Clone)]
pub struct PhotoRow {
    /// Identifier, also the file's name in storage.
    pub id: Uuid,
    /// `image/png` or `image/jpeg`.
    pub mime_type: String,
}

/// The patient's photo, unless the patient is out of `member`'s reach (`None` reaches everyone).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(
    conn: &mut PgConnection,
    patient_id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<PhotoRow>, DbError> {
    let row = sqlx::query_as!(
        PhotoRow,
        r#"select id, mime_type from aarogyam.patient_photos
           where patient_id = $1 and app.patient_in_reach(patient_id, $2)"#,
        patient_id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Removes the patient's photo row and returns its id, so the caller can remove the bytes.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete(conn: &mut PgConnection, patient_id: Uuid) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        r#"delete from aarogyam.patient_photos where patient_id = $1 returning id"#,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// A new photo.
#[derive(Debug, Clone)]
pub struct NewPhoto<'a> {
    /// Identifier chosen by the API; also the file's name in storage.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// `image/png` or `image/jpeg`.
    pub mime_type: &'a str,
    /// Size in bytes.
    pub size_bytes: i64,
    /// SHA-256, hex.
    pub sha256: &'a str,
}

/// Saves the patient's photo; the old one must have been deleted first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, new: &NewPhoto<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.patient_photos (id, patient_id, mime_type, size_bytes, sha256)
           values ($1, $2, $3, $4, $5)"#,
        new.id,
        new.patient_id,
        new.mime_type,
        new.size_bytes,
        new.sha256
    )
    .execute(conn)
    .await?;
    Ok(())
}
