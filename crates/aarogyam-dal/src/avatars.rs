//! A staff member's avatar, kept on their membership: a preset id or an uploaded photo.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// What a membership shows as its picture; both `None` when it has none.
#[derive(Debug, Clone, Default)]
pub struct AvatarRow {
    /// The preset id.
    pub preset: Option<String>,
    /// The stored photo.
    pub file_id: Option<Uuid>,
}

/// The membership's avatar, locked for a change.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(conn: &mut PgConnection, membership_id: Uuid) -> Result<AvatarRow, DbError> {
    let row = sqlx::query!(
        r#"select avatar_preset, avatar_file_id from aarogyam.memberships where id = $1 for update"#,
        membership_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map_or_else(AvatarRow::default, |row| AvatarRow {
        preset: row.avatar_preset,
        file_id: row.avatar_file_id,
    }))
}

/// Sets the avatar: a preset, a photo with its media type, or neither to clear it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set(
    conn: &mut PgConnection,
    membership_id: Uuid,
    preset: Option<&str>,
    photo: Option<(Uuid, &str)>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.memberships
           set avatar_preset = $2, avatar_file_id = $3, avatar_mime = $4
           where id = $1"#,
        membership_id,
        preset,
        photo.map(|(id, _)| id),
        photo.map(|(_, mime)| mime),
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The media type of the photo `file_id`, if a member of this clinic still shows it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn photo_mime(conn: &mut PgConnection, file_id: Uuid) -> Result<Option<String>, DbError> {
    let mime = sqlx::query_scalar!(
        r#"select avatar_mime from aarogyam.memberships where avatar_file_id = $1"#,
        file_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(mime.flatten())
}
