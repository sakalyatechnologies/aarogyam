//! "What we discussed" rows of Show patient (`aarogyam.present_discussions`): append-only, one
//! current row per visit, tooth and situation.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A stored discussion.
#[derive(Debug, Clone)]
pub struct DiscussionRow {
    /// Identifier.
    pub id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// FDI tooth; none for an example-arch topic.
    pub tooth: Option<i16>,
    /// The situation key.
    pub situation: String,
    /// The options, as stored.
    pub options: Value,
    /// The doctor's tick for the patient.
    pub send_to_patient: bool,
    /// The row it replaced.
    pub supersedes_id: Option<Uuid>,
    /// When it was saved.
    pub created_at: OffsetDateTime,
}

/// Values for a new row.
#[derive(Debug)]
pub struct NewDiscussion<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// FDI tooth.
    pub tooth: Option<i16>,
    /// The situation key.
    pub situation: &'a str,
    /// The options.
    pub options: &'a Value,
    /// The doctor's tick.
    pub send_to_patient: bool,
    /// The row replaced.
    pub supersedes_id: Option<Uuid>,
}

/// The visit's current discussions, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn current_of_visit(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<DiscussionRow>, DbError> {
    let rows = sqlx::query_as!(
        DiscussionRow,
        r#"select id, encounter_id, tooth, situation, options, send_to_patient, supersedes_id,
                  created_at
           from aarogyam.present_discussions
           where encounter_id = $1 and status = 'current'
           order by created_at, id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Serialises saves for one visit, tooth and situation until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(
    conn: &mut PgConnection,
    encounter_id: Uuid,
    tooth: Option<i16>,
    situation: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"select pg_advisory_xact_lock(hashtextextended($1::text, 0)) as "locked!: bool""#,
        format!(
            "discussion:{encounter_id}:{}:{situation}",
            tooth.unwrap_or(0)
        )
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// The current row's id for a visit, tooth and situation.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn current_for(
    conn: &mut PgConnection,
    encounter_id: Uuid,
    tooth: Option<i16>,
    situation: &str,
) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        r#"select id from aarogyam.present_discussions
           where encounter_id = $1 and coalesce(tooth, 0) = coalesce($2::smallint, 0)
             and situation = $3 and status = 'current'"#,
        encounter_id,
        tooth,
        situation
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// Marks a current row superseded.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn supersede(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.present_discussions set status = 'superseded'
         where id = $1 and status = 'current'",
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Marks a current row entered in error; false when it isn't current in this visit.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_in_error(
    conn: &mut PgConnection,
    encounter_id: Uuid,
    id: Uuid,
    reason: &str,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.present_discussions set status = 'entered_in_error', error_reason = $3
         where id = $1 and encounter_id = $2 and status = 'current'",
        id,
        encounter_id,
        reason
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Inserts a row as the current one.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when another current row exists.
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewDiscussion<'_>,
) -> Result<DiscussionRow, DbError> {
    let row = sqlx::query_as!(
        DiscussionRow,
        r#"insert into aarogyam.present_discussions
             (id, patient_id, encounter_id, tooth, situation, options, send_to_patient,
              supersedes_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, encounter_id, tooth, situation, options, send_to_patient, supersedes_id,
                     created_at"#,
        new.id,
        new.patient_id,
        new.encounter_id,
        new.tooth,
        new.situation,
        new.options,
        new.send_to_patient,
        new.supersedes_id
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}
