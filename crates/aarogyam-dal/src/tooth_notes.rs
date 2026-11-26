//! Free-text notes on a tooth. Inside a clinic transaction, so row-level security limits every
//! query to that clinic. Notes are only added, never edited or deleted.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A note with its recorder's name.
#[derive(Debug, Clone)]
pub struct ToothNoteRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// FDI tooth number.
    pub tooth: i16,
    /// The visit it joined, when one was open.
    pub visit_id: Option<Uuid>,
    /// The text.
    pub body: String,
    /// The client's id for the request, when it sent one.
    pub client_id: Option<Uuid>,
    /// The member who wrote it.
    pub recorded_by: Option<Uuid>,
    /// Their name, when known.
    pub recorded_by_name: Option<String>,
    /// When it was written.
    pub created_at: OffsetDateTime,
}

/// A note to add.
#[derive(Debug, Clone, Copy)]
pub struct NewToothNote<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// FDI tooth number.
    pub tooth: i16,
    /// The open visit, if any.
    pub visit_id: Option<Uuid>,
    /// The text.
    pub body: &'a str,
    /// The client's id for the request.
    pub client_id: Option<Uuid>,
    /// The member writing it.
    pub recorded_by: Uuid,
}

/// Adds a note and returns it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_tooth_note(
    conn: &mut PgConnection,
    new: &NewToothNote<'_>,
) -> Result<ToothNoteRow, DbError> {
    let row = sqlx::query_as!(
        ToothNoteRow,
        r#"with n as (
             insert into aarogyam.tooth_notes
               (id, patient_id, tooth, visit_id, body, client_id, created_by)
             values ($1, $2, $3, $4, $5, $6, $7)
             returning id, patient_id, tooth, visit_id, body, client_id, created_by, created_at
           )
           select n.id as "id!", n.patient_id as "patient_id!", n.tooth as "tooth!",
                  n.visit_id as "visit_id?", n.body as "body!", n.client_id as "client_id?",
                  n.created_by as "recorded_by?",
                  coalesce(m.display_name, u.display_name) as "recorded_by_name?",
                  n.created_at as "created_at!"
           from n
           left join aarogyam.memberships m on m.id = n.created_by
           left join aarogyam.users u on u.id = m.user_id"#,
        new.id,
        new.patient_id,
        new.tooth,
        new.visit_id,
        new.body,
        new.client_id,
        new.recorded_by,
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The note a client's `client_id` made, if any.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn tooth_note_by_client_id(
    conn: &mut PgConnection,
    client_id: Uuid,
) -> Result<Option<ToothNoteRow>, DbError> {
    let row = sqlx::query_as!(
        ToothNoteRow,
        r#"select n.id as "id!", n.patient_id as "patient_id!", n.tooth as "tooth!",
                  n.visit_id as "visit_id?", n.body as "body!", n.client_id as "client_id?",
                  n.created_by as "recorded_by?",
                  coalesce(m.display_name, u.display_name) as "recorded_by_name?",
                  n.created_at as "created_at!"
           from aarogyam.tooth_notes n
           left join aarogyam.memberships m on m.id = n.created_by
           left join aarogyam.users u on u.id = m.user_id
           where n.client_id = $1"#,
        client_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A tooth's notes, newest first, at most `limit`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_tooth_notes(
    conn: &mut PgConnection,
    patient_id: Uuid,
    tooth: i16,
    limit: i64,
) -> Result<Vec<ToothNoteRow>, DbError> {
    let rows = sqlx::query_as!(
        ToothNoteRow,
        r#"select n.id as "id!", n.patient_id as "patient_id!", n.tooth as "tooth!",
                  n.visit_id as "visit_id?", n.body as "body!", n.client_id as "client_id?",
                  n.created_by as "recorded_by?",
                  coalesce(m.display_name, u.display_name) as "recorded_by_name?",
                  n.created_at as "created_at!"
           from aarogyam.tooth_notes n
           left join aarogyam.memberships m on m.id = n.created_by
           left join aarogyam.users u on u.id = m.user_id
           where n.patient_id = $1 and n.tooth = $2
           order by n.created_at desc, n.id desc
           limit $3"#,
        patient_id,
        tooth,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A tooth and the start of its newest note.
#[derive(Debug, Clone)]
pub struct LatestNote {
    /// FDI tooth number.
    pub tooth: i16,
    /// The newest note's first 120 characters.
    pub latest_note: String,
}

/// The newest note of each of the patient's teeth that has one, by tooth.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn latest_tooth_notes(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<LatestNote>, DbError> {
    let rows = sqlx::query_as!(
        LatestNote,
        r#"select distinct on (tooth) tooth as "tooth!", left(body, 120) as "latest_note!"
           from aarogyam.tooth_notes
           where patient_id = $1
           order by tooth, created_at desc, id desc"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
