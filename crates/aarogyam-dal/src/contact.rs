//! Whether a clinic may message a patient: the database's `app.may_contact` (migration 0333).

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// Whether clinic `org_id` may message patient `patient_id` for consent purpose `purpose`
/// (`care`, `reminders`, `promotional`, ...) right now. Works on the API's own connection (a
/// worker, outside a clinic transaction) and inside a clinic transaction for that clinic; a
/// patient of another clinic, deleted or merged, is never contactable.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn may_contact(
    conn: &mut PgConnection,
    org_id: Uuid,
    patient_id: Uuid,
    purpose: &str,
) -> Result<bool, DbError> {
    let allowed = sqlx::query_scalar!(
        r#"select app.may_contact($1, $2, $3) as "allowed!""#,
        org_id,
        patient_id,
        purpose
    )
    .fetch_one(conn)
    .await?;
    Ok(allowed)
}
