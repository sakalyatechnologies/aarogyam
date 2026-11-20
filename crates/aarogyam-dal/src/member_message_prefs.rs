//! A member's message ticks and hand-off count (migration 0742): one row per member, written on
//! Send, by `PUT /me/message-prefs` and on each hand-off to `WhatsApp`.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::Date;
use uuid::Uuid;

/// A member's saved row.
#[derive(Debug, Clone, Default)]
pub struct PrefsRow {
    /// The ticked sections; `None` until saved (every section).
    pub sections: Option<Vec<String>>,
    /// Summaries handed to `WhatsApp`.
    pub handoffs: i32,
    /// Clinic days with at least one hand-off.
    pub handoff_days: i32,
    /// The clinic day of the last hand-off.
    pub last_handoff_on: Option<Date>,
}

/// The member's row, if they have one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<Option<PrefsRow>, DbError> {
    Ok(sqlx::query_as!(
        PrefsRow,
        r#"select sections, handoffs, handoff_days, last_handoff_on
           from aarogyam.member_message_prefs where membership_id = $1"#,
        membership_id,
    )
    .fetch_optional(conn)
    .await?)
}

/// Saves the member's ticked sections.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save_sections(
    conn: &mut PgConnection,
    membership_id: Uuid,
    sections: &[String],
) -> Result<PrefsRow, DbError> {
    Ok(sqlx::query_as!(
        PrefsRow,
        r#"insert into aarogyam.member_message_prefs (membership_id, sections)
           values ($1, $2)
           on conflict (org_id, membership_id) do update set sections = excluded.sections
           returning sections, handoffs, handoff_days, last_handoff_on"#,
        membership_id,
        sections,
    )
    .fetch_one(conn)
    .await?)
}

/// Counts one hand-off on clinic day `today`: `handoff_days` goes up only on a new day.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn hand_off(
    conn: &mut PgConnection,
    membership_id: Uuid,
    today: Date,
    template_version: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.member_message_prefs
             (membership_id, handoffs, handoff_days, last_handoff_on, template_version)
           values ($1, 1, 1, $2, $3)
           on conflict (org_id, membership_id) do update set
             handoffs = member_message_prefs.handoffs + 1,
             handoff_days = member_message_prefs.handoff_days
               + case when member_message_prefs.last_handoff_on is distinct from excluded.last_handoff_on
                      then 1 else 0 end,
             last_handoff_on = excluded.last_handoff_on,
             template_version = coalesce(excluded.template_version,
                                         member_message_prefs.template_version)"#,
        membership_id,
        today,
        template_version,
    )
    .execute(conn)
    .await?;
    Ok(())
}
