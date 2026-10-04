//! Patient imports: many patients, their identifiers and the import's record in a few
//! statements. Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::Date;
use uuid::Uuid;

/// Patients to insert, one entry per patient in every column. Validated by the caller.
#[derive(Debug, Clone, Default)]
pub struct PatientColumns {
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
    /// Whether each date was estimated.
    pub estimated: Vec<bool>,
    /// Phones in `E.164`.
    pub phones: Vec<Option<String>>,
    /// Emails.
    pub emails: Vec<Option<String>>,
    /// Language tags.
    pub languages: Vec<String>,
}

/// Reserves `count` consecutive numbers of `kind` and returns the first (`app.reserve_numbers`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn reserve_numbers(
    conn: &mut PgConnection,
    kind: &str,
    count: i32,
) -> Result<i64, DbError> {
    let first = sqlx::query_scalar!(
        r#"select app.reserve_numbers($1, $2) as "first!""#,
        kind,
        count
    )
    .fetch_one(conn)
    .await?;
    Ok(first)
}

/// Inserts the patients in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_patients(
    conn: &mut PgConnection,
    columns: &PatientColumns,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.patients
             (id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email, preferred_language)
           select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::date[], $6::bool[],
                                $7::text[], $8::text[], $9::text[])"#,
        &columns.ids,
        &columns.numbers,
        &columns.full_names,
        &columns.sexes,
        &columns.dates_of_birth as &[Option<Date>],
        &columns.estimated,
        &columns.phones as &[Option<String>],
        &columns.emails as &[Option<String>],
        &columns.languages
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Inserts identifiers in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_identifiers(
    conn: &mut PgConnection,
    patient_ids: &[Uuid],
    kinds: &[String],
    values: &[String],
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.patient_identifiers (patient_id, kind, value)
           select * from unnest($1::uuid[], $2::text[], $3::text[])"#,
        patient_ids,
        kinds,
        values
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Records an import.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_import(
    conn: &mut PgConnection,
    id: Uuid,
    mapping: &Value,
    total: i32,
    imported: i32,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.imports (id, kind, mapping, total_rows, imported_rows, failed_rows)
           values ($1, 'patients', $2, $3::int, $4::int, $3::int - $4::int)"#,
        id,
        mapping,
        total,
        imported
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The rows of an import, one entry per row in every column.
#[derive(Debug, Clone, Default)]
pub struct RowColumns {
    /// Lines in the file.
    pub row_numbers: Vec<i32>,
    /// Mapped values.
    pub raws: Vec<Value>,
    /// `imported` or `failed`.
    pub statuses: Vec<String>,
    /// Why a row failed.
    pub errors: Vec<Option<String>>,
    /// The patient a row became.
    pub patient_ids: Vec<Option<Uuid>>,
}

/// Records an import's rows in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_rows(
    conn: &mut PgConnection,
    import_id: Uuid,
    rows: &RowColumns,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.import_rows (import_id, row_number, raw, status, error, patient_id)
           select $1, * from unnest($2::int[], $3::jsonb[], $4::text[], $5::text[], $6::uuid[])"#,
        import_id,
        &rows.row_numbers,
        &rows.raws,
        &rows.statuses,
        &rows.errors as &[Option<String>],
        &rows.patient_ids as &[Option<Uuid>]
    )
    .execute(conn)
    .await?;
    Ok(())
}
