//! Smart import: sessions holding an uploaded file's rows, the clinic's remembered column
//! headers, the commit's writes, and the to-do list of patients imported without some
//! details. Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A session to open.
#[derive(Debug, Clone)]
pub struct NewSession<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The file's name as uploaded.
    pub file_name: &'a str,
    /// `csv` or `xlsx`.
    pub file_kind: &'a str,
    /// SHA-256 of the bytes, hex.
    pub file_sha256: &'a str,
    /// Size in bytes.
    pub size_bytes: i32,
    /// A workbook's sheets.
    pub sheet_names: &'a [String],
    /// The sheet read.
    pub sheet_name: Option<&'a str>,
    /// Row of the file holding the headers.
    pub header_row: i32,
    /// The headers.
    pub headers: &'a [String],
    /// The data rows, `[[row, [cell, ...]], ...]`.
    pub cells: &'a Value,
    /// How many data rows.
    pub row_count: i32,
    /// The stored original file's identifier (also its name in storage).
    pub file_id: Uuid,
    /// Its media type.
    pub mime_type: &'a str,
}

/// A remembered header: its key and the field it meant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Remembered {
    /// The normalised header.
    pub header_key: String,
    /// Our field.
    pub field: String,
}

/// Opens a session, ending the clinic's expired ones on the way (their cells are cleared), and
/// returns what the clinic remembered for any of `header_keys`, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn open(
    conn: &mut PgConnection,
    session: &NewSession<'_>,
    header_keys: &[String],
) -> Result<Vec<Remembered>, DbError> {
    let rows = sqlx::query_as!(
        Remembered,
        r#"with expired as (
             update aarogyam.import_sessions set status = 'expired', cells = null
             where status = 'open' and expires_at < now()
             returning id
           ), created as (
             insert into aarogyam.import_sessions
               (id, file_name, file_kind, file_sha256, size_bytes, sheet_names, sheet_name,
                header_row, headers, cells, row_count)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             returning id
           ), stored as (
             insert into aarogyam.import_files (id, session_id, file_name, mime_type, size_bytes, sha256)
             values ($13, $1, $2, $14, $5, $4)
             returning id
           )
           select m.header_key as "header_key!", m.field as "field!"
           from aarogyam.import_column_memory m
           where m.header_key = any($12)"#,
        session.id,
        session.file_name,
        session.file_kind,
        session.file_sha256,
        session.size_bytes,
        session.sheet_names,
        session.sheet_name,
        session.header_row,
        session.headers,
        session.cells,
        session.row_count,
        header_keys,
        session.file_id,
        session.mime_type
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A session as stored.
#[derive(Debug, Clone)]
pub struct SessionRow {
    /// Identifier.
    pub id: Uuid,
    /// The file's name.
    pub file_name: String,
    /// `csv` or `xlsx`.
    pub file_kind: String,
    /// The sheet read.
    pub sheet_name: Option<String>,
    /// The headers.
    pub headers: Vec<String>,
    /// The data rows, while open.
    pub cells: Option<Value>,
    /// `open`, `committed`, `discarded` or `expired`.
    pub status: String,
    /// The import, once committed.
    pub import_id: Option<Uuid>,
    /// Whether it is past its expiry.
    pub expired: bool,
}

/// A session.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn find(conn: &mut PgConnection, id: Uuid) -> Result<Option<SessionRow>, DbError> {
    let row = sqlx::query_as!(
        SessionRow,
        r#"select id, file_name, file_kind, sheet_name, headers, cells, status, import_id,
                  expires_at < now() as "expired!"
           from aarogyam.import_sessions where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A session, locked until the transaction ends, so two commits of one file run one after
/// the other and the second finds the first's import.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(conn: &mut PgConnection, id: Uuid) -> Result<Option<SessionRow>, DbError> {
    let row = sqlx::query_as!(
        SessionRow,
        r#"select id, file_name, file_kind, sheet_name, headers, cells, status, import_id,
                  expires_at < now() as "expired!"
           from aarogyam.import_sessions where id = $1
           for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Ends an open session, clearing its cells. Returns whether the session exists at all (an
/// ended one is left as it is).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn discard(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"with ended as (
             update aarogyam.import_sessions set status = 'discarded', cells = null
             where id = $1 and status = 'open'
             returning id
           )
           select exists (select 1 from ended)
               or exists (select 1 from aarogyam.import_sessions where id = $1) as "found!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// An existing patient or identifier that rows of a file match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    /// `person` (same phone and name), `file_number` or `legacy`.
    pub kind: String,
    /// For `person`, `phone|name`; otherwise the identifier.
    pub value: String,
    /// The patient.
    pub patient_id: Uuid,
    /// Their number.
    pub number: String,
}

/// Patients with the same phone and name (lower case, single spaces) as any pair in
/// `phones` and `names`, and patients already holding any of the file numbers or legacy IDs.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn matches(
    conn: &mut PgConnection,
    phones: &[String],
    names: &[String],
    file_numbers: &[String],
    legacy_ids: &[String],
) -> Result<Vec<Match>, DbError> {
    let rows = sqlx::query_as!(
        Match,
        r#"select 'person' as "kind!", w.phone || '|' || w.name as "value!", p.id as "patient_id!",
                  p.number as "number!"
           from unnest($1::text[], $2::text[]) as w(phone, name)
           join aarogyam.patients p on p.phone_e164 = w.phone and p.search_name = w.name
           where p.deleted_at is null and p.status <> 'merged'
           union all
           select i.kind, i.value, i.patient_id, p.number
           from aarogyam.patient_identifiers i
           join aarogyam.patients p on p.org_id = i.org_id and p.id = i.patient_id
           where i.deleted_at is null
             and ((i.kind = 'file_number' and i.value = any($3))
                  or (i.kind = 'legacy' and i.value = any($4)))"#,
        phones,
        names,
        file_numbers,
        legacy_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Imported patients, one entry per patient in every column. Validated by the caller.
#[derive(Debug, Clone, Default)]
pub struct ImportedPatients {
    /// Identifiers.
    pub ids: Vec<Uuid>,
    /// Numbers.
    pub numbers: Vec<String>,
    /// Names.
    pub full_names: Vec<String>,
    /// Sex values.
    pub sexes: Vec<String>,
    /// Dates of birth.
    pub dates_of_birth: Vec<Option<Date>>,
    /// Whether each date was estimated from an age.
    pub estimated: Vec<bool>,
    /// Phones in `E.164`.
    pub phones: Vec<Option<String>>,
    /// Emails.
    pub emails: Vec<Option<String>>,
    /// Language tags.
    pub languages: Vec<String>,
    /// Addresses, as `{"text": ...}`.
    pub addresses: Vec<Option<Value>>,
    /// Last visits.
    pub last_visits: Vec<Option<OffsetDateTime>>,
}

/// Inserts the patients in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_patients(
    conn: &mut PgConnection,
    patients: &ImportedPatients,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.patients
             (id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
              preferred_language, address, last_visit_at)
           select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::date[],
                                $6::bool[], $7::text[], $8::text[], $9::text[], $10::jsonb[],
                                $11::timestamptz[])"#,
        &patients.ids,
        &patients.numbers,
        &patients.full_names,
        &patients.sexes,
        &patients.dates_of_birth as &[Option<Date>],
        &patients.estimated,
        &patients.phones as &[Option<String>],
        &patients.emails as &[Option<String>],
        &patients.languages,
        &patients.addresses as &[Option<Value>],
        &patients.last_visits as &[Option<OffsetDateTime>]
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Fills empty details of existing patients from imported rows, in one statement. Never
/// overwrites a recorded value: sex only when unknown, the rest only when blank.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn fill_patients(
    conn: &mut PgConnection,
    patients: &ImportedPatients,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.patients p set
             sex = case when p.sex = 'unknown' then w.sex else p.sex end,
             birth_date_estimated = case when p.date_of_birth is null and w.date_of_birth is not null
                                         then w.estimated else p.birth_date_estimated end,
             date_of_birth = coalesce(p.date_of_birth, w.date_of_birth),
             email = coalesce(p.email, w.email),
             address = coalesce(p.address, w.address),
             last_visit_at = coalesce(p.last_visit_at, w.last_visit)
           from unnest($1::uuid[], $2::text[], $3::date[], $4::bool[], $5::text[], $6::jsonb[],
                       $7::timestamptz[])
                as w(id, sex, date_of_birth, estimated, email, address, last_visit)
           where p.id = w.id"#,
        &patients.ids,
        &patients.sexes,
        &patients.dates_of_birth as &[Option<Date>],
        &patients.estimated,
        &patients.emails as &[Option<String>],
        &patients.addresses as &[Option<Value>],
        &patients.last_visits as &[Option<OffsetDateTime>]
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// What a commit records, beyond the patients.
#[derive(Debug, Clone, Default)]
pub struct Finish {
    /// The import.
    pub import_id: Uuid,
    /// The session it came from.
    pub session_id: Uuid,
    /// `csv` or `xlsx`.
    pub source: String,
    /// The file's name.
    pub file_name: String,
    /// The sheet.
    pub sheet_name: Option<String>,
    /// Our field to the file's column header.
    pub mapping: Value,
    /// Counts: total, imported, failed, skipped, merged, incomplete.
    pub counts: [i32; 6],
    /// Each row's number in the file.
    pub row_numbers: Vec<i32>,
    /// `imported`, `failed`, `skipped` or `merged`.
    pub statuses: Vec<String>,
    /// Why a row failed or was skipped.
    pub errors: Vec<Option<String>>,
    /// The patient a row became or was merged into.
    pub patient_ids: Vec<Option<Uuid>>,
    /// The opening-balance bill a row made.
    pub opening_invoices: Vec<Option<Uuid>>,
    /// Its amount in paise.
    pub opening_paise: Vec<Option<i64>>,
    /// Patients with missing details.
    pub gap_patients: Vec<Uuid>,
    /// Their rows.
    pub gap_rows: Vec<i32>,
    /// What each lacks, comma-separated.
    pub gap_missing: Vec<String>,
    /// Headers to remember, as keys.
    pub memory_keys: Vec<String>,
    /// The field each meant.
    pub memory_fields: Vec<String>,
}

/// Records the import, its rows and the to-do entries, remembers the mapping and ends the
/// session (clearing its cells), in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn finish(conn: &mut PgConnection, finish: &Finish) -> Result<(), DbError> {
    let [total, imported, failed, skipped, merged, incomplete] = finish.counts;
    sqlx::query!(
        r#"with created as (
             insert into aarogyam.imports
               (id, kind, source, mapping, total_rows, imported_rows, failed_rows, skipped_rows,
                merged_rows, incomplete_rows, session_id, file_name, sheet_name)
             values ($1, 'patients', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             returning id
           ), recorded as (
             insert into aarogyam.import_rows
               (import_id, row_number, raw, status, error, patient_id, opening_invoice_id, opening_paise)
             select (select id from created), r.n, '{}'::jsonb, r.status, r.error, r.patient_id,
                    r.invoice_id, r.paise
             from unnest($13::int[], $14::text[], $15::text[], $16::uuid[], $22::uuid[], $23::bigint[])
               as r(n, status, error, patient_id, invoice_id, paise)
           ), gaps as (
             insert into aarogyam.patient_gaps (patient_id, import_id, row_number, missing)
             select g.patient_id, (select id from created), g.n, string_to_array(g.missing, ',')
             from unnest($17::uuid[], $18::int[], $19::text[]) as g(patient_id, n, missing)
           ), remembered as (
             insert into aarogyam.import_column_memory (header_key, field)
             select * from unnest($20::text[], $21::text[])
             on conflict (org_id, header_key) do update set field = excluded.field
           )
           update aarogyam.import_sessions
           set status = 'committed', cells = null, import_id = (select id from created)
           where id = $10"#,
        finish.import_id,
        finish.source,
        finish.mapping,
        total,
        imported,
        failed,
        skipped,
        merged,
        incomplete,
        finish.session_id,
        finish.file_name,
        finish.sheet_name,
        &finish.row_numbers,
        &finish.statuses,
        &finish.errors as &[Option<String>],
        &finish.patient_ids as &[Option<Uuid>],
        &finish.gap_patients,
        &finish.gap_rows,
        &finish.gap_missing,
        &finish.memory_keys,
        &finish.memory_fields,
        &finish.opening_invoices as &[Option<Uuid>],
        &finish.opening_paise as &[Option<i64>]
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// One recorded row of a committed import.
#[derive(Debug, Clone)]
pub struct RecordedRow {
    /// Row in the file.
    pub row_number: i32,
    /// `imported`, `failed`, `skipped` or `merged`.
    pub status: String,
    /// Why it failed or was skipped.
    pub error: Option<String>,
    /// The patient.
    pub patient_id: Option<Uuid>,
    /// Their number.
    pub number: Option<String>,
    /// Whether the patient was imported with details missing.
    pub incomplete: bool,
    /// The amount in paise of the opening-balance bill the row made.
    pub opening_paise: Option<i64>,
}

/// The rows of an import, in file order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn recorded_rows(
    conn: &mut PgConnection,
    import_id: Uuid,
) -> Result<Vec<RecordedRow>, DbError> {
    let rows = sqlx::query_as!(
        RecordedRow,
        r#"select r.row_number, r.status, r.error, r.patient_id, p.number as "number?",
                  r.opening_paise,
                  exists (select 1 from aarogyam.patient_gaps g
                          where g.import_id = r.import_id and g.row_number = r.row_number) as "incomplete!"
           from aarogyam.import_rows r
           left join aarogyam.patients p on p.org_id = r.org_id and p.id = r.patient_id
           where r.import_id = $1
           order by r.row_number"#,
        import_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A patient on the to-do list.
#[derive(Debug, Clone)]
pub struct GapRow {
    /// The entry; `None` for a patient registered here rather than imported.
    pub id: Option<Uuid>,
    /// The patient.
    pub patient_id: Uuid,
    /// Their number.
    pub number: String,
    /// Their name.
    pub full_name: String,
    /// What is still missing.
    pub missing: Vec<String>,
    /// The file they came from.
    pub file_name: Option<String>,
    /// Its sheet.
    pub sheet_name: Option<String>,
    /// Their row in it.
    pub row_number: Option<i32>,
    /// When they were imported; `None` for a patient registered here.
    pub imported_at: Option<OffsetDateTime>,
}

/// Patients still missing details, at most `limit`, within `member`'s reach: imported ones
/// (oldest import first; details filled in since no longer count, dismissed entries are left
/// out), then patients registered here with no age (no date of birth) or no sex, oldest first.
/// A patient with any import entry, even a dismissed one, appears only through it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn open_gaps(
    conn: &mut PgConnection,
    limit: i64,
    member: Option<Uuid>,
) -> Result<Vec<GapRow>, DbError> {
    let rows = sqlx::query_as!(
        GapRow,
        r#"select id, patient_id as "patient_id!", number as "number!", full_name as "full_name!",
                  missing as "missing!", file_name, sheet_name, row_number, imported_at
           from (
             select g.id, g.patient_id, p.number, p.full_name, s.missing, i.file_name, i.sheet_name,
                    g.row_number, g.created_at as imported_at, 0 as source, g.created_at as at
             from aarogyam.patient_gaps g
             join aarogyam.patients p on p.org_id = g.org_id and p.id = g.patient_id
             join aarogyam.imports i on i.org_id = g.org_id and i.id = g.import_id
             cross join lateral (
               select array(
                 select m from unnest(g.missing) m
                 where (m = 'phone' and p.phone_e164 is null)
                    or (m = 'sex' and p.sex = 'unknown')
                    or (m = 'date_of_birth' and p.date_of_birth is null)
               ) as missing
             ) s
             where g.dismissed_at is null and p.deleted_at is null and cardinality(s.missing) > 0
               and app.patient_in_reach(p.id, $2)
             union all
             select null, p.id, p.number, p.full_name,
                    array_remove(array[case when p.sex = 'unknown' then 'sex' end,
                                       case when p.date_of_birth is null then 'date_of_birth' end], null),
                    null, null, null, null, 1, p.created_at
             from aarogyam.patients p
             where p.deleted_at is null and p.status = 'active'
               and (p.sex = 'unknown' or p.date_of_birth is null)
               and not exists (select 1 from aarogyam.patient_gaps g where g.org_id = p.org_id and g.patient_id = p.id)
               and app.patient_in_reach(p.id, $2)
           ) gaps
           order by source, at, row_number, number
           limit $1"#,
        limit,
        member
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Takes a patient off the to-do list. Returns whether the entry exists (dismissing twice is
/// fine).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn dismiss_gap(conn: &mut PgConnection, id: Uuid) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"with dismissed as (
             update aarogyam.patient_gaps set dismissed_at = now(), dismissed_by = app.user_id()
             where id = $1 and dismissed_at is null
             returning id
           )
           select exists (select 1 from dismissed)
               or exists (select 1 from aarogyam.patient_gaps where id = $1) as "found!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// The original file of a session, as stored (never its bytes or storage key).
#[derive(Debug, Clone)]
pub struct FileRow {
    /// Identifier, also the name of the bytes in storage.
    pub id: Uuid,
    /// The session it came with.
    pub session_id: Uuid,
    /// The name it was uploaded with.
    pub file_name: String,
    /// Its media type.
    pub mime_type: String,
    /// Its size.
    pub size_bytes: i64,
    /// When it was stored.
    pub stored_at: OffsetDateTime,
}

/// The original file of a session, if still kept.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn file(conn: &mut PgConnection, session_id: Uuid) -> Result<Option<FileRow>, DbError> {
    let row = sqlx::query_as!(
        FileRow,
        r#"select id, session_id, file_name, mime_type, size_bytes, created_at as stored_at
           from aarogyam.import_files where session_id = $1"#,
        session_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Deletes the original file's row, returning it so its bytes can be removed. `Ok(None)` with
/// `session_exists` true means it was already gone.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_file(
    conn: &mut PgConnection,
    session_id: Uuid,
) -> Result<(Option<FileRow>, bool), DbError> {
    let row = sqlx::query!(
        r#"with gone as (
             delete from aarogyam.import_files where session_id = $1
             returning id, session_id, file_name, mime_type, size_bytes, created_at
           )
           select g.id as "id?", g.session_id as "session_id?", g.file_name as "file_name?",
                  g.mime_type as "mime_type?", g.size_bytes as "size_bytes?",
                  g.created_at as "stored_at?",
                  exists (select 1 from aarogyam.import_sessions where id = $1) as "session_exists!"
           from (select 1) one left join gone g on true"#,
        session_id
    )
    .fetch_one(conn)
    .await?;
    let file = match (
        row.id,
        row.session_id,
        row.file_name,
        row.mime_type,
        row.size_bytes,
        row.stored_at,
    ) {
        (
            Some(id),
            Some(session_id),
            Some(file_name),
            Some(mime_type),
            Some(size_bytes),
            Some(stored_at),
        ) => Some(FileRow {
            id,
            session_id,
            file_name,
            mime_type,
            size_bytes,
            stored_at,
        }),
        _ => None,
    };
    Ok((file, row.session_exists))
}
