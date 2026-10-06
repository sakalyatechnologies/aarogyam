//! Follow-ups that fall due. Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A follow-up with its patient.
#[derive(Debug, Clone)]
pub struct RecallRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The patient's name.
    pub patient_name: String,
    /// The patient's number.
    pub patient_number: String,
    /// `follow_up`, `cleaning`, …
    pub kind: String,
    /// Why.
    pub reason: String,
    /// When it falls due.
    pub due_on: Date,
    /// `due`, `notified`, `booked`, `done` or `dismissed`.
    pub status: String,
    /// When it was done.
    pub done_at: Option<OffsetDateTime>,
}

/// Plans a follow-up.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    kind: &str,
    reason: &str,
    due_on: Date,
) -> Result<(), DbError> {
    sqlx::query!(
        "insert into aarogyam.recalls (id, patient_id, kind, reason, due_on) values ($1, $2, $3, $4, $5)",
        id,
        patient_id,
        kind,
        reason,
        due_on
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Open follow-ups (due or notified) falling due before `due_before`, or one follow-up.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    id: Option<Uuid>,
    due_before: Option<Date>,
    limit: i64,
    member: Option<Uuid>,
) -> Result<Vec<RecallRow>, DbError> {
    let rows = sqlx::query_as!(
        RecallRow,
        r#"select r.id, r.patient_id, p.full_name as patient_name, p.number as patient_number,
                  r.kind, r.reason, r.due_on, r.status, r.done_at
           from aarogyam.recalls r
           join aarogyam.patients p on p.org_id = r.org_id and p.id = r.patient_id
           where (($1::uuid is not null and r.id = $1)
                  or ($1::uuid is null and r.status in ('due', 'notified')
                      and ($2::date is null or r.due_on < $2)))
             and app.patient_in_reach(r.patient_id, $4)
           order by r.due_on, r.id
           limit $3"#,
        id,
        due_before,
        limit,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Marks a follow-up done; returns whether it was open.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn done(conn: &mut PgConnection, id: Uuid, at: OffsetDateTime) -> Result<bool, DbError> {
    let result = sqlx::query!(
        "update aarogyam.recalls set status = 'done', done_at = $2 where id = $1 and status in ('due', 'notified', 'booked')",
        id,
        at
    )
    .execute(conn)
    .await?;
    Ok(result.rows_affected() > 0)
}
