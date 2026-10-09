//! A patient's legal hold, which stops their erasure, inside the clinic's scoped transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A patient's hold as stored.
#[derive(Debug, Clone)]
pub struct HoldRow {
    /// Whether erasure is stopped.
    pub legal_hold: bool,
    /// Why.
    pub reason: Option<String>,
    /// Since when.
    pub since: Option<OffsetDateTime>,
}

/// Puts the patient on hold for `reason` (keeping the first time if already held), or releases
/// them with `None`. `None` back when the patient isn't in this clinic (or is erased).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set(
    conn: &mut PgConnection,
    patient_id: Uuid,
    reason: Option<&str>,
) -> Result<Option<HoldRow>, DbError> {
    let row = sqlx::query_as!(
        HoldRow,
        r#"update aarogyam.patients
           set legal_hold = $2::text is not null,
               legal_hold_reason = $2,
               legal_hold_at = case when $2::text is null then null
                                    else coalesce(legal_hold_at, now()) end
           where id = $1 and status <> 'erased' and deleted_at is null
           returning legal_hold, legal_hold_reason as reason, legal_hold_at as since"#,
        patient_id,
        reason
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}
