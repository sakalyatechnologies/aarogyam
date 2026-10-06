//! Visits (encounters), clinical notes and addenda, and the access record for clinical reads.
//! Every function takes the connection of an open clinic transaction, so row-level security
//! limits it to that clinic.

use sakalya_db::DbError;
use sqlx::PgConnection;
use sqlx::types::Json;
use time::OffsetDateTime;
use uuid::Uuid;

/// A visit as stored.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct EncounterRow {
    /// Identifier.
    pub id: Uuid,
    /// Readable number, such as `V-318`.
    pub number: String,
    /// The patient.
    pub patient_id: Uuid,
    /// The member responsible.
    pub clinician_id: Uuid,
    /// The branch.
    pub branch_id: Uuid,
    /// The appointment it was started from.
    pub appointment_id: Option<Uuid>,
    /// `open` or `closed`.
    pub status: String,
    /// Why the patient came.
    pub chief_complaint: Option<String>,
    /// When it started.
    #[serde(with = "crate::json::timestamp")]
    pub started_at: OffsetDateTime,
    /// When it was closed.
    #[serde(default, deserialize_with = "crate::json::optional_timestamp")]
    pub ended_at: Option<OffsetDateTime>,
}

/// Values for a new visit.
#[derive(Debug, Clone)]
pub struct NewEncounter<'a> {
    /// Identifier chosen by the API.
    pub id: Uuid,
    /// Readable number.
    pub number: &'a str,
    /// The patient.
    pub patient_id: Uuid,
    /// The member responsible.
    pub clinician_id: Uuid,
    /// The branch.
    pub branch_id: Uuid,
    /// The appointment, if any.
    pub appointment_id: Option<Uuid>,
    /// Why the patient came.
    pub chief_complaint: Option<&'a str>,
    /// When it started.
    pub started_at: OffsetDateTime,
}

/// The clinic's default branch, or its oldest one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn default_branch(conn: &mut PgConnection) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        r#"select id from aarogyam.branches where deleted_at is null
           order by is_default desc, created_at limit 1"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// Inserts a visit and records it as the patient's last visit.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when the appointment already has a visit.
pub async fn insert_encounter(
    conn: &mut PgConnection,
    new: &NewEncounter<'_>,
) -> Result<EncounterRow, DbError> {
    let row = sqlx::query_as!(
        EncounterRow,
        r#"insert into aarogyam.encounters
             (id, number, patient_id, clinician_id, branch_id, appointment_id, chief_complaint, started_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, number, patient_id, clinician_id, branch_id, appointment_id, status,
                     chief_complaint, started_at, ended_at"#,
        new.id,
        new.number,
        new.patient_id,
        new.clinician_id,
        new.branch_id,
        new.appointment_id,
        new.chief_complaint,
        new.started_at
    )
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query!(
        r#"update aarogyam.patients set last_visit_at = $2
           where id = $1 and (last_visit_at is null or last_visit_at < $2)"#,
        new.patient_id,
        new.started_at
    )
    .execute(conn)
    .await?;
    Ok(row)
}

/// Serialises requests that carry the same client-chosen id until the transaction ends, so a
/// retry that arrives while the first attempt is still running waits for it and then finds its
/// record, instead of racing it to insert.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_client_id(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        r#"select pg_advisory_xact_lock(hashtextextended($1::text, 0)) as "locked!: bool""#,
        format!("client-id:{id}")
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// The visit with `id` in this clinic; `lock` holds it until the transaction ends. `member`
/// narrows to visits that member treats or started (`app.clinical_in_reach`); `None` reaches all.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_encounter(
    conn: &mut PgConnection,
    id: Uuid,
    lock: bool,
    member: Option<Uuid>,
) -> Result<Option<EncounterRow>, DbError> {
    let row = if lock {
        sqlx::query_as!(
            EncounterRow,
            r#"select id, number, patient_id, clinician_id, branch_id, appointment_id, status,
                      chief_complaint, started_at, ended_at
               from aarogyam.encounters
               where id = $1 and app.clinical_in_reach(clinician_id, created_by, null, $2)
               for update"#,
            id,
            member
        )
        .fetch_optional(conn)
        .await?
    } else {
        sqlx::query_as!(
            EncounterRow,
            r#"select id, number, patient_id, clinician_id, branch_id, appointment_id, status,
                      chief_complaint, started_at, ended_at
               from aarogyam.encounters
               where id = $1 and app.clinical_in_reach(clinician_id, created_by, null, $2)"#,
            id,
            member
        )
        .fetch_optional(conn)
        .await?
    };
    Ok(row)
}

/// A patient's visits, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_encounters(
    conn: &mut PgConnection,
    patient_id: Uuid,
    limit: i64,
    member: Option<Uuid>,
) -> Result<Vec<EncounterRow>, DbError> {
    let rows = sqlx::query_as!(
        EncounterRow,
        r#"select id, number, patient_id, clinician_id, branch_id, appointment_id, status,
                  chief_complaint, started_at, ended_at
           from aarogyam.encounters
           where patient_id = $1 and app.clinical_in_reach(clinician_id, created_by, null, $3)
           order by started_at desc, id desc limit $2"#,
        patient_id,
        limit,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A listed visit with the clinician's name.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct VisitEntry {
    /// The visit.
    #[serde(flatten)]
    pub row: EncounterRow,
    /// The clinician's display name.
    pub clinician_name: Option<String>,
}

/// A patient's visits, newest first, with the clinicians' names, and whether the patient is in
/// this clinic: `None` when not. One statement instead of three.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_for_patient(
    conn: &mut PgConnection,
    patient_id: Uuid,
    limit: i64,
) -> Result<Option<Vec<VisitEntry>>, DbError> {
    let row = sqlx::query!(
        r#"select exists (select 1 from aarogyam.patients where id = $1) as "found!",
                  coalesce((
                    select jsonb_agg(to_jsonb(v) order by v.started_at desc, v.id desc)
                    from (select e.id, e.number, e.patient_id, e.clinician_id, e.branch_id,
                                 e.appointment_id, e.status, e.chief_complaint, e.started_at,
                                 e.ended_at, u.display_name as clinician_name
                          from aarogyam.encounters e
                          left join aarogyam.memberships m
                            on m.org_id = e.org_id and m.id = e.clinician_id
                          left join aarogyam.users u on u.id = m.user_id
                          where e.patient_id = $1
                          order by e.started_at desc, e.id desc limit $2) v
                  ), '[]'::jsonb) as "rows!: sqlx::types::Json<Vec<VisitEntry>>""#,
        patient_id,
        limit
    )
    .fetch_one(conn)
    .await?;
    Ok(row.found.then_some(row.rows.0))
}

/// Closes a visit.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn close_encounter(
    conn: &mut PgConnection,
    id: Uuid,
    at: OffsetDateTime,
) -> Result<EncounterRow, DbError> {
    let row = sqlx::query_as!(
        EncounterRow,
        r#"update aarogyam.encounters set status = 'closed', ended_at = greatest($2, started_at)
           where id = $1
           returning id, number, patient_id, clinician_id, branch_id, appointment_id, status,
                     chief_complaint, started_at, ended_at"#,
        id,
        at
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Display names of members of this clinic, by membership id.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn member_names(
    conn: &mut PgConnection,
    ids: &[Uuid],
) -> Result<Vec<(Uuid, String)>, DbError> {
    let rows = sqlx::query!(
        r#"select m.id, u.display_name
           from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
           where m.id = any($1)"#,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.id, row.display_name))
        .collect())
}

/// A clinical note as stored.
#[derive(Debug, Clone)]
pub struct NoteRow {
    /// Identifier.
    pub id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The author's membership.
    pub author_id: Uuid,
    /// `soap`, `progress`, `procedure`, `intake` or `front_desk`.
    pub kind: String,
    /// Sections as JSON.
    pub body: serde_json::Value,
    /// `typed`, `voice` or `ai_draft`.
    pub source: String,
    /// `draft`, `signed`, `conflict` or `entered_in_error`.
    pub status: String,
    /// When it was signed.
    pub signed_at: Option<OffsetDateTime>,
    /// Who signed it.
    pub signed_by: Option<Uuid>,
    /// The note it collided with during sync.
    pub conflicts_with_id: Option<Uuid>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// When it was marked.
    pub error_at: Option<OffsetDateTime>,
    /// When it was written.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
    /// Goes up when the note changes; edits send it back to detect a stale copy.
    pub row_version: i64,
}

/// Values for a new draft note.
#[derive(Debug, Clone)]
pub struct NewNote<'a> {
    /// Identifier chosen by the API.
    pub id: Uuid,
    /// The visit.
    pub encounter_id: Uuid,
    /// The visit's patient.
    pub patient_id: Uuid,
    /// The author's membership.
    pub author_id: Uuid,
    /// Kind value.
    pub kind: &'a str,
    /// Source value.
    pub source: &'a str,
    /// Sections as JSON.
    pub body: &'a serde_json::Value,
}

/// Inserts a draft note.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_note(conn: &mut PgConnection, new: &NewNote<'_>) -> Result<NoteRow, DbError> {
    let row = sqlx::query_as!(
        NoteRow,
        r#"insert into aarogyam.clinical_notes (id, encounter_id, patient_id, author_id, kind, source, body)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id, encounter_id, patient_id, author_id, kind, body, source, status, signed_at,
                     signed_by, conflicts_with_id, error_reason, error_at, created_at, updated_at, row_version"#,
        new.id,
        new.encounter_id,
        new.patient_id,
        new.author_id,
        new.kind,
        new.source,
        new.body
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The note with `id`, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_note_for_update(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<NoteRow>, DbError> {
    let row = sqlx::query_as!(
        NoteRow,
        r#"select id, encounter_id, patient_id, author_id, kind, body, source, status, signed_at,
                  signed_by, conflicts_with_id, error_reason, error_at, created_at, updated_at, row_version
           from aarogyam.clinical_notes
           where id = $1 and app.clinical_in_reach(author_id, created_by, encounter_id, $2)
           for update"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks a draft as written by voice, once a recording is kept with it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_note_voice(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.clinical_notes set source = 'voice' where id = $1 and status = 'draft'",
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A visit's notes, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_notes(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<NoteRow>, DbError> {
    let rows = sqlx::query_as!(
        NoteRow,
        r#"select id, encounter_id, patient_id, author_id, kind, body, source, status, signed_at,
                  signed_by, conflicts_with_id, error_reason, error_at, created_at, updated_at, row_version
           from aarogyam.clinical_notes where encounter_id = $1
           order by created_at, id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Replaces a draft's sections. The freeze trigger refuses it once the note is signed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_note_body(
    conn: &mut PgConnection,
    id: Uuid,
    kind: &str,
    body: &serde_json::Value,
) -> Result<NoteRow, DbError> {
    let row = sqlx::query_as!(
        NoteRow,
        r#"update aarogyam.clinical_notes set kind = $2, body = $3 where id = $1
           returning id, encounter_id, patient_id, author_id, kind, body, source, status, signed_at,
                     signed_by, conflicts_with_id, error_reason, error_at, created_at, updated_at, row_version"#,
        id,
        kind,
        body
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Signs a note; from then on the freeze trigger keeps it as it is.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn sign_note(
    conn: &mut PgConnection,
    id: Uuid,
    signed_by: Uuid,
    at: OffsetDateTime,
) -> Result<NoteRow, DbError> {
    let row = sqlx::query_as!(
        NoteRow,
        r#"update aarogyam.clinical_notes set status = 'signed', signed_at = $3, signed_by = $2
           where id = $1
           returning id, encounter_id, patient_id, author_id, kind, body, source, status, signed_at,
                     signed_by, conflicts_with_id, error_reason, error_at, created_at, updated_at, row_version"#,
        id,
        signed_by,
        at
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Marks a note entered in error, with a reason. The note itself stays.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_note_in_error(
    conn: &mut PgConnection,
    id: Uuid,
    by: Uuid,
    reason: &str,
    at: OffsetDateTime,
) -> Result<NoteRow, DbError> {
    let row = sqlx::query_as!(
        NoteRow,
        r#"update aarogyam.clinical_notes
           set status = 'entered_in_error', error_reason = $3, error_at = $4, error_by = $2
           where id = $1
           returning id, encounter_id, patient_id, author_id, kind, body, source, status, signed_at,
                     signed_by, conflicts_with_id, error_reason, error_at, created_at, updated_at, row_version"#,
        id,
        by,
        reason,
        at
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// An addendum as stored.
#[derive(Debug, Clone)]
pub struct AddendumRow {
    /// Identifier.
    pub id: Uuid,
    /// The note.
    pub note_id: Uuid,
    /// The author's membership.
    pub author_id: Uuid,
    /// The text.
    pub body: String,
    /// When it was added.
    pub created_at: OffsetDateTime,
}

/// Appends an addendum to a note.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_addendum(
    conn: &mut PgConnection,
    id: Uuid,
    note_id: Uuid,
    author_id: Uuid,
    body: &str,
) -> Result<AddendumRow, DbError> {
    let row = sqlx::query_as!(
        AddendumRow,
        r#"insert into aarogyam.note_addenda (id, note_id, author_id, body) values ($1, $2, $3, $4)
           returning id, note_id, author_id, body, created_at"#,
        id,
        note_id,
        author_id,
        body
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The addendum with `id` in this clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_addendum(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<AddendumRow>, DbError> {
    let row = sqlx::query_as!(
        AddendumRow,
        r#"select id, note_id, author_id, body, created_at from aarogyam.note_addenda where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The addenda of these notes, oldest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_addenda(
    conn: &mut PgConnection,
    note_ids: &[Uuid],
) -> Result<Vec<AddendumRow>, DbError> {
    let rows = sqlx::query_as!(
        AddendumRow,
        r#"select id, note_id, author_id, body, created_at from aarogyam.note_addenda
           where note_id = any($1) order by created_at, id"#,
        note_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One row of the access record, naming the record that was opened.
#[derive(Debug, Clone)]
pub struct Access<'a> {
    /// Who opened it.
    pub actor_user_id: Uuid,
    /// `staff`, `patient` or `support`.
    pub actor_kind: &'a str,
    /// Whose record.
    pub patient_id: Uuid,
    /// `chart`, `visit`, `note`, `attachment` and so on.
    pub resource: &'a str,
    /// The record opened.
    pub resource_id: Option<Uuid>,
    /// `view`, `download`, `print`, `share` or `export`.
    pub action: &'a str,
    /// Why.
    pub purpose: &'a str,
    /// The request, for tracing.
    pub request_id: Option<&'a str>,
}

/// Appends to the access record in the current clinic transaction.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_access(conn: &mut PgConnection, entry: &Access<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into audit.access_log
             (actor_user_id, actor_kind, patient_id, resource, resource_id, action, purpose, request_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        entry.actor_user_id,
        entry.actor_kind,
        entry.patient_id,
        entry.resource,
        entry.resource_id,
        entry.action,
        entry.purpose,
        entry.request_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// An addendum as the note query returns it inside JSON.
#[derive(Debug, serde::Deserialize)]
struct AddendumJson {
    id: Uuid,
    note_id: Uuid,
    author_id: Uuid,
    body: String,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

/// A note with its addenda and the display names of everyone who wrote or signed on it.
#[derive(Debug, Clone)]
pub struct NoteBundle {
    /// The note.
    pub note: NoteRow,
    /// Its addenda, oldest first.
    pub addenda: Vec<AddendumRow>,
    /// Display names by membership: the author and the addenda's authors.
    pub names: Vec<(Uuid, String)>,
}

/// One note with its addenda and names, in a single statement and without a lock: the read a
/// repeated request needs to answer from.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_note_bundle(
    conn: &mut PgConnection,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<NoteBundle>, DbError> {
    let row = sqlx::query!(
        r#"select n.id, n.encounter_id, n.patient_id, n.author_id, n.kind, n.body, n.source,
                  n.status, n.signed_at, n.signed_by, n.conflicts_with_id, n.error_reason,
                  n.error_at, n.created_at, n.updated_at, n.row_version,
                  (select coalesce(jsonb_agg(jsonb_build_object(
                              'id', a.id, 'note_id', a.note_id, 'author_id', a.author_id,
                              'body', a.body, 'created_at', a.created_at)
                              order by a.created_at, a.id), '[]'::jsonb)
                   from aarogyam.note_addenda a where a.note_id = n.id
                  ) as "addenda!: Json<Vec<AddendumJson>>",
                  (select coalesce(jsonb_agg(jsonb_build_array(m.id, u.display_name)), '[]'::jsonb)
                   from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
                   where m.id = n.author_id
                      or m.id in (select a.author_id from aarogyam.note_addenda a
                                  where a.note_id = n.id)
                  ) as "names!: Json<Vec<(Uuid, String)>>"
           from aarogyam.clinical_notes n
           where n.id = $1 and app.clinical_in_reach(n.author_id, n.created_by, n.encounter_id, $2)"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| NoteBundle {
        note: NoteRow {
            id: row.id,
            encounter_id: row.encounter_id,
            patient_id: row.patient_id,
            author_id: row.author_id,
            kind: row.kind,
            body: row.body,
            source: row.source,
            status: row.status,
            signed_at: row.signed_at,
            signed_by: row.signed_by,
            conflicts_with_id: row.conflicts_with_id,
            error_reason: row.error_reason,
            error_at: row.error_at,
            created_at: row.created_at,
            updated_at: row.updated_at,
            row_version: row.row_version,
        },
        addenda: row
            .addenda
            .0
            .into_iter()
            .map(|a| AddendumRow {
                id: a.id,
                note_id: a.note_id,
                author_id: a.author_id,
                body: a.body,
                created_at: a.created_at,
            })
            .collect(),
        names: row.names.0,
    }))
}
