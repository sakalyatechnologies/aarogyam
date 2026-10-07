//! A clinic's own dental terms (procedures and materials) beside the seeded vocabulary.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// A clinic term as stored.
#[derive(Debug, Clone)]
pub struct TermRow {
    /// Identifier.
    pub id: Uuid,
    /// `procedure` or `material`.
    pub kind: String,
    /// What the clinician reads.
    pub label: String,
}

/// Every term the clinic added, by list and label.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(conn: &mut PgConnection) -> Result<Vec<TermRow>, DbError> {
    let rows = sqlx::query_as!(
        TermRow,
        r#"select id, kind, label from aarogyam.dental_terms order by kind, lower(label)"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The clinic's terms among `ids`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn some(conn: &mut PgConnection, ids: &[Uuid]) -> Result<Vec<TermRow>, DbError> {
    let rows = sqlx::query_as!(
        TermRow,
        r#"select id, kind, label from aarogyam.dental_terms where id = any($1)"#,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Adds a term, or finds the one already there with the same label (ignoring case), in one
/// statement. Returns the term and whether it was new.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn add(
    conn: &mut PgConnection,
    id: Uuid,
    kind: &str,
    label: &str,
    added_by: Uuid,
) -> Result<(TermRow, bool), DbError> {
    let row = sqlx::query!(
        r#"with added as (
             insert into aarogyam.dental_terms (id, kind, label, added_by)
             values ($1, $2, $3, $4)
             on conflict (org_id, kind, lower(label)) do nothing
             returning id, kind, label
           )
           select id as "id!", kind as "kind!", label as "label!", true as "created!" from added
           union all
           select id, kind, label, false from aarogyam.dental_terms
           where kind = $2 and lower(label) = lower($3) and not exists (select 1 from added)"#,
        id,
        kind,
        label,
        added_by
    )
    .fetch_one(conn)
    .await?;
    Ok((
        TermRow {
            id: row.id,
            kind: row.kind,
            label: row.label,
        },
        row.created,
    ))
}
