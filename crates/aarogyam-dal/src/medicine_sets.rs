//! A clinic's own medicine sets (migration 0626): several medicines added to a prescription in
//! one tap. Queries take the connection of an open clinic transaction. A deleted set is hidden
//! (`deleted_at`), never removed.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A medicine set as stored.
#[derive(Debug, Clone)]
pub struct SetRow {
    /// Identifier.
    pub id: Uuid,
    /// The chip's label.
    pub label: String,
    /// The medicines, a JSON array of lines.
    pub items: Value,
    /// When it was made.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// The clinic's sets, by label.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(conn: &mut PgConnection) -> Result<Vec<SetRow>, DbError> {
    let rows = sqlx::query_as!(
        SetRow,
        r#"select id, label, items, created_at, updated_at
           from aarogyam.medicine_sets where deleted_at is null
           order by lower(label), id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One set, locked until the transaction ends; none when it is deleted or isn't this clinic's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(conn: &mut PgConnection, id: Uuid) -> Result<Option<SetRow>, DbError> {
    let row = sqlx::query_as!(
        SetRow,
        r#"select id, label, items, created_at, updated_at
           from aarogyam.medicine_sets where id = $1 and deleted_at is null for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Adds a set.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when a live set has the label already.
pub async fn insert(
    conn: &mut PgConnection,
    id: Uuid,
    label: &str,
    items: &Value,
) -> Result<SetRow, DbError> {
    let row = sqlx::query_as!(
        SetRow,
        r#"insert into aarogyam.medicine_sets (id, label, items) values ($1, $2, $3)
           returning id, label, items, created_at, updated_at"#,
        id,
        label,
        items
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Replaces a live set's label and medicines.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when another live set has the label.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    label: &str,
    items: &Value,
) -> Result<SetRow, DbError> {
    let row = sqlx::query_as!(
        SetRow,
        r#"update aarogyam.medicine_sets set label = $2, items = $3
           where id = $1 and deleted_at is null
           returning id, label, items, created_at, updated_at"#,
        id,
        label,
        items
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Hides a set.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.medicine_sets set deleted_at = now() where id = $1 and deleted_at is null",
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}
