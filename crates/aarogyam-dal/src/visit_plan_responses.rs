//! The patient's answer to their plan from the visit page (migration 0739): one row per link,
//! the latest choice wins, and one staff notification per visit, reopened when the choice
//! changes.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// An answer to save.
#[derive(Debug, Clone)]
pub struct NewAnswer<'a> {
    /// The visit.
    pub encounter_id: Uuid,
    /// Its patient.
    pub patient_id: Uuid,
    /// The link it came through.
    pub share_link_id: Uuid,
    /// `go_ahead` or `question`.
    pub choice: &'a str,
    /// What the page showed: `[{"source", "id"}]`.
    pub shown: &'a Value,
    /// When.
    pub responded_at: OffsetDateTime,
}

/// What saving an answer did.
#[derive(Debug, Clone)]
pub struct Saved {
    /// When it was saved.
    pub responded_at: OffsetDateTime,
    /// The link's choice before this one; `None` for the first answer.
    pub previous: Option<String>,
}

/// Saves the link's answer, replacing an earlier one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save(conn: &mut PgConnection, answer: &NewAnswer<'_>) -> Result<Saved, DbError> {
    let row = sqlx::query!(
        r#"with before as (
             select choice from aarogyam.visit_plan_responses where share_link_id = $3
           ), saved as (
             insert into aarogyam.visit_plan_responses
               (encounter_id, patient_id, share_link_id, choice, shown, responded_at)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (org_id, share_link_id) do update
               set choice = excluded.choice, shown = excluded.shown,
                   responded_at = excluded.responded_at
             returning responded_at
           )
           select saved.responded_at as "responded_at!",
                  (select choice from before) as "previous?"
           from saved"#,
        answer.encounter_id,
        answer.patient_id,
        answer.share_link_id,
        answer.choice,
        answer.shown,
        answer.responded_at,
    )
    .fetch_one(conn)
    .await?;
    Ok(Saved {
        responded_at: row.responded_at,
        previous: row.previous,
    })
}

/// Tells the clinic about the visit's answer: writes its `plan_response` notification, or
/// reopens it (not handled, unread for everyone) when there is one. Ids only; `href` opens the
/// patient.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn notify(
    conn: &mut PgConnection,
    encounter_id: Uuid,
    href: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"with saved as (
             insert into aarogyam.staff_notifications (kind, encounter_id, href, audience)
             values ('plan_response', $1, $2, 'front_desk')
             on conflict (org_id, encounter_id, kind) where encounter_id is not null do update
               set handled_at = null, handled_by = null
             returning org_id, id
           )
           delete from aarogyam.staff_notification_reads r
           using saved
           where r.org_id = saved.org_id and r.notification_id = saved.id"#,
        encounter_id,
        href,
    )
    .execute(conn)
    .await?;
    Ok(())
}
