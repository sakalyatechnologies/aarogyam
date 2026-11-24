//! The tooth colour saved for a patient's Painted smile (`aarogyam.patient_smile_shades`): one
//! row per patient, replaced in place. A display preference, not a clinical record.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// The patient's saved colour, 0 (lightest) to 100 (deepest), if any.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, patient_id: Uuid) -> Result<Option<i16>, DbError> {
    let shade = sqlx::query_scalar!(
        "select shade from aarogyam.patient_smile_shades where patient_id = $1",
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(shade)
}

/// Saves the patient's colour, replacing an earlier one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn upsert(conn: &mut PgConnection, patient_id: Uuid, shade: i16) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.patient_smile_shades (patient_id, shade) values ($1, $2)
           on conflict (org_id, patient_id)
           do update set shade = excluded.shade, updated_at = now()"#,
        patient_id,
        shade
    )
    .execute(conn)
    .await?;
    Ok(())
}
