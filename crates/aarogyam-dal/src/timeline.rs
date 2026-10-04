//! A patient's clinical timeline: visits, signed notes, procedures and files in one list.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// One event on the timeline.
#[derive(Debug, Clone)]
pub struct EventRow {
    /// `visit`, `note`, `procedure` or `attachment`.
    pub kind: String,
    /// The record.
    pub id: Uuid,
    /// When it happened.
    pub at: OffsetDateTime,
    /// The visit it belongs to.
    pub visit_id: Option<Uuid>,
    /// A short title: the visit number, the note kind, the procedure name, the file kind.
    pub title: String,
    /// More detail: the chief complaint, the assessment, the tooth, the caption.
    pub detail: Option<String>,
    /// The record's status.
    pub status: Option<String>,
    /// The member responsible.
    pub member_id: Option<Uuid>,
    /// A fee, for procedures.
    pub amount_paise: Option<i64>,
}

/// The patient's timeline, newest first, before `before` when given.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn events(
    conn: &mut PgConnection,
    patient_id: Uuid,
    before: Option<OffsetDateTime>,
    limit: i64,
) -> Result<Vec<EventRow>, DbError> {
    let rows = sqlx::query_as!(
        EventRow,
        r#"select kind as "kind!", id as "id!", at as "at!", visit_id, title as "title!", detail,
                  status, member_id, amount_paise
           from (
             select 'visit' as kind, e.id, e.started_at as at, e.id as visit_id, e.number as title,
                    e.chief_complaint as detail, e.status, e.clinician_id as member_id,
                    null::bigint as amount_paise
             from aarogyam.encounters e where e.patient_id = $1
             union all
             select 'note', n.id, n.signed_at, n.encounter_id, n.kind,
                    coalesce(n.body ->> 'assessment', n.body ->> 'subjective', n.body ->> 'plan'),
                    n.status, n.author_id, null
             from aarogyam.clinical_notes n
             where n.patient_id = $1 and n.signed_at is not null
             union all
             select 'procedure', p.id, coalesce(p.performed_at, p.created_at), p.encounter_id, p.name,
                    case when p.tooth is not null then 'tooth ' || p.tooth end,
                    p.status, p.clinician_id, p.price_paise
             from aarogyam.procedures p
             where p.patient_id = $1 and p.status <> 'entered_in_error'
             union all
             select 'attachment', a.id, a.created_at, a.encounter_id, a.kind, a.caption, null, null, null
             from aarogyam.attachments a where a.patient_id = $1 and a.deleted_at is null
           ) events
           where $2::timestamptz is null or at < $2
           order by at desc, id desc
           limit $3"#,
        patient_id,
        before,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
