//! A member's saved screen choices (migration 0745): one row per member, written by
//! `PUT /me/ui-prefs`.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// A member's saved row; `None` means the default.
#[derive(Debug, Clone, Default)]
pub struct UiPrefsRow {
    /// The Show patient style.
    pub present_style: Option<String>,
    /// The history view.
    pub history_view: Option<String>,
    /// The app language (`en`, `hi`, `mr`); `None` means the device default.
    pub language: Option<String>,
}

/// The member's row, if they have one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<Option<UiPrefsRow>, DbError> {
    Ok(sqlx::query_as!(
        UiPrefsRow,
        r#"select present_style, history_view, language
           from aarogyam.member_ui_prefs where membership_id = $1"#,
        membership_id,
    )
    .fetch_optional(conn)
    .await?)
}

/// Saves the fields that are sent and keeps the rest.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save(
    conn: &mut PgConnection,
    membership_id: Uuid,
    present_style: Option<&str>,
    history_view: Option<&str>,
    set_language: bool,
    language: Option<&str>,
) -> Result<UiPrefsRow, DbError> {
    Ok(sqlx::query_as!(
        UiPrefsRow,
        r#"insert into aarogyam.member_ui_prefs (membership_id, present_style, history_view, language)
           values ($1, $2, $3, $4)
           on conflict (org_id, membership_id) do update set
             present_style = coalesce(excluded.present_style, member_ui_prefs.present_style),
             history_view = coalesce(excluded.history_view, member_ui_prefs.history_view),
             language = case when $5 then excluded.language else member_ui_prefs.language end
           returning present_style, history_view, language"#,
        membership_id,
        present_style,
        history_view,
        language,
        set_language,
    )
    .fetch_one(conn)
    .await?)
}
