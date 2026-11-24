//! Tooth pins on an X-ray or photo (`aarogyam.image_pins`): one row per attachment and tooth,
//! moved in place. A placement aid, not a clinical record.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// A stored pin.
#[derive(Debug, Clone)]
pub struct PinRow {
    /// FDI tooth.
    pub tooth: i16,
    /// Across the image, 0 to 1.
    pub x: f32,
    /// Down the image, 0 to 1.
    pub y: f32,
    /// The doctor's short note, if any.
    pub label: Option<String>,
}

/// The attachment's pins, by tooth.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn of_attachment(
    conn: &mut PgConnection,
    attachment_id: Uuid,
) -> Result<Vec<PinRow>, DbError> {
    let rows = sqlx::query_as!(
        PinRow,
        r#"select tooth, x, y, label from aarogyam.image_pins
           where attachment_id = $1 order by tooth"#,
        attachment_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Serialises writes to one attachment's pins until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(conn: &mut PgConnection, attachment_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        r#"select pg_advisory_xact_lock(hashtextextended($1::text, 0)) as "locked!: bool""#,
        format!("pins:{attachment_id}")
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// Removes the attachment's pins for teeth not in `keep`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_except(
    conn: &mut PgConnection,
    attachment_id: Uuid,
    keep: &[i16],
) -> Result<(), DbError> {
    sqlx::query!(
        "delete from aarogyam.image_pins where attachment_id = $1 and tooth <> all($2::smallint[])",
        attachment_id,
        keep
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Places a pin, or moves the tooth's existing one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn upsert(
    conn: &mut PgConnection,
    id: Uuid,
    attachment_id: Uuid,
    patient_id: Uuid,
    pin: &PinRow,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.image_pins (id, attachment_id, patient_id, tooth, x, y, label)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (org_id, attachment_id, tooth)
           do update set x = excluded.x, y = excluded.y, label = excluded.label, updated_at = now()"#,
        id,
        attachment_id,
        patient_id,
        pin.tooth,
        pin.x,
        pin.y,
        pin.label
    )
    .execute(conn)
    .await?;
    Ok(())
}
