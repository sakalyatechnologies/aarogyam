//! The dental chart, stored as `specialty_records` rows of module `dental`, kind `tooth`.
//! Entries are never edited: a new entry supersedes the current one for its tooth and surface.

use sakalya_db::DbError;

use crate::visits::ClientRecord;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A chart entry as stored.
#[derive(Debug, Clone)]
pub struct ChartRow {
    /// Identifier.
    pub id: Uuid,
    /// The visit that recorded it.
    pub encounter_id: Option<Uuid>,
    /// FDI tooth number (generated from the data).
    pub tooth: Option<i16>,
    /// The entry as JSON: tooth, surface, finding, note.
    pub data: serde_json::Value,
    /// `current`, `superseded` or `entered_in_error`.
    pub status: String,
    /// The entry it replaced.
    pub supersedes_id: Option<Uuid>,
    /// When the finding was made.
    pub effective_at: OffsetDateTime,
    /// The member who recorded it.
    pub verified_by: Option<Uuid>,
}

/// Values for a new entry.
#[derive(Debug, Clone)]
pub struct NewChartRow<'a> {
    /// Identifier chosen by the API.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit, if any.
    pub encounter_id: Option<Uuid>,
    /// Module, such as `dental`.
    pub module: &'a str,
    /// Kind, such as `tooth`.
    pub kind: &'a str,
    /// Version of the data's shape.
    pub schema_version: i32,
    /// The entry as JSON.
    pub data: &'a serde_json::Value,
    /// The entry it replaces.
    pub supersedes_id: Option<Uuid>,
    /// When the finding was made.
    pub effective_at: OffsetDateTime,
    /// Source value.
    pub source: &'a str,
    /// The member recording it.
    pub verified_by: Uuid,
    /// The client's id for the batch this entry opens, so a retry finds it.
    pub client_id: Option<Uuid>,
    /// Hash of the request that carried `client_id`.
    pub request_hash: Option<&'a str>,
}

/// The chart entry the client's id made, if any, in this clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn by_client_id(
    conn: &mut PgConnection,
    client_id: Uuid,
) -> Result<Option<ClientRecord>, DbError> {
    let row = sqlx::query!(
        r#"select id, patient_id, request_hash as "request_hash!"
           from aarogyam.specialty_records
           where client_id = $1 and module = 'dental' and kind = 'tooth'"#,
        client_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| ClientRecord {
        id: row.id,
        patient_id: row.patient_id,
        request_hash: row.request_hash,
    }))
}

/// The patient's current entries for a tooth, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn current_for_tooth(
    conn: &mut PgConnection,
    patient_id: Uuid,
    tooth: i16,
) -> Result<Vec<ChartRow>, DbError> {
    let rows = sqlx::query_as!(
        ChartRow,
        r#"select id, encounter_id, tooth, data, status, supersedes_id, effective_at, verified_by
           from aarogyam.specialty_records
           where patient_id = $1 and module = 'dental' and kind = 'tooth' and tooth = $2
             and status = 'current'
           for update"#,
        patient_id,
        tooth
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One of the patient's dental chart entries by id, locked until the transaction ends; none
/// when it isn't this patient's (or this clinic's).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn entry_for_update(
    conn: &mut PgConnection,
    patient_id: Uuid,
    id: Uuid,
) -> Result<Option<ChartRow>, DbError> {
    let row = sqlx::query_as!(
        ChartRow,
        r#"select id, encounter_id, tooth, data, status, supersedes_id, effective_at, verified_by
           from aarogyam.specialty_records
           where id = $1 and patient_id = $2 and module = 'dental' and kind = 'tooth'
           for update"#,
        id,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Marks a current entry superseded. The freeze trigger refuses any other change.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn supersede(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.specialty_records set status = 'superseded'
           where id = $1 and status = 'current'"#,
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Inserts an entry as the current one for its key.
///
/// # Errors
/// [`DbError`] on a database failure; a conflict when another current entry exists for the
/// same tooth and surface, or the visit belongs to another patient.
pub async fn insert(conn: &mut PgConnection, new: &NewChartRow<'_>) -> Result<ChartRow, DbError> {
    let row = sqlx::query_as!(
        ChartRow,
        r#"insert into aarogyam.specialty_records
             (id, patient_id, encounter_id, module, kind, schema_version, data, supersedes_id,
              effective_at, source, verified_by, verified_at, client_id, request_hash)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $13)
           returning id, encounter_id, tooth, data, status, supersedes_id, effective_at, verified_by"#,
        new.id,
        new.patient_id,
        new.encounter_id,
        new.module,
        new.kind,
        new.schema_version,
        new.data,
        new.supersedes_id,
        new.effective_at,
        new.source,
        new.verified_by,
        new.client_id,
        new.request_hash
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The patient's current chart, by tooth and surface.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn current(conn: &mut PgConnection, patient_id: Uuid) -> Result<Vec<ChartRow>, DbError> {
    let rows = sqlx::query_as!(
        ChartRow,
        r#"select id, encounter_id, tooth, data, status, supersedes_id, effective_at, verified_by
           from aarogyam.specialty_records
           where patient_id = $1 and module = 'dental' and kind = 'tooth' and status = 'current'
           order by tooth, surface nulls first"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Every entry ever recorded for one tooth, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn history(
    conn: &mut PgConnection,
    patient_id: Uuid,
    tooth: i16,
) -> Result<Vec<ChartRow>, DbError> {
    let rows = sqlx::query_as!(
        ChartRow,
        r#"select id, encounter_id, tooth, data, status, supersedes_id, effective_at, verified_by
           from aarogyam.specialty_records
           where patient_id = $1 and module = 'dental' and kind = 'tooth' and tooth = $2
           order by effective_at desc, id desc"#,
        patient_id,
        tooth
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The entries recorded in a visit, in order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn of_encounter(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<ChartRow>, DbError> {
    let rows = sqlx::query_as!(
        ChartRow,
        r#"select id, encounter_id, tooth, data, status, supersedes_id, effective_at, verified_by
           from aarogyam.specialty_records
           where encounter_id = $1 and module = 'dental' and kind = 'tooth'
           order by effective_at, id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
