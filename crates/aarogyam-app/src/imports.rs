//! Importing patients from CSV: a preview that checks every row, then a commit that registers
//! the valid rows in one transaction, numbered from the clinic's sequence, with the old file
//! number and ID kept as identifiers. The import and each row's result are recorded.

use std::collections::{BTreeMap, HashSet};

use aarogyam_dal::{clinic, identifiers, imports};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{ImportId, PatientId};
use aarogyam_domain::import::{
    ImportError, ImportField, MappedRow, loose_date, loose_sex, read_rows,
};
use aarogyam_domain::patient::{BirthDate, NewPatient, NumberPrefix, PatientNumber};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::{IdentifierKind, parse_identifier};
use sakalya_db::{Db, ScopedTx};
use serde_json::Value;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::patients::{RegisterPatient, validate};
use crate::scope::staff_scope as scope;

/// Check only, or check and save.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    /// Check every row; save nothing.
    Preview,
    /// Save the valid rows; report the rest.
    Commit,
}

/// One row's result.
#[derive(Debug, Clone)]
pub struct RowOutcome {
    /// Line in the file (the header is line 1).
    pub line: usize,
    /// What is wrong, as `field: problem`; empty when the row is valid. Never echoes values.
    pub errors: Vec<String>,
    /// The patient registered, on commit.
    pub patient_id: Option<PatientId>,
    /// Their new number, on commit.
    pub number: Option<String>,
}

/// An import's result.
#[derive(Debug, Clone)]
pub struct ImportOutcome {
    /// The recorded import, on commit.
    pub import_id: Option<ImportId>,
    /// Rows read.
    pub total: usize,
    /// Rows that are (or were) imported.
    pub valid: usize,
    /// Rows with errors.
    pub invalid: usize,
    /// Every row's result, in file order.
    pub rows: Vec<RowOutcome>,
}

struct Checked {
    row: MappedRow,
    patient: Option<NewPatient>,
    file_number: Option<String>,
    legacy_id: Option<String>,
    errors: Vec<String>,
}

fn file_error(error: ImportError) -> AppError {
    let field = match error {
        ImportError::UnknownField(_)
        | ImportError::MissingColumn(_)
        | ImportError::NameNotMapped => "mapping",
        ImportError::TooLarge
        | ImportError::Empty
        | ImportError::TooManyRows
        | ImportError::UnclosedQuote => "csv",
    };
    AppError::invalid(field, error)
}

fn check_row(row: MappedRow, today: Date) -> Checked {
    let mut errors = Vec::new();
    let sex = row.get(ImportField::Sex).and_then(|text| {
        let sex = loose_sex(text);
        if sex.is_none() {
            errors.push("sex: use F, M, female, male or other".to_owned());
        }
        sex
    });
    let date_of_birth = row.get(ImportField::DateOfBirth).and_then(|text| {
        let date = loose_date(text);
        if date.is_none() {
            errors.push("date_of_birth: use YYYY-MM-DD or DD/MM/YYYY".to_owned());
        }
        date
    });
    // A date of birth wins over an age; spreadsheets often have both.
    let age_years = match (date_of_birth, row.get(ImportField::AgeYears)) {
        (None, Some(text)) => text.parse::<u16>().map_or_else(
            |_| {
                errors.push("age_years: must be a whole number".to_owned());
                None
            },
            Some,
        ),
        _ => None,
    };
    let input = RegisterPatient {
        full_name: row
            .get(ImportField::FullName)
            .unwrap_or_default()
            .to_owned(),
        sex: sex.map(str::to_owned),
        date_of_birth,
        age_years,
        phone: row.get(ImportField::Phone).map(str::to_owned),
        email: row.get(ImportField::Email).map(str::to_owned),
        preferred_language: row.get(ImportField::PreferredLanguage).map(str::to_owned),
    };
    let patient = match validate(&input, today) {
        Ok(patient) => Some(patient),
        Err(AppError::Invalid { field, message }) => {
            errors.push(format!("{field}: {message}"));
            None
        }
        Err(_) => None,
    };
    let mut identifier = |field: ImportField| {
        row.get(field)
            .and_then(|text| match parse_identifier(text) {
                Ok(value) => Some(value),
                Err(error) => {
                    errors.push(format!("{}: {error}", field.key()));
                    None
                }
            })
    };
    let file_number = identifier(ImportField::FileNumber);
    let legacy_id = identifier(ImportField::LegacyId);
    Checked {
        row,
        patient,
        file_number,
        legacy_id,
        errors,
    }
}

/// Flags identifiers repeated in the file or already held by a patient.
async fn check_identifiers(tx: &mut ScopedTx, rows: &mut [Checked]) -> Result<(), AppError> {
    for (kind, field) in [
        (IdentifierKind::FileNumber, ImportField::FileNumber),
        (IdentifierKind::Legacy, ImportField::LegacyId),
    ] {
        let value_of = |row: &Checked| match field {
            ImportField::FileNumber => row.file_number.clone(),
            _ => row.legacy_id.clone(),
        };
        let values: Vec<String> = rows.iter().filter_map(value_of).collect();
        if values.is_empty() {
            continue;
        }
        let taken: HashSet<String> = identifiers::taken(tx.conn(), kind.as_str(), &values)
            .await?
            .into_iter()
            .collect();
        let mut seen = HashSet::new();
        for row in rows.iter_mut() {
            let Some(value) = value_of(row) else {
                continue;
            };
            if taken.contains(&value) {
                row.errors.push(format!(
                    "{}: another patient already has this number",
                    field.key()
                ));
            } else if !seen.insert(value) {
                row.errors
                    .push(format!("{}: repeated in this file", field.key()));
            }
        }
    }
    Ok(())
}

fn raw(row: &MappedRow) -> Value {
    Value::Object(
        row.values
            .iter()
            .map(|(field, value)| (field.key().to_owned(), Value::String(value.clone())))
            .collect(),
    )
}

/// Saves the valid rows, their identifiers, the import and every row's result.
async fn commit(
    tx: &mut ScopedTx,
    prefix: &NumberPrefix,
    mapping: &BTreeMap<String, String>,
    rows: &[Checked],
    outcomes: &mut [RowOutcome],
) -> Result<ImportId, AppError> {
    let valid: Vec<usize> = (0..rows.len())
        .filter(|index| rows[*index].errors.is_empty() && rows[*index].patient.is_some())
        .collect();
    let mut columns = imports::PatientColumns::default();
    let (mut id_patients, mut id_kinds, mut id_values) = (Vec::new(), Vec::new(), Vec::new());
    if !valid.is_empty() {
        let count = i32::try_from(valid.len()).map_err(|_| AppError::Internal("row count"))?;
        let first = imports::reserve_numbers(tx.conn(), "patient", count).await?;
        let first = u64::try_from(first).map_err(|_| AppError::Internal("negative number"))?;
        for (offset, index) in (0_u64..).zip(&valid) {
            let row = &rows[*index];
            let Some(patient) = &row.patient else {
                continue;
            };
            let id = PatientId::new_v7();
            let number = PatientNumber::new(prefix, first + offset);
            columns.ids.push(id.uuid());
            columns.numbers.push(number.as_str().to_owned());
            columns
                .full_names
                .push(patient.full_name.as_str().to_owned());
            columns.sexes.push(patient.sex.as_str().to_owned());
            columns
                .dates_of_birth
                .push(patient.birth_date.map(BirthDate::date));
            columns
                .estimated
                .push(patient.birth_date.is_some_and(BirthDate::is_estimated));
            columns.phones.push(
                patient
                    .phone
                    .as_ref()
                    .map(|phone| phone.as_e164().to_owned()),
            );
            columns.emails.push(
                patient
                    .email
                    .as_ref()
                    .map(|email| email.as_str().to_owned()),
            );
            columns
                .languages
                .push(patient.preferred_language.as_str().to_owned());
            for (kind, value) in [
                (IdentifierKind::FileNumber, &row.file_number),
                (IdentifierKind::Legacy, &row.legacy_id),
            ] {
                if let Some(value) = value {
                    id_patients.push(id.uuid());
                    id_kinds.push(kind.as_str().to_owned());
                    id_values.push(value.clone());
                }
            }
            outcomes[*index].patient_id = Some(id);
            outcomes[*index].number = Some(number.as_str().to_owned());
        }
        imports::insert_patients(tx.conn(), &columns).await?;
        if !id_patients.is_empty() {
            imports::insert_identifiers(tx.conn(), &id_patients, &id_kinds, &id_values).await?;
        }
    }
    let import_id = ImportId::new_v7();
    let total = i32::try_from(rows.len()).map_err(|_| AppError::Internal("row count"))?;
    let imported = i32::try_from(valid.len()).map_err(|_| AppError::Internal("row count"))?;
    let mapping = serde_json::to_value(mapping).map_err(|_| AppError::Internal("mapping"))?;
    imports::insert_import(tx.conn(), import_id.uuid(), &mapping, total, imported).await?;
    let mut records = imports::RowColumns::default();
    for (row, outcome) in rows.iter().zip(outcomes.iter()) {
        let line = i32::try_from(row.row.line).map_err(|_| AppError::Internal("line"))?;
        records.row_numbers.push(line);
        records.raws.push(raw(&row.row));
        let failed = outcome.patient_id.is_none();
        records
            .statuses
            .push(if failed { "failed" } else { "imported" }.to_owned());
        records.errors.push(failed.then(|| {
            let text = outcome.errors.join("; ");
            text.chars().take(300).collect()
        }));
        records
            .patient_ids
            .push(outcome.patient_id.map(PatientId::uuid));
    }
    imports::insert_rows(tx.conn(), import_id.uuid(), &records).await?;
    Ok(import_id)
}

/// Checks (preview) or imports (commit) patients from CSV text read through `mapping` (our
/// field name to the file's column header).
///
/// # Errors
/// [`AppError::Invalid`] when the file or mapping can't be used at all; row problems are
/// reported per row instead. [`AppError::Db`] on failures.
pub async fn import_patients(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    csv: &str,
    mapping: &BTreeMap<String, String>,
    mode: ImportMode,
    now: OffsetDateTime,
) -> Result<ImportOutcome, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let rows = read_rows(csv, mapping).map_err(file_error)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let today = clinic_today(&profile.timezone, now);
        let prefix = NumberPrefix::parse(&profile.number_prefix).map_err(AppError::patient)?;
        let mut checked: Vec<Checked> = rows.into_iter().map(|row| check_row(row, today)).collect();
        check_identifiers(tx, &mut checked).await?;
        let mut outcomes: Vec<RowOutcome> = checked
            .iter()
            .map(|row| RowOutcome {
                line: row.row.line,
                errors: row.errors.clone(),
                patient_id: None,
                number: None,
            })
            .collect();
        let import_id = match mode {
            ImportMode::Preview => None,
            ImportMode::Commit => {
                Some(commit(tx, &prefix, mapping, &checked, &mut outcomes).await?)
            }
        };
        let invalid = outcomes.iter().filter(|row| !row.errors.is_empty()).count();
        Ok(ImportOutcome {
            import_id,
            total: outcomes.len(),
            valid: outcomes.len() - invalid,
            invalid,
            rows: outcomes,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn row(pairs: &[(ImportField, &str)]) -> MappedRow {
        MappedRow {
            line: 2,
            values: pairs
                .iter()
                .map(|(field, value)| (*field, (*value).to_owned()))
                .collect(),
        }
    }

    #[test]
    fn rows_are_checked_like_registrations() {
        let today = date!(2026 - 10 - 04);
        let good = check_row(
            row(&[
                (ImportField::FullName, "Priya Sharma"),
                (ImportField::Sex, "F"),
                (ImportField::DateOfBirth, "12/04/1990"),
                (ImportField::AgeYears, "36"),
                (ImportField::Phone, "98765 43210"),
                (ImportField::LegacyId, " P-1 "),
            ]),
            today,
        );
        assert!(good.errors.is_empty(), "{:?}", good.errors);
        assert_eq!(good.legacy_id.as_deref(), Some("P-1"));
        let patient = good.patient.unwrap();
        assert!(!patient.birth_date.unwrap().is_estimated());

        let bad = check_row(
            row(&[
                (ImportField::Sex, "robot"),
                (ImportField::DateOfBirth, "1990"),
                (ImportField::Phone, "12"),
            ]),
            today,
        );
        assert_eq!(bad.errors.len(), 3, "{:?}", bad.errors);
        assert!(bad.errors[0].starts_with("sex:"));
        assert!(bad.errors[1].starts_with("date_of_birth:"));
        assert!(bad.errors[2].starts_with("full_name:"));
        // Messages never repeat the value.
        assert!(bad.errors.iter().all(|error| !error.contains("robot")));
    }
}
