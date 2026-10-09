//! The clinic's opening hours per branch: weekly shifts, split shifts as two rows, replaced as a
//! whole per branch. Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::Time;
use uuid::Uuid;

/// One opening shift as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpeningRow {
    /// Branch.
    pub branch_id: Uuid,
    /// 1 Monday to 7 Sunday.
    pub weekday: i16,
    /// Local opening time.
    pub starts: Time,
    /// Local closing time.
    pub ends: Time,
}

/// Opening shifts of every branch, or of one, by branch, weekday and start.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    branch_id: Option<Uuid>,
) -> Result<Vec<OpeningRow>, DbError> {
    let rows = sqlx::query_as!(
        OpeningRow,
        r#"select branch_id, weekday, starts, ends
           from aarogyam.clinic_hours
           where ($1::uuid is null or branch_id = $1)
           order by branch_id, weekday, starts"#,
        branch_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Replaces one branch's week with these shifts (`branch_id` of each row is ignored), in one
/// statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn replace(
    conn: &mut PgConnection,
    branch_id: Uuid,
    shifts: &[OpeningRow],
) -> Result<(), DbError> {
    let weekdays: Vec<i16> = shifts.iter().map(|shift| shift.weekday).collect();
    let starts: Vec<Time> = shifts.iter().map(|shift| shift.starts).collect();
    let ends: Vec<Time> = shifts.iter().map(|shift| shift.ends).collect();
    sqlx::query!(
        r#"with gone as (
             delete from aarogyam.clinic_hours where branch_id = $1
           )
           insert into aarogyam.clinic_hours (branch_id, weekday, starts, ends)
           select $1, w, s, e
           from unnest($2::smallint[], $3::time[], $4::time[]) as t(w, s, e)"#,
        branch_id,
        &weekdays,
        &starts,
        &ends
    )
    .execute(conn)
    .await?;
    Ok(())
}
