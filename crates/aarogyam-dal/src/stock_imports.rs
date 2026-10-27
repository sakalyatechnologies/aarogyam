//! Stock import previews: an uploaded list checked row by row and held until the clinic commits
//! it by its token. Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A preview to open.
#[derive(Debug, Clone)]
pub struct NewPreview<'a> {
    /// Identifier.
    pub id: Uuid,
    /// SHA-256 of the token, hex.
    pub token_hash: &'a str,
    /// The file's name as uploaded.
    pub file_name: &'a str,
    /// SHA-256 of the file's bytes, hex.
    pub file_sha256: &'a str,
    /// Size in bytes.
    pub size_bytes: i32,
    /// Data rows in the file.
    pub row_count: i32,
    /// Rows that passed.
    pub valid_rows: i32,
    /// Rows that failed.
    pub error_rows: i32,
    /// The rows that passed, as the commit applies them.
    pub rows: &'a Value,
    /// The failures, `[{row, field, message}]`.
    pub errors: &'a Value,
}

/// Opens a preview, ending the clinic's expired ones on the way (their rows are cleared).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn open(conn: &mut PgConnection, preview: &NewPreview<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"with expired as (
             update aarogyam.stock_import_previews set status = 'expired', rows = null
             where status = 'open' and expires_at < now()
             returning id
           )
           insert into aarogyam.stock_import_previews
             (id, token_hash, file_name, file_sha256, size_bytes, row_count, valid_rows,
              error_rows, rows, errors)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
        preview.id,
        preview.token_hash,
        preview.file_name,
        preview.file_sha256,
        preview.size_bytes,
        preview.row_count,
        preview.valid_rows,
        preview.error_rows,
        preview.rows,
        preview.errors
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A preview as stored.
#[derive(Debug, Clone)]
pub struct PreviewRow {
    /// Identifier.
    pub id: Uuid,
    /// `open`, `committed` or `expired`.
    pub status: String,
    /// The file's name.
    pub file_name: String,
    /// Data rows in the file.
    pub row_count: i32,
    /// Rows that passed.
    pub valid_rows: i32,
    /// Rows that failed.
    pub error_rows: i32,
    /// The rows that passed; `None` once it has ended.
    pub rows: Option<Value>,
    /// The failures.
    pub errors: Value,
    /// What the commit did; `None` until committed.
    pub result: Option<Value>,
    /// When it ends unless committed.
    pub expires_at: OffsetDateTime,
}

/// The preview with this token, locked so two commits queue up. An open preview past its time
/// is reported as `expired`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_by_token(
    conn: &mut PgConnection,
    token_hash: &str,
) -> Result<Option<PreviewRow>, DbError> {
    let row = sqlx::query_as!(
        PreviewRow,
        r#"select id,
                  case when status = 'open' and expires_at < now() then 'expired' else status end
                    as "status!",
                  file_name, row_count, valid_rows, error_rows, rows, errors, result, expires_at
           from aarogyam.stock_import_previews
           where token_hash = $1
           for update"#,
        token_hash
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks a preview committed, keeping its result and clearing its rows.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn commit(conn: &mut PgConnection, id: Uuid, result: &Value) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.stock_import_previews
           set status = 'committed', rows = null, result = $2, committed_at = now()
           where id = $1"#,
        id,
        result
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Whether a file with these exact bytes was committed before.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn already_committed(
    conn: &mut PgConnection,
    file_sha256: &str,
) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.stock_import_previews
                          where file_sha256 = $1 and status = 'committed') as "found!""#,
        file_sha256
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}
