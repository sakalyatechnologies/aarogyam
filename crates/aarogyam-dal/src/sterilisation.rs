//! Sterilisation cycles: the autoclave runs a clinic records. Inside a clinic transaction, so
//! row-level security limits every query to that clinic.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A recorded cycle.
#[derive(Debug, Clone)]
pub struct CycleRow {
    /// Identifier.
    pub id: Uuid,
    /// When the cycle ran.
    pub run_at: OffsetDateTime,
    /// The member who recorded it.
    pub recorded_by: Uuid,
    /// Their name, when known.
    pub recorded_by_name: Option<String>,
    /// What was in the load, in a few words.
    pub load_note: Option<String>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
}

/// A cycle to record.
#[derive(Debug, Clone, Copy)]
pub struct NewCycle<'a> {
    /// Identifier.
    pub id: Uuid,
    /// When the cycle ran.
    pub run_at: OffsetDateTime,
    /// The member recording it.
    pub recorded_by: Uuid,
    /// What was in the load.
    pub load_note: Option<&'a str>,
}

/// Records a cycle and returns it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, new: &NewCycle<'_>) -> Result<CycleRow, DbError> {
    let row = sqlx::query_as!(
        CycleRow,
        r#"with c as (
             insert into aarogyam.sterilisation_cycles (id, run_at, recorded_by, load_note)
             values ($1, $2, $3, $4)
             returning id, run_at, recorded_by, load_note, created_at
           )
           select c.id as "id!", c.run_at as "run_at!", c.recorded_by as "recorded_by!",
                  coalesce(m.display_name, u.display_name) as "recorded_by_name?",
                  c.load_note as "load_note?", c.created_at as "created_at!"
           from c
           join aarogyam.memberships m on m.id = c.recorded_by
           left join aarogyam.users u on u.id = m.user_id"#,
        new.id,
        new.run_at,
        new.recorded_by,
        new.load_note,
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The cycles that ran between `from` (included) and `to` (excluded), latest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    from: OffsetDateTime,
    to: OffsetDateTime,
) -> Result<Vec<CycleRow>, DbError> {
    let rows = sqlx::query_as!(
        CycleRow,
        r#"select c.id, c.run_at, c.recorded_by, coalesce(m.display_name, u.display_name) as "recorded_by_name?",
                  c.load_note as "load_note?", c.created_at
           from aarogyam.sterilisation_cycles c
           join aarogyam.memberships m on m.org_id = c.org_id and m.id = c.recorded_by
           left join aarogyam.users u on u.id = m.user_id
           where c.run_at >= $1 and c.run_at < $2
           order by c.run_at desc, c.id desc
           limit 200"#,
        from,
        to,
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
