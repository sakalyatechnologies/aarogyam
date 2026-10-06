//! A patient's summary note (one per patient) and the list of their visit notes.

use serde::Deserialize;
use sqlx::PgConnection;
use sqlx::types::Json;
use time::OffsetDateTime;
use uuid::Uuid;

use sakalya_db::DbError;

/// The summary note as stored, with who last changed it.
#[derive(Debug, Clone, Deserialize)]
pub struct SummaryRow {
    /// Identifier.
    pub id: Uuid,
    /// The formatted text (a Markdown subset).
    pub body: String,
    /// Goes up when the text changes.
    pub row_version: i64,
    /// When it last changed.
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    /// Who last changed it.
    pub updated_by_name: Option<String>,
}

/// A visit note as listed on the patient.
#[derive(Debug, Clone, Deserialize)]
pub struct VisitNoteRow {
    /// Identifier.
    pub id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// The visit's number (`V-318`).
    pub visit_number: String,
    /// Note kind.
    pub kind: String,
    /// Note status.
    pub status: String,
    /// Sections as JSON.
    pub body: serde_json::Value,
    /// The author's membership.
    pub author_id: Uuid,
    /// The author's name.
    pub author_name: Option<String>,
    /// When it was signed.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub signed_at: Option<OffsetDateTime>,
    /// When it was written.
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// When it last changed.
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    /// The note's version.
    pub row_version: i64,
    /// How many addenda it has.
    pub addenda_count: i64,
}

/// The summary note and the visit notes of a patient.
#[derive(Debug, Clone)]
pub struct Overview {
    /// The summary note, when one was written.
    pub summary: Option<SummaryRow>,
    /// The visit notes in the caller's reach, newest first.
    pub visit_notes: Vec<VisitNoteRow>,
}

/// The patient's summary note and up to `limit` visit notes in one statement; `None` when the
/// patient isn't in this clinic or is out of `member`'s reach (`None` member: every patient).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn overview(
    conn: &mut PgConnection,
    patient_id: Uuid,
    member: Option<Uuid>,
    limit: i64,
) -> Result<Option<Overview>, DbError> {
    let row = sqlx::query!(
        r#"select exists (select 1 from aarogyam.patients
                          where id = $1 and deleted_at is null and app.patient_in_reach(id, $2)) as "found!",
                  (select to_jsonb(s) from (
                     select pn.id, pn.body, pn.row_version, pn.updated_at,
                            u.display_name as updated_by_name
                     from aarogyam.patient_notes pn
                     left join aarogyam.users u on u.id = pn.updated_by
                     where pn.patient_id = $1) s
                  ) as "summary: Json<SummaryRow>",
                  coalesce((
                    select jsonb_agg(to_jsonb(v) order by v.created_at desc, v.id desc)
                    from (select n.id, n.encounter_id, e.number as visit_number, n.kind, n.status,
                                 n.body, n.author_id, au.display_name as author_name,
                                 n.signed_at, n.created_at, n.updated_at, n.row_version,
                                 (select count(*) from aarogyam.note_addenda a
                                  where a.note_id = n.id) as addenda_count
                          from aarogyam.clinical_notes n
                          join aarogyam.encounters e on e.org_id = n.org_id and e.id = n.encounter_id
                          left join aarogyam.memberships m on m.org_id = n.org_id and m.id = n.author_id
                          left join aarogyam.users au on au.id = m.user_id
                          where n.patient_id = $1
                            and app.clinical_in_reach(n.author_id, n.created_by, n.encounter_id, $2)
                          order by n.created_at desc, n.id desc limit $3) v
                  ), '[]'::jsonb) as "notes!: Json<Vec<VisitNoteRow>>""#,
        patient_id,
        member,
        limit
    )
    .fetch_one(conn)
    .await?;
    Ok(row.found.then(|| Overview {
        summary: row.summary.map(|json| json.0),
        visit_notes: row.notes.0,
    }))
}

/// The summary note's version, locked until the transaction ends; `None` when there is none.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_summary(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Option<i64>, DbError> {
    let version = sqlx::query_scalar!(
        "select row_version from aarogyam.patient_notes where patient_id = $1 for update",
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(version)
}

/// Replaces the text of the patient's existing summary note.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_summary(
    conn: &mut PgConnection,
    patient_id: Uuid,
    body: &str,
) -> Result<SummaryRow, DbError> {
    let row = sqlx::query!(
        r#"with changed as (
             update aarogyam.patient_notes set body = $2 where patient_id = $1
             returning id, body, row_version, updated_at, updated_by)
           select c.id as "id!", c.body as "body!", c.row_version as "row_version!",
                  c.updated_at as "updated_at!",
                  (select u.display_name from aarogyam.users u where u.id = c.updated_by) as updated_by_name
           from changed c"#,
        patient_id,
        body
    )
    .fetch_one(conn)
    .await?;
    Ok(SummaryRow {
        id: row.id,
        body: row.body,
        row_version: row.row_version,
        updated_at: row.updated_at,
        updated_by_name: row.updated_by_name,
    })
}

/// Writes the patient's first summary note; `None` when one was written meanwhile.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_summary(
    conn: &mut PgConnection,
    patient_id: Uuid,
    body: &str,
) -> Result<Option<SummaryRow>, DbError> {
    let row = sqlx::query!(
        r#"with made as (
             insert into aarogyam.patient_notes (patient_id, body) values ($1, $2)
             on conflict (org_id, patient_id) do nothing
             returning id, body, row_version, updated_at, updated_by)
           select c.id as "id!", c.body as "body!", c.row_version as "row_version!",
                  c.updated_at as "updated_at!",
                  (select u.display_name from aarogyam.users u where u.id = c.updated_by) as updated_by_name
           from made c"#,
        patient_id,
        body
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| SummaryRow {
        id: row.id,
        body: row.body,
        row_version: row.row_version,
        updated_at: row.updated_at,
        updated_by_name: row.updated_by_name,
    }))
}
