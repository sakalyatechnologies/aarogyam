//! The patient's history page: a page of visits, then one statement per section for all of
//! them at once (`= any($1)`), never one per visit. Every section repeats the reach check on the
//! visit (or the file) so a member with Own reach sees only their own records.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A visit on the history page.
#[derive(Debug, Clone)]
pub struct VisitRow {
    /// The visit.
    pub id: Uuid,
    /// Its number, `V-8`.
    pub number: String,
    /// `open` or `closed`.
    pub status: String,
    /// The typed reason for the visit.
    pub chief_complaint: Option<String>,
    /// When it started.
    pub started_at: OffsetDateTime,
    /// When it ended.
    pub ended_at: Option<OffsetDateTime>,
    /// The clinician.
    pub clinician_id: Uuid,
    /// The clinician's display name.
    pub clinician_name: Option<String>,
}

/// The patient's visits within reach, newest first, strictly before `(started_at, id)` when
/// given, so two visits that started at the same moment are neither skipped nor repeated.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn visits(
    conn: &mut PgConnection,
    patient_id: Uuid,
    before: Option<(OffsetDateTime, Uuid)>,
    limit: i64,
    member: Option<Uuid>,
) -> Result<Vec<VisitRow>, DbError> {
    let (at, id) = before.unzip();
    let rows = sqlx::query_as!(
        VisitRow,
        r#"select e.id, e.number, e.status, e.chief_complaint, e.started_at, e.ended_at,
                  e.clinician_id, coalesce(m.display_name, u.display_name) as clinician_name
           from aarogyam.encounters e
           left join aarogyam.memberships m on m.org_id = e.org_id and m.id = e.clinician_id
           left join aarogyam.users u on u.id = m.user_id
           where e.patient_id = $1
             and app.clinical_in_reach(e.clinician_id, e.created_by, null, $5)
             and ($2::timestamptz is null or (e.started_at, e.id) < ($2, $3::uuid))
           order by e.started_at desc, e.id desc
           limit $4"#,
        patient_id,
        at,
        id,
        limit,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A signed note of a listed visit.
#[derive(Debug, Clone)]
pub struct NoteRow {
    /// The visit.
    pub encounter_id: Uuid,
    /// The note's sections.
    pub body: serde_json::Value,
}

/// The signed notes of the visits, oldest first in each: not drafts, not entered in error, and
/// not a note a live correction replaced.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn notes(
    conn: &mut PgConnection,
    visit_ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<NoteRow>, DbError> {
    let rows = sqlx::query_as!(
        NoteRow,
        r#"select n.encounter_id, n.body
           from aarogyam.clinical_notes n
           where n.encounter_id = any($1) and n.status = 'signed'
             and not exists (select 1 from aarogyam.clinical_notes s
                             where s.org_id = n.org_id and s.supersedes_id = n.id
                               and s.status <> 'entered_in_error')
             and app.clinical_in_reach(n.author_id, n.created_by, n.encounter_id, $2)
           order by n.encounter_id, n.signed_at, n.id"#,
        visit_ids,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A procedure of a listed visit.
#[derive(Debug, Clone)]
pub struct ProcedureRow {
    /// The visit.
    pub encounter_id: Uuid,
    /// FDI tooth.
    pub tooth: Option<i16>,
    /// What was done.
    pub name: String,
    /// `planned` or `done`.
    pub status: String,
}

/// The procedures of the visits, not those entered in error.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn procedures(
    conn: &mut PgConnection,
    visit_ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<ProcedureRow>, DbError> {
    let rows = sqlx::query_as!(
        ProcedureRow,
        r#"select p.encounter_id, p.tooth, p.name, p.status
           from aarogyam.procedures p
           where p.encounter_id = any($1) and p.status <> 'entered_in_error'
             and app.clinical_in_reach(p.clinician_id, p.created_by, p.encounter_id, $2)
           order by p.encounter_id, p.created_at, p.id"#,
        visit_ids,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A file of a listed visit, or one that belongs to no visit.
#[derive(Debug, Clone)]
pub struct FileRow {
    /// The file.
    pub id: Uuid,
    /// The visit, if any.
    pub encounter_id: Option<Uuid>,
    /// `photo`, `xray`, `report`, `document`, `audio`, `consent` or `payment_proof`.
    pub kind: String,
    /// Its content type.
    pub mime_type: String,
    /// Its tag: `OPG`, `X-ray` and so on.
    pub label: Option<String>,
    /// When it was added.
    pub created_at: OffsetDateTime,
}

/// The files of the visits, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn files(
    conn: &mut PgConnection,
    visit_ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<FileRow>, DbError> {
    let rows = sqlx::query_as!(
        FileRow,
        r#"select a.id, a.encounter_id, a.kind, a.mime_type, a.label, a.created_at
           from aarogyam.attachments a
           where a.encounter_id = any($1) and a.deleted_at is null
             and app.clinical_in_reach(null, a.created_by, a.encounter_id, $2)
           order by a.created_at, a.id"#,
        visit_ids,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The patient's files that belong to no visit (uploads from the records card, imports), newest
/// first, at most `limit`; audio and consent scans stay out.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn loose_files(
    conn: &mut PgConnection,
    patient_id: Uuid,
    limit: i64,
    member: Option<Uuid>,
) -> Result<Vec<FileRow>, DbError> {
    let rows = sqlx::query_as!(
        FileRow,
        r#"select a.id, a.encounter_id, a.kind, a.mime_type, a.label, a.created_at
           from aarogyam.attachments a
           where a.patient_id = $1 and a.encounter_id is null and a.deleted_at is null
             and a.kind not in ('audio', 'consent', 'payment_proof')
             and app.clinical_in_reach(null, a.created_by, null, $3)
           order by a.created_at desc, a.id desc
           limit $2"#,
        patient_id,
        limit,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A medicine prescribed in a listed visit.
#[derive(Debug, Clone)]
pub struct MedicineRow {
    /// The visit.
    pub encounter_id: Uuid,
    /// The medicine as printed.
    pub drug_name: String,
}

/// The medicines of the visits' prescriptions, not cancelled ones. A prescription belongs to
/// the visit it names, or, naming none, to the visit that was running when it was written (the
/// rule the visit detail uses).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn medicines(
    conn: &mut PgConnection,
    visit_ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<MedicineRow>, DbError> {
    let rows = sqlx::query_as!(
        MedicineRow,
        r#"select e.id as "encounter_id!", i.drug_name
           from aarogyam.encounters e
           join aarogyam.prescriptions p
             on p.org_id = e.org_id and p.patient_id = e.patient_id and p.status <> 'cancelled'
            and (p.encounter_id = e.id
                 or (p.encounter_id is null
                     and coalesce(p.issued_at, p.created_at) >= e.started_at
                     and coalesce(p.issued_at, p.created_at) <= coalesce(e.ended_at, 'infinity')))
           join aarogyam.prescription_items i on i.org_id = p.org_id and i.prescription_id = p.id
           where e.id = any($1)
             and app.clinical_in_reach(e.clinician_id, e.created_by, null, $2)
           order by e.id, p.created_at, p.id, i.line_no"#,
        visit_ids,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A bill of a listed visit.
#[derive(Debug, Clone)]
pub struct BillRow {
    /// The visit.
    pub encounter_id: Uuid,
    /// The bill.
    pub id: Uuid,
    /// Its number once issued.
    pub number: Option<String>,
    /// `issued`.
    pub status: String,
    /// The total.
    pub total_paise: i64,
    /// Received against it.
    pub paid_paise: i64,
}

/// The issued bills of the visits (a draft has no total yet), with what was received against
/// each.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn bills(
    conn: &mut PgConnection,
    visit_ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<BillRow>, DbError> {
    let rows = sqlx::query_as!(
        BillRow,
        r#"select i.encounter_id as "encounter_id!", i.id, i.number, i.status, i.total_paise,
                  coalesce((select sum(a.amount_paise)
                            from aarogyam.payment_allocations a
                            join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
                            where a.org_id = i.org_id and a.invoice_id = i.id
                              and m.status = 'received'), 0)::bigint as "paid_paise!"
           from aarogyam.invoices i
           join aarogyam.encounters e on e.org_id = i.org_id and e.id = i.encounter_id
           where i.encounter_id = any($1) and i.status = 'issued'
             and app.clinical_in_reach(e.clinician_id, e.created_by, null, $2)
           order by i.encounter_id, i.created_at, i.id"#,
        visit_ids,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A treatment plan proposed in a listed visit.
#[derive(Debug, Clone)]
pub struct PlanRow {
    /// The visit.
    pub encounter_id: Uuid,
    /// The plan.
    pub id: Uuid,
    /// Its title.
    pub title: String,
    /// `proposed`, `accepted`, `in_progress`, `completed` or `declined`.
    pub status: String,
}

/// The plans proposed in the visits.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn plans(
    conn: &mut PgConnection,
    visit_ids: &[Uuid],
    member: Option<Uuid>,
) -> Result<Vec<PlanRow>, DbError> {
    let rows = sqlx::query_as!(
        PlanRow,
        r#"select t.encounter_id as "encounter_id!", t.id, t.title, t.status
           from aarogyam.treatment_plans t
           where t.encounter_id = any($1)
             and app.clinical_in_reach(t.clinician_id, t.created_by, t.encounter_id, $2)
           order by t.encounter_id, t.created_at, t.id"#,
        visit_ids,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
