//! Other numbers patients are known by. Every function takes the connection of an open clinic
//! transaction, so row-level security limits it to that clinic.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// An identifier as stored.
#[derive(Debug, Clone)]
pub struct IdentifierRow {
    /// Identifier of the row.
    pub id: Uuid,
    /// `file_number`, `legacy`, `smart_card`, `abha_number` or `abha_address`.
    pub kind: String,
    /// The number.
    pub value: String,
    /// When it was added.
    pub created_at: OffsetDateTime,
}

/// A patient's identifiers, not deleted, by kind.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<IdentifierRow>, DbError> {
    let rows = sqlx::query_as!(
        IdentifierRow,
        r#"select id, kind, value, created_at from aarogyam.patient_identifiers
           where patient_id = $1 and deleted_at is null
           order by kind, created_at"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Adds an identifier.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict (constraint `patient_identifiers_value`) when
/// another patient has it.
pub async fn insert(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    kind: &str,
    value: &str,
) -> Result<IdentifierRow, DbError> {
    let row = sqlx::query_as!(
        IdentifierRow,
        r#"insert into aarogyam.patient_identifiers (id, patient_id, kind, value)
           values ($1, $2, $3, $4)
           returning id, kind, value, created_at"#,
        id,
        patient_id,
        kind,
        value
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Removes a patient's identifier. Returns whether it existed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete(conn: &mut PgConnection, patient_id: Uuid, id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.patient_identifiers set deleted_at = now()
           where id = $1 and patient_id = $2 and deleted_at is null"#,
        id,
        patient_id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Which of `values` of `kind` some patient already has.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn taken(
    conn: &mut PgConnection,
    kind: &str,
    values: &[String],
) -> Result<Vec<String>, DbError> {
    let taken = sqlx::query_scalar!(
        r#"select value from aarogyam.patient_identifiers
           where kind = $1 and value = any($2) and deleted_at is null"#,
        kind,
        values
    )
    .fetch_all(conn)
    .await?;
    Ok(taken)
}
