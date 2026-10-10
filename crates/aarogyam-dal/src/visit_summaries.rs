//! Links to a visit summary (migration 0628) and what the summary reads. The link lookup, PIN
//! counting and open count are shared with the other share links in [`crate::prescriptions`].

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A new link to a visit summary.
#[derive(Debug, Clone)]
pub struct NewVisitLink<'a> {
    /// Identifier.
    pub id: Uuid,
    /// SHA-256 of the token.
    pub token_hash: &'a str,
    /// SHA-256 of the token and PIN.
    pub pin_hash: &'a str,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// How it is handed over: `whatsapp`, `sms`, `qr` or `link`.
    pub channel: &'a str,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// Records a link to a visit summary.
///
/// # Errors
/// [`DbError`] on a database failure; a foreign-key failure when the visit isn't the patient's.
pub async fn insert(conn: &mut PgConnection, link: &NewVisitLink<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.share_links
             (id, token_hash, pin_hash, resource, patient_id, encounter_id, channel, expires_at)
           values ($1, $2, $3, 'visit', $4, $5, $6, $7)"#,
        link.id,
        link.token_hash,
        link.pin_hash,
        link.patient_id,
        link.encounter_id,
        link.channel,
        link.expires_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The day the patient's next open follow-up falls due on or after `from`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn next_follow_up(
    conn: &mut PgConnection,
    patient_id: Uuid,
    from: Date,
) -> Result<Option<Date>, DbError> {
    let day = sqlx::query_scalar!(
        r#"select due_on from aarogyam.recalls
           where patient_id = $1 and status in ('due', 'notified') and due_on >= $2
           order by due_on limit 1"#,
        patient_id,
        from
    )
    .fetch_optional(conn)
    .await?;
    Ok(day)
}
