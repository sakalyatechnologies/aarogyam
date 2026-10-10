//! The Today board's saved layouts: one for the clinic (no membership) and one per member. The
//! layout is stored as JSON text; the domain checks it before it is written and again when it is
//! read. Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// The saved layouts that apply to a member: the clinic's and the member's own.
#[derive(Debug, Clone, Default)]
pub struct Saved {
    /// The clinic's default, as JSON text.
    pub clinic: Option<String>,
    /// The member's own, as JSON text.
    pub member: Option<String>,
}

/// The clinic's layout, and the member's when `membership_id` is given.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn saved(conn: &mut PgConnection, membership_id: Option<Uuid>) -> Result<Saved, DbError> {
    let rows = sqlx::query!(
        r#"select membership_id, layout::text as "layout!"
           from aarogyam.dashboard_layouts
           where membership_id is null or membership_id = $1"#,
        membership_id
    )
    .fetch_all(conn)
    .await?;
    let mut found = Saved::default();
    for row in rows {
        if row.membership_id.is_some() {
            found.member = Some(row.layout);
        } else {
            found.clinic = Some(row.layout);
        }
    }
    Ok(found)
}

/// Saves the clinic's default, replacing the previous one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_clinic(conn: &mut PgConnection, layout: &str) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.dashboard_layouts (layout) values ($1::text::jsonb)
           on conflict (org_id) where membership_id is null
           do update set layout = excluded.layout"#,
        layout
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Saves a member's own layout, replacing the previous one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_member(
    conn: &mut PgConnection,
    membership_id: Uuid,
    layout: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.dashboard_layouts (membership_id, layout)
           values ($1, $2::text::jsonb)
           on conflict (org_id, membership_id) where membership_id is not null
           do update set layout = excluded.layout"#,
        membership_id,
        layout
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Removes the clinic's default (`membership_id` `None`) or a member's own layout.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clear(conn: &mut PgConnection, membership_id: Option<Uuid>) -> Result<(), DbError> {
    sqlx::query!(
        r#"delete from aarogyam.dashboard_layouts where membership_id is not distinct from $1"#,
        membership_id
    )
    .execute(conn)
    .await?;
    Ok(())
}
