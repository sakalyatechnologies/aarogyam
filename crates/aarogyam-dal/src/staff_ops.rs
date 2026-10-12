//! The clinic's staff-operations settings (`org_settings.staff_ops`).

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;

/// The current clinic's staff-operations object, as stored; empty when it has no settings row.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection) -> Result<Value, DbError> {
    let value = sqlx::query_scalar!(
        r#"select staff_ops as "staff_ops!" from aarogyam.org_settings
           where org_id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(value.unwrap_or_else(|| Value::Object(serde_json::Map::new())))
}

/// The object, locked until the transaction ends so concurrent edits apply one after the other;
/// `None` when the clinic has no settings row.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn for_update(conn: &mut PgConnection) -> Result<Option<Value>, DbError> {
    let value = sqlx::query_scalar!(
        r#"select staff_ops as "staff_ops!" from aarogyam.org_settings
           where org_id = app.tenant_id() for update"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(value)
}

/// Saves the object. The change history records what changed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save(conn: &mut PgConnection, value: &Value) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.org_settings set staff_ops = $1 where org_id = app.tenant_id()",
        value
    )
    .execute(conn)
    .await?;
    Ok(())
}
