//! Vital-sign observations. Values are never updated: a correction is a new row, and the old
//! row's status moves to `corrected`.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// An observation as stored.
#[derive(Debug, Clone)]
pub struct ObservationRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit it was taken in.
    pub encounter_id: Option<Uuid>,
    /// What was measured.
    pub kind: String,
    /// The value.
    pub value: f64,
    /// UCUM unit.
    pub unit: String,
    /// LOINC code.
    pub code: Option<String>,
    /// When it was measured.
    pub recorded_at: OffsetDateTime,
    /// `final`, `corrected` or `entered_in_error`.
    pub status: String,
    /// The value this one corrects.
    pub supersedes_id: Option<Uuid>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// Who or what it came from.
    pub source: String,
    /// The member who recorded or confirmed it.
    pub verified_by: Option<Uuid>,
}

/// Values for a new observation.
#[derive(Debug, Clone)]
pub struct NewObservation<'a> {
    /// Identifier chosen by the API.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// Kind value.
    pub kind: &'a str,
    /// The value, already rounded to two decimals.
    pub value: f64,
    /// UCUM unit.
    pub unit: &'a str,
    /// LOINC code.
    pub loinc: &'a str,
    /// When it was measured.
    pub recorded_at: OffsetDateTime,
    /// The value this one corrects.
    pub supersedes_id: Option<Uuid>,
    /// Source value.
    pub source: &'a str,
    /// The member recording it.
    pub verified_by: Uuid,
}

/// Inserts an observation.
///
/// # Errors
/// [`DbError`] on a database failure, including a correction of another patient's value or of
/// a value already corrected (a conflict).
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewObservation<'_>,
) -> Result<ObservationRow, DbError> {
    let row = sqlx::query_as!(
        ObservationRow,
        r#"insert into aarogyam.observations
             (id, patient_id, encounter_id, kind, value_num, unit, code_system, code, recorded_at,
              supersedes_id, source, verified_by, verified_at)
           values ($1, $2, $3, $4, $5::float8::numeric(8, 2), $6, 'loinc', $7, $8, $9, $10, $11, now())
           returning id, patient_id, encounter_id, kind, value_num::float8 as "value!", unit, code,
                     recorded_at, status, supersedes_id, error_reason, source, verified_by"#,
        new.id,
        new.patient_id,
        new.encounter_id,
        new.kind,
        new.value,
        new.unit,
        new.loinc,
        new.recorded_at,
        new.supersedes_id,
        new.source,
        new.verified_by
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The observation with `id`, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<ObservationRow>, DbError> {
    let row = sqlx::query_as!(
        ObservationRow,
        r#"select id, patient_id, encounter_id, kind, value_num::float8 as "value!", unit, code,
                  recorded_at, status, supersedes_id, error_reason, source, verified_by
           from aarogyam.observations where id = $1 for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Moves a final value to `corrected` or `entered_in_error` (with a reason). The freeze
/// trigger refuses any other change.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn retire(
    conn: &mut PgConnection,
    id: Uuid,
    status: &str,
    reason: Option<&str>,
) -> Result<ObservationRow, DbError> {
    let row = sqlx::query_as!(
        ObservationRow,
        r#"update aarogyam.observations set status = $2, error_reason = $3 where id = $1
           returning id, patient_id, encounter_id, kind, value_num::float8 as "value!", unit, code,
                     recorded_at, status, supersedes_id, error_reason, source, verified_by"#,
        id,
        status,
        reason
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// A visit's observations, in the order they were taken.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_for_encounter(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<ObservationRow>, DbError> {
    let rows = sqlx::query_as!(
        ObservationRow,
        r#"select id, patient_id, encounter_id, kind, value_num::float8 as "value!", unit, code,
                  recorded_at, status, supersedes_id, error_reason, source, verified_by
           from aarogyam.observations where encounter_id = $1
           order by recorded_at, id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
