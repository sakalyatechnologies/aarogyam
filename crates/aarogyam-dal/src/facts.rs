//! Patient-level clinical facts: conditions (the problem list) and allergies.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A condition as stored.
#[derive(Debug, Clone)]
pub struct ConditionRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit it was found in.
    pub encounter_id: Option<Uuid>,
    /// What the doctor wrote.
    pub display_text: String,
    /// Code system, when coded.
    pub code_system: Option<String>,
    /// Code, when coded.
    pub code: Option<String>,
    /// `active`, `resolved` or `entered_in_error`.
    pub status: String,
    /// Shown in the clinical flags banner while active.
    pub flagged: bool,
    /// When it began.
    pub onset: Option<Date>,
    /// A remark.
    pub note: Option<String>,
    /// Who or what it came from.
    pub source: String,
    /// The member who recorded or confirmed it.
    pub verified_by: Option<Uuid>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// A condition's values, validated by the caller.
#[derive(Debug, Clone)]
pub struct ConditionValues<'a> {
    /// What the doctor wrote.
    pub display_text: &'a str,
    /// Code system and code, when coded.
    pub code: Option<(&'a str, &'a str)>,
    /// Status value.
    pub status: &'a str,
    /// Shown in the flags banner.
    pub flagged: bool,
    /// When it began.
    pub onset: Option<Date>,
    /// A remark.
    pub note: Option<&'a str>,
    /// Source value.
    pub source: &'a str,
    /// The member recording or confirming it.
    pub verified_by: Uuid,
}

/// Inserts a condition.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_condition(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    encounter_id: Option<Uuid>,
    values: &ConditionValues<'_>,
) -> Result<ConditionRow, DbError> {
    let row = sqlx::query_as!(
        ConditionRow,
        r#"insert into aarogyam.conditions
             (id, patient_id, encounter_id, display_text, code_system, code, status, flagged, onset,
              note, source, verified_by, verified_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
           returning id, patient_id, encounter_id, display_text, code_system, code, status, flagged,
                     onset, note, source, verified_by, created_at, updated_at"#,
        id,
        patient_id,
        encounter_id,
        values.display_text,
        values.code.map(|(system, _)| system),
        values.code.map(|(_, code)| code),
        values.status,
        values.flagged,
        values.onset,
        values.note,
        values.source,
        values.verified_by
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves a condition's values.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_condition(
    conn: &mut PgConnection,
    id: Uuid,
    values: &ConditionValues<'_>,
) -> Result<ConditionRow, DbError> {
    let row = sqlx::query_as!(
        ConditionRow,
        r#"update aarogyam.conditions
           set display_text = $2, code_system = $3, code = $4, status = $5, flagged = $6, onset = $7,
               note = $8, source = $9, verified_by = $10, verified_at = now()
           where id = $1
           returning id, patient_id, encounter_id, display_text, code_system, code, status, flagged,
                     onset, note, source, verified_by, created_at, updated_at"#,
        id,
        values.display_text,
        values.code.map(|(system, _)| system),
        values.code.map(|(_, code)| code),
        values.status,
        values.flagged,
        values.onset,
        values.note,
        values.source,
        values.verified_by
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The condition with `id` of `patient_id`, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_condition_for_update(
    conn: &mut PgConnection,
    patient_id: Uuid,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<ConditionRow>, DbError> {
    let row = sqlx::query_as!(
        ConditionRow,
        r#"select id, patient_id, encounter_id, display_text, code_system, code, status, flagged,
                  onset, note, source, verified_by, created_at, updated_at
           from aarogyam.conditions
           where id = $1 and patient_id = $2 and app.patient_in_reach(patient_id, $3)
           for update"#,
        id,
        patient_id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A patient's conditions: active first, then newest.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_conditions(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<ConditionRow>, DbError> {
    let rows = sqlx::query_as!(
        ConditionRow,
        r#"select id, patient_id, encounter_id, display_text, code_system, code, status, flagged,
                  onset, note, source, verified_by, created_at, updated_at
           from aarogyam.conditions where patient_id = $1
           order by status = 'active' desc, created_at desc, id"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// An allergy as stored.
#[derive(Debug, Clone)]
pub struct AllergyRow {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The substance, such as penicillin.
    pub substance: String,
    /// Code system, when coded.
    pub code_system: Option<String>,
    /// Code, when coded.
    pub code: Option<String>,
    /// What happens.
    pub reaction: Option<String>,
    /// `mild`, `moderate` or `severe`.
    pub severity: String,
    /// `active`, `resolved` or `entered_in_error`.
    pub status: String,
    /// Who or what it came from.
    pub source: String,
    /// The member who recorded or confirmed it.
    pub verified_by: Option<Uuid>,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// An allergy's values, validated by the caller.
#[derive(Debug, Clone)]
pub struct AllergyValues<'a> {
    /// The substance.
    pub substance: &'a str,
    /// Code system and code, when coded.
    pub code: Option<(&'a str, &'a str)>,
    /// What happens.
    pub reaction: Option<&'a str>,
    /// Severity value.
    pub severity: &'a str,
    /// Status value.
    pub status: &'a str,
    /// Source value.
    pub source: &'a str,
    /// The member recording or confirming it.
    pub verified_by: Uuid,
}

/// Inserts an allergy.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_allergy(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    values: &AllergyValues<'_>,
) -> Result<AllergyRow, DbError> {
    let row = sqlx::query_as!(
        AllergyRow,
        r#"with a as (
             insert into aarogyam.allergies
               (id, patient_id, substance, code_system, code, reaction, severity, status, source,
                verified_by, verified_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
             returning id, patient_id, substance, code_system, code, reaction, severity, status,
                       source, verified_by, created_at, updated_at),
           reviewed as (
             update aarogyam.patients set allergies_reviewed = 'has_allergies', allergies_reviewed_at = now()
             where id = $2 and $8 = 'active' and allergies_reviewed <> 'has_allergies')
           select id as "id!", patient_id as "patient_id!", substance as "substance!", code_system,
                  code, reaction, severity as "severity!", status as "status!", source as "source!",
                  verified_by, created_at as "created_at!", updated_at as "updated_at!"
           from a"#,
        id,
        patient_id,
        values.substance,
        values.code.map(|(system, _)| system),
        values.code.map(|(_, code)| code),
        values.reaction,
        values.severity,
        values.status,
        values.source,
        values.verified_by
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves an allergy's values.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_allergy(
    conn: &mut PgConnection,
    id: Uuid,
    values: &AllergyValues<'_>,
) -> Result<AllergyRow, DbError> {
    let row = sqlx::query_as!(
        AllergyRow,
        r#"update aarogyam.allergies
           set substance = $2, code_system = $3, code = $4, reaction = $5, severity = $6, status = $7,
               source = $8, verified_by = $9, verified_at = now()
           where id = $1
           returning id, patient_id, substance, code_system, code, reaction, severity, status, source,
                     verified_by, created_at, updated_at"#,
        id,
        values.substance,
        values.code.map(|(system, _)| system),
        values.code.map(|(_, code)| code),
        values.reaction,
        values.severity,
        values.status,
        values.source,
        values.verified_by
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// The allergy with `id` of `patient_id`, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_allergy_for_update(
    conn: &mut PgConnection,
    patient_id: Uuid,
    id: Uuid,
    member: Option<Uuid>,
) -> Result<Option<AllergyRow>, DbError> {
    let row = sqlx::query_as!(
        AllergyRow,
        r#"select id, patient_id, substance, code_system, code, reaction, severity, status, source,
                  verified_by, created_at, updated_at
           from aarogyam.allergies
           where id = $1 and patient_id = $2 and app.patient_in_reach(patient_id, $3)
           for update"#,
        id,
        patient_id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A patient's allergies: active and severe first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_allergies(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<AllergyRow>, DbError> {
    let rows = sqlx::query_as!(
        AllergyRow,
        r#"select id, patient_id, substance, code_system, code, reaction, severity, status, source,
                  verified_by, created_at, updated_at
           from aarogyam.allergies where patient_id = $1
           order by status = 'active' desc, severity = 'severe' desc, severity = 'moderate' desc,
                    created_at desc, id"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Records allergies the patient reported at the desk (`source = 'patient'`, not yet
/// confirmed), skipping substances already active for the patient (same name, any case), and
/// marks the patient as having allergies. One statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_reported(
    conn: &mut PgConnection,
    patient_id: Uuid,
    substances: &[String],
) -> Result<u64, DbError> {
    let count = sqlx::query_scalar!(
        r#"with wanted as (
             select distinct on (lower(s)) s as substance
             from unnest($2::text[]) as s),
           added as (
             insert into aarogyam.allergies (patient_id, substance, source)
             select $1, w.substance, 'patient' from wanted w
             where not exists (select 1 from aarogyam.allergies a
                               where a.patient_id = $1 and a.status = 'active'
                                 and lower(a.substance) = lower(w.substance))
             returning id),
           reviewed as (
             update aarogyam.patients set allergies_reviewed = 'has_allergies', allergies_reviewed_at = now()
             where id = $1 and allergies_reviewed <> 'has_allergies' and cardinality($2::text[]) > 0)
           select count(*) as "count!" from added"#,
        patient_id,
        substances
    )
    .fetch_one(conn)
    .await?;
    Ok(u64::try_from(count).unwrap_or_default())
}

/// Marks that the patient knows of no allergies, unless an active allergy is on record.
/// Returns whether it was marked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_none_known(conn: &mut PgConnection, patient_id: Uuid) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.patients
           set allergies_reviewed = 'none_known',
               allergies_reviewed_at = case when allergies_reviewed = 'none_known'
                                            then allergies_reviewed_at else now() end
           where id = $1
             and not exists (select 1 from aarogyam.allergies a
                             where a.patient_id = $1 and a.status = 'active')"#,
        patient_id
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Confirms an unconfirmed allergy as `member`. Returns `None` when it was already confirmed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn confirm_allergy(
    conn: &mut PgConnection,
    id: Uuid,
    member: Uuid,
) -> Result<Option<AllergyRow>, DbError> {
    let row = sqlx::query_as!(
        AllergyRow,
        r#"update aarogyam.allergies set verified_by = $2, verified_at = now()
           where id = $1 and verified_by is null
           returning id, patient_id, substance, code_system, code, reaction, severity, status, source,
                     verified_by, created_at, updated_at"#,
        id,
        member
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Whether the patient has been asked about allergies (`unknown`, `none_known` or
/// `has_allergies`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn allergy_review(conn: &mut PgConnection, patient_id: Uuid) -> Result<String, DbError> {
    let review = sqlx::query_scalar!(
        r#"select allergies_reviewed from aarogyam.patients where id = $1"#,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(review.unwrap_or_else(|| "unknown".to_owned()))
}
