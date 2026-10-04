//! Patient queries. Every function takes the connection of an open clinic transaction, so
//! row-level security limits it to that clinic; none adds its own `org_id` filter. Names are
//! schema-qualified because the API role has an empty `search_path`.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A patient as stored.
#[derive(Debug, Clone)]
pub struct PatientRow {
    /// Identifier.
    pub id: Uuid,
    /// Readable number, such as `SD-1042`.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Date of birth, exact or estimated.
    pub date_of_birth: Option<Date>,
    /// Whether the date of birth was estimated from an age.
    pub birth_date_estimated: bool,
    /// Contact phone in `E.164`.
    pub phone_e164: Option<String>,
    /// Contact email.
    pub email: Option<String>,
    /// Language tag such as `en-IN`.
    pub preferred_language: String,
    /// `active`, `inactive`, `deceased` or `merged`.
    pub status: String,
    /// When the record was created.
    pub created_at: OffsetDateTime,
    /// The last visit, once visits exist.
    pub last_visit_at: Option<OffsetDateTime>,
}

/// Values for a new patient row. The caller has validated them in the domain layer.
#[derive(Debug, Clone)]
pub struct NewPatientRow<'a> {
    /// Identifier chosen by the API (a version 7 UUID).
    pub id: Uuid,
    /// The number issued by [`next_number`].
    pub number: &'a str,
    /// Normalised full name.
    pub full_name: &'a str,
    /// Sex value.
    pub sex: &'a str,
    /// Date of birth.
    pub date_of_birth: Option<Date>,
    /// Whether it was estimated from an age.
    pub birth_date_estimated: bool,
    /// Phone in `E.164`.
    pub phone_e164: Option<&'a str>,
    /// Lower-cased email.
    pub email: Option<&'a str>,
    /// Language tag.
    pub preferred_language: &'a str,
}

/// Issues the next number of `kind` for the current clinic (`app.next_number`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn next_number(conn: &mut PgConnection, kind: &str) -> Result<i64, DbError> {
    let value = sqlx::query_scalar!(r#"select app.next_number($1) as "value!""#, kind)
        .fetch_one(conn)
        .await?;
    Ok(value)
}

/// Inserts a patient into the current clinic and returns the stored row.
///
/// # Errors
/// [`DbError`] on a database failure, including a duplicate number (a conflict).
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewPatientRow<'_>,
) -> Result<PatientRow, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"insert into aarogyam.patients
             (id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email, preferred_language)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                     preferred_language, status, created_at, last_visit_at"#,
        new.id,
        new.number,
        new.full_name,
        new.sex,
        new.date_of_birth,
        new.birth_date_estimated,
        new.phone_e164,
        new.email,
        new.preferred_language
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The patient with `id` in the current clinic, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The patient with `id` in the current clinic, unless deleted, locked until the transaction
/// ends so a concurrent edit can't overwrite this one's changes.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where id = $1 and deleted_at is null
           for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A patient's editable details, all of them, as they should be stored. The caller has
/// validated them in the domain layer.
#[derive(Debug, Clone)]
pub struct PatientDetails<'a> {
    /// Normalised full name.
    pub full_name: &'a str,
    /// Sex value.
    pub sex: &'a str,
    /// Date of birth.
    pub date_of_birth: Option<Date>,
    /// Whether it was estimated from an age.
    pub birth_date_estimated: bool,
    /// Phone in `E.164`.
    pub phone_e164: Option<&'a str>,
    /// Lower-cased email.
    pub email: Option<&'a str>,
    /// Language tag.
    pub preferred_language: &'a str,
}

/// Saves a patient's details and returns the stored row. The change history records what
/// changed through the table's audit trigger.
///
/// # Errors
/// [`DbError`] on a database failure; [`sakalya_db::DbErrorKind::NotFound`] when the patient
/// is not in this clinic.
pub async fn update(
    conn: &mut PgConnection,
    id: Uuid,
    details: &PatientDetails<'_>,
) -> Result<PatientRow, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"update aarogyam.patients
           set full_name = $2, sex = $3, date_of_birth = $4, birth_date_estimated = $5,
               phone_e164 = $6, email = $7, preferred_language = $8
           where id = $1 and deleted_at is null
           returning id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                     preferred_language, status, created_at, last_visit_at"#,
        id,
        details.full_name,
        details.sex,
        details.date_of_birth,
        details.birth_date_estimated,
        details.phone_e164,
        details.email,
        details.preferred_language
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The patient with this readable number in the current clinic, unless deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn find_by_number(
    conn: &mut PgConnection,
    number: &str,
) -> Result<Option<PatientRow>, DbError> {
    let row = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where number = $1 and deleted_at is null"#,
        number
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Patients whose main or alternate phone is exactly `phone_e164`. Families share numbers,
/// so this can return several.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_phone(
    conn: &mut PgConnection,
    phone_e164: &str,
    limit: i64,
) -> Result<Vec<PatientRow>, DbError> {
    let rows = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where (phone_e164 = $1 or alt_phone_e164 = $1) and deleted_at is null
           order by full_name
           limit $2"#,
        phone_e164,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Patients whose normalised name starts with `prefix` (already normalised like
/// `search_name`), using the `C`-collation index.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_name_prefix(
    conn: &mut PgConnection,
    prefix: &str,
    limit: i64,
) -> Result<Vec<PatientRow>, DbError> {
    let rows = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where (search_name collate "C") ^@ $1 and deleted_at is null
           order by search_name collate "C"
           limit $2"#,
        prefix,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Patients whose name is similar to `query` (typos, missing letters), best first, through
/// `app.search_patients`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_fuzzy(
    conn: &mut PgConnection,
    query: &str,
    limit: i32,
) -> Result<Vec<Uuid>, DbError> {
    let ids = sqlx::query_scalar!(
        r#"select id as "id!" from app.search_patients($1, $2)"#,
        query,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(ids)
}

/// Loads several patients by id, keeping the given order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_many(conn: &mut PgConnection, ids: &[Uuid]) -> Result<Vec<PatientRow>, DbError> {
    let rows = sqlx::query_as!(
        PatientRow,
        r#"select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated, p.phone_e164,
                  p.email, p.preferred_language, p.status, p.created_at, p.last_visit_at
           from unnest($1::uuid[]) with ordinality as wanted(id, position)
           join aarogyam.patients p on p.id = wanted.id
           where p.deleted_at is null
           order by wanted.position"#,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One row of the access record: someone opened a patient's record.
#[derive(Debug, Clone)]
pub struct AccessEntry<'a> {
    /// Who opened it.
    pub actor_user_id: Uuid,
    /// `staff`, `patient` or `support`.
    pub actor_kind: &'a str,
    /// Whose record.
    pub patient_id: Uuid,
    /// What part: `chart`, `note`, `attachment`, `prescription`, `invoice` or `export`.
    pub resource: &'a str,
    /// `view`, `download`, `print`, `share` or `export`.
    pub action: &'a str,
    /// Why: `care`, `front_desk`, `billing`, `support`, `patient_self` or `export`.
    pub purpose: &'a str,
    /// The request, for tracing.
    pub request_id: Option<&'a str>,
}

/// Appends to the access record in the current clinic transaction.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_access(
    conn: &mut PgConnection,
    entry: &AccessEntry<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into audit.access_log (actor_user_id, actor_kind, patient_id, resource, action, purpose, request_id)
           values ($1, $2, $3, $4, $5, $6, $7)"#,
        entry.actor_user_id,
        entry.actor_kind,
        entry.patient_id,
        entry.resource,
        entry.action,
        entry.purpose,
        entry.request_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The most recently registered patients in the current clinic, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn recent(conn: &mut PgConnection, limit: i64) -> Result<Vec<PatientRow>, DbError> {
    let rows = sqlx::query_as!(
        PatientRow,
        r#"select id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                  preferred_language, status, created_at, last_visit_at
           from aarogyam.patients
           where deleted_at is null
           order by created_at desc
           limit $1"#,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
