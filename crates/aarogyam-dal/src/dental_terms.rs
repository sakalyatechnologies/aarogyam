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
    /// No longer offered for new entries; old entries still show it.
    pub retired: bool,
}

/// Every term the clinic added, retired ones included, by list and label.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(conn: &mut PgConnection) -> Result<Vec<TermRow>, DbError> {
    let rows = sqlx::query_as!(
        TermRow,
        r#"select id, kind, label, retired_at is not null as "retired!"
           from aarogyam.dental_terms order by kind, lower(label)"#
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
        r#"select id, kind, label, retired_at is not null as "retired!"
           from aarogyam.dental_terms where id = any($1)"#,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Adds a term, or finds the one already there with the same label (ignoring case) and brings
/// it back if it was retired, in one statement. Returns the term and whether it was new.
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
           ),
           restored as (
             update aarogyam.dental_terms set retired_at = null, retired_by = null
             where kind = $2 and lower(label) = lower($3) and retired_at is not null
               and not exists (select 1 from added)
             returning id
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
            retired: false,
        },
        row.created,
    ))
}

/// A clinic term with who added and retired it, for the clinic's own list.
#[derive(Debug, Clone)]
pub struct OwnTermRow {
    /// Identifier.
    pub id: Uuid,
    /// `procedure` or `material`.
    pub kind: String,
    /// What the clinician reads now.
    pub label: String,
    /// Who added it.
    pub added_by_name: Option<String>,
    /// When.
    pub created_at: time::OffsetDateTime,
    /// When it was retired.
    pub retired_at: Option<time::OffsetDateTime>,
    /// Who retired it.
    pub retired_by_name: Option<String>,
}

/// The clinic's own terms with who added and retired them, by list and label; or the one
/// with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn own(conn: &mut PgConnection, id: Option<Uuid>) -> Result<Vec<OwnTermRow>, DbError> {
    let rows = sqlx::query_as!(
        OwnTermRow,
        r#"select t.id, t.kind, t.label,
                  (select u.display_name from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
                   where m.org_id = t.org_id and m.id = t.added_by) as added_by_name,
                  t.created_at, t.retired_at,
                  (select u.display_name from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
                   where m.org_id = t.org_id and m.id = t.retired_by) as retired_by_name
           from aarogyam.dental_terms t
           where $1::uuid is null or t.id = $1
           order by t.kind, lower(t.label)"#,
        id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Gives a term a new label. `false` when no such term is in this clinic.
///
/// # Errors
/// [`DbError`] on a database failure; [`sakalya_db::DbErrorKind::Conflict`] when the list
/// already has the label.
pub async fn rename(conn: &mut PgConnection, id: Uuid, label: &str) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.dental_terms set label = $2 where id = $1",
        id,
        label
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Retires a term (`by` the member) or brings it back (`None`). `false` when no such term is
/// in this clinic. Doing it twice keeps the first retirement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_retired(
    conn: &mut PgConnection,
    id: Uuid,
    by: Option<Uuid>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.dental_terms
           set retired_at = case when $2::uuid is null then null else coalesce(retired_at, now()) end,
               retired_by = case when $2::uuid is null then null else coalesce(retired_by, $2) end
           where id = $1"#,
        id,
        by
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}
