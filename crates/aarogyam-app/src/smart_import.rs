//! Smart import of patients from a clinic's own CSV or Excel file.
//!
//! 1. **Upload** reads the file, finds the header row, stores the rows in an import session
//!    (never the file itself) and suggests a field for each column.
//! 2. **Preview** reads every row through the clinic's mapping, leniently: what is readable is
//!    kept, what isn't is reported and left empty, and duplicates (same phone and name, in the
//!    clinic or earlier in the file) are found.
//! 3. **Commit** imports in one transaction: new patients numbered from the clinic's sequence,
//!    duplicates skipped or merged (filling only empty details), each row recorded against its
//!    file, sheet and row, patients missing details put on the front desk's to-do list, and the
//!    mapping remembered. Committing a session again returns the same result.

use std::collections::{BTreeMap, HashMap, HashSet};

use aarogyam_dal::import_sessions::{self as dal, Finish, ImportedPatients, NewSession};
use aarogyam_dal::imports;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{ImportId, ImportSessionId, PatientGapId, PatientId};
use aarogyam_domain::import::ImportField;
use aarogyam_domain::import_map::{
    LenientRow, Missing, Suggestion, duplicate_key, find_header, header_key, map_rows,
    read_leniently, suggest,
};
use aarogyam_domain::patient::{BirthDate, NumberPrefix, PatientNumber, Sex};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::IdentifierKind;
use sakalya_db::{Db, ScopedTx};
use serde_json::{Value, json};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_offset, clinic_today};
use crate::error::AppError;
use crate::files::sha256_hex;
use crate::scope::staff_scope as scope;
use crate::tabular::{TableError, read_table};

/// Most data rows in one import.
pub const MAX_ROWS: usize = 5_000;
/// Rows shown under each column while mapping.
const SAMPLE_ROWS: usize = 5;
/// Most entries on the to-do list in one response.
const GAP_PAGE: i64 = 500;

/// A file as uploaded.
#[derive(Debug, Clone, Default)]
pub struct Upload {
    /// Its name.
    pub file_name: String,
    /// Its bytes.
    pub bytes: Vec<u8>,
    /// The workbook sheet to read; the first when `None`.
    pub sheet: Option<String>,
}

/// An open session, as the mapping step shows it.
#[derive(Debug, Clone)]
pub struct SessionView {
    /// The session.
    pub id: ImportSessionId,
    /// The file's name.
    pub file_name: String,
    /// `csv` or `xlsx`.
    pub kind: &'static str,
    /// A workbook's sheets.
    pub sheets: Vec<String>,
    /// The sheet read.
    pub sheet: Option<String>,
    /// Row of the file holding the headers.
    pub header_row: usize,
    /// The headers.
    pub headers: Vec<String>,
    /// Data rows.
    pub row_count: usize,
    /// The first rows, to recognise each column by; phones and emails hidden from members
    /// who may not see contact details.
    pub sample: Vec<Vec<String>>,
    /// A field suggested for each column.
    pub suggestions: Vec<Suggestion>,
    /// When the session ends unless committed.
    pub expires_at: OffsetDateTime,
}

/// What to do with a row that matches an existing patient or an earlier row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowChoice {
    /// Leave it out.
    Skip,
    /// Fill the other record's empty details from it.
    Merge,
    /// Import it anyway, as a different person.
    Import,
}

/// The clinic's choices for a session.
#[derive(Debug, Clone)]
pub struct Choices {
    /// Our field to column index.
    pub mapping: BTreeMap<ImportField, usize>,
    /// What to do with duplicates by default.
    pub duplicates: RowChoice,
    /// Per row (by row in the file), overriding the default; `Skip` also leaves out any row.
    pub rows: BTreeMap<usize, RowChoice>,
}

/// What happens (preview) or happened (commit) to a row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowAction {
    /// A new patient.
    Import,
    /// Merged into an existing patient or an earlier row.
    Merge,
    /// Left out.
    Skip,
    /// Can't be imported: see the errors.
    Fail,
}

impl RowAction {
    /// The value stored and sent over the API, before (`preview`) or after (`commit`).
    #[must_use]
    pub const fn as_str(self, committed: bool) -> &'static str {
        match (self, committed) {
            (Self::Import, false) => "import",
            (Self::Import, true) => "imported",
            (Self::Merge, false) => "merge",
            (Self::Merge, true) => "merged",
            (Self::Skip, false) => "skip",
            (Self::Skip, true) => "skipped",
            (Self::Fail, false) => "fail",
            (Self::Fail, true) => "failed",
        }
    }

    fn parse_recorded(text: &str) -> Self {
        match text {
            "imported" => Self::Import,
            "merged" => Self::Merge,
            "skipped" => Self::Skip,
            _ => Self::Fail,
        }
    }
}

/// The record a duplicate row matches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DuplicateOf {
    /// An existing patient.
    Patient {
        /// The patient.
        id: PatientId,
        /// Their number.
        number: String,
    },
    /// An earlier row of the file.
    Row(usize),
}

/// One row's result.
#[derive(Debug, Clone)]
pub struct RowOutcome {
    /// Row in the file.
    pub line: usize,
    /// What happens or happened.
    pub action: RowAction,
    /// Imported (or to be) with details missing.
    pub missing: Vec<Missing>,
    /// Why it can't be imported, or was skipped. Never echoes values.
    pub errors: Vec<String>,
    /// Values left empty because they couldn't be read.
    pub warnings: Vec<String>,
    /// The record it duplicates.
    pub duplicate_of: Option<DuplicateOf>,
    /// The values as they will be saved, by field; contact details hidden from members who may
    /// not see them. Empty after a commit.
    pub values: BTreeMap<&'static str, String>,
    /// The patient it became or was merged into, on commit.
    pub patient_id: Option<PatientId>,
    /// Their number, on commit.
    pub number: Option<String>,
}

/// A preview's or commit's result.
#[derive(Debug, Clone)]
pub struct ImportOutcome {
    /// The import, on commit.
    pub import_id: Option<ImportId>,
    /// Rows read.
    pub total: usize,
    /// New patients.
    pub imported: usize,
    /// Of those, with details missing.
    pub incomplete: usize,
    /// Merged into another record.
    pub merged: usize,
    /// Left out.
    pub skipped: usize,
    /// Can't be imported.
    pub failed: usize,
    /// Notes about the whole file, such as a column we don't import.
    pub notes: Vec<String>,
    /// Every row, in file order.
    pub rows: Vec<RowOutcome>,
}

fn file_error(error: &TableError) -> AppError {
    AppError::invalid("file", error)
}

/// A file name safe to keep: no path, no control characters, at most 200 characters.
fn clean_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let clean: String = base
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect::<String>()
        .trim()
        .to_owned();
    if clean.is_empty() {
        "upload".to_owned()
    } else {
        clean
    }
}

/// `value` as a member without `patients.contact` may see it.
fn hide_contact(field: Option<ImportField>, value: &str, contact: bool) -> String {
    if contact || value.is_empty() {
        return value.to_owned();
    }
    match field {
        Some(ImportField::Phone) => {
            sakalya_types::PhoneE164::parse_with_default(value, sakalya_types::CallingCode::INDIA)
                .map_or_else(|_| "hidden".to_owned(), |phone| phone.masked())
        }
        Some(ImportField::Email) => "hidden".to_owned(),
        _ => value.to_owned(),
    }
}

/// Reads an upload, opens a session holding its rows and suggests a mapping.
///
/// # Errors
/// [`AppError::Invalid`] (field `file`) when the file can't be read or has no rows under its
/// header; [`AppError::Db`] on failures.
pub async fn upload(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    upload: Upload,
    now: OffsetDateTime,
) -> Result<SessionView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let Upload {
        file_name,
        bytes,
        sheet,
    } = upload;
    let size_bytes = i32::try_from(bytes.len()).map_err(|_| file_error(&TableError::TooLarge))?;
    let (table, sha256) = tokio::task::spawn_blocking(move || {
        read_table(&bytes, sheet.as_deref()).map(|table| (table, sha256_hex(&bytes)))
    })
    .await
    .map_err(|_| AppError::Internal("file reader"))?
    .map_err(|error| file_error(&error))?;
    let header_index = find_header(&table.records).ok_or_else(|| file_error(&TableError::Empty))?;
    let (header_row, header_cells) = table.records[header_index].clone();
    let data: Vec<(usize, Vec<String>)> = table.records[header_index + 1..].to_vec();
    if data.is_empty() {
        return Err(AppError::invalid(
            "file",
            "the file has no rows under its header",
        ));
    }
    if data.len() > MAX_ROWS {
        return Err(AppError::invalid(
            "file",
            format!("the file has more than {MAX_ROWS} rows"),
        ));
    }
    let width = data
        .iter()
        .map(|(_, cells)| cells.len())
        .chain([header_cells.len()])
        .max()
        .unwrap_or_default();
    let headers: Vec<String> = (0..width)
        .map(|column| match header_cells.get(column) {
            Some(name) if !name.is_empty() => name.chars().take(100).collect(),
            _ => format!("Column {}", column + 1),
        })
        .collect();
    let header_keys: Vec<String> = headers.iter().map(|header| header_key(header)).collect();
    let cells = serde_json::to_value(&data).map_err(|_| AppError::Internal("cells"))?;
    let id = ImportSessionId::new_v7();
    let file_name = clean_file_name(&file_name);
    let to_i32 = |n: usize| i32::try_from(n).map_err(|_| AppError::Internal("count"));
    let session = NewSession {
        id: id.uuid(),
        file_name: &file_name,
        file_kind: table.kind.as_str(),
        file_sha256: &sha256,
        size_bytes,
        sheet_names: &table.sheets,
        sheet_name: table.sheet.as_deref(),
        header_row: to_i32(header_row)?,
        headers: &headers,
        cells: &cells,
        row_count: to_i32(data.len())?,
    };
    let remembered = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(dal::open(tx.conn(), &session, &header_keys).await?)
        })
        .await?;
    let saved: BTreeMap<String, ImportField> = remembered
        .into_iter()
        .filter_map(|row| Some((row.header_key, ImportField::from_key(&row.field)?)))
        .collect();
    let today = clinic_today(&actor.timezone, now);
    let rows: Vec<Vec<String>> = data.iter().map(|(_, cells)| cells.clone()).collect();
    let suggestions = suggest(&headers, &rows, &saved, today);
    let contact = actor.permissions.allows(Permission::PatientsContact);
    let sample = rows
        .iter()
        .take(SAMPLE_ROWS)
        .map(|cells| {
            (0..width)
                .map(|column| {
                    let value = cells.get(column).map_or("", String::as_str);
                    hide_contact(suggestions[column].field, value, contact)
                })
                .collect()
        })
        .collect();
    Ok(SessionView {
        id,
        file_name,
        kind: table.kind.as_str(),
        sheets: table.sheets,
        sheet: table.sheet,
        header_row,
        headers,
        row_count: data.len(),
        sample,
        suggestions,
        expires_at: now + time::Duration::hours(24),
    })
}

/// Ends an open session and clears its rows.
///
/// # Errors
/// [`AppError::NotFound`] when the clinic has no such session; [`AppError::Db`] on failures.
pub async fn discard(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ImportSessionId,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::discard(tx.conn(), id.uuid()).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("import session"))
        }
    })
    .await
}

/// A row being planned, with the record it may become.
struct Planned {
    row: LenientRow,
    action: RowAction,
    duplicate_of: Option<DuplicateOf>,
    errors: Vec<String>,
}

/// Matches from the clinic's records: patients by `phone|name`, identifiers by kind and value.
#[derive(Default)]
struct Existing {
    people: HashMap<String, (PatientId, String)>,
    identifiers: HashMap<(String, String), PatientId>,
}

async fn existing(tx: &mut ScopedTx, rows: &[LenientRow]) -> Result<Existing, AppError> {
    let (mut phones, mut names) = (Vec::new(), Vec::new());
    for (phone, name) in rows.iter().filter_map(duplicate_key) {
        phones.push(phone);
        names.push(name);
    }
    let file_numbers: Vec<String> = rows.iter().filter_map(|r| r.file_number.clone()).collect();
    let legacy_ids: Vec<String> = rows.iter().filter_map(|r| r.legacy_id.clone()).collect();
    if phones.is_empty() && file_numbers.is_empty() && legacy_ids.is_empty() {
        return Ok(Existing::default());
    }
    let mut found = Existing::default();
    for row in dal::matches(tx.conn(), &phones, &names, &file_numbers, &legacy_ids).await? {
        if row.kind == "person" {
            found
                .people
                .entry(row.value)
                .or_insert((PatientId::from_uuid(row.patient_id), row.number));
        } else {
            found
                .identifiers
                .insert((row.kind, row.value), PatientId::from_uuid(row.patient_id));
        }
    }
    Ok(found)
}

/// Fills `target`'s empty details from `other`, then recounts what is missing.
fn fill_from(target: &mut LenientRow, other: &LenientRow) {
    if target.sex == Sex::Unknown {
        target.sex = other.sex;
    }
    target.birth_date = target.birth_date.or(other.birth_date);
    if target.phone.is_none() {
        target.phone.clone_from(&other.phone);
    }
    if target.email.is_none() {
        target.email.clone_from(&other.email);
    }
    if target.address.is_none() {
        target.address.clone_from(&other.address);
    }
    target.last_visit = target.last_visit.or(other.last_visit);
    if target.file_number.is_none() {
        target.file_number.clone_from(&other.file_number);
    }
    if target.legacy_id.is_none() {
        target.legacy_id.clone_from(&other.legacy_id);
    }
    target.missing.retain(|missing| match missing {
        Missing::Phone => target.phone.is_none(),
        Missing::Sex => target.sex == Sex::Unknown,
        Missing::DateOfBirth => target.birth_date.is_none(),
    });
}

/// Leaves off identifiers another patient or an earlier row holds, with a warning; one the
/// patient merged into already holds is simply not added again.
fn drop_held_identifiers(
    row: &mut LenientRow,
    existing: &Existing,
    merge_target: Option<PatientId>,
    seen: &mut HashSet<(&'static str, String)>,
) {
    for (kind, field, value) in [
        (
            IdentifierKind::FileNumber,
            ImportField::FileNumber,
            &mut row.file_number,
        ),
        (
            IdentifierKind::Legacy,
            ImportField::LegacyId,
            &mut row.legacy_id,
        ),
    ] {
        let Some(text) = value.clone() else {
            continue;
        };
        match existing
            .identifiers
            .get(&(kind.as_str().to_owned(), text.clone()))
        {
            Some(holder) if Some(*holder) == merge_target => *value = None,
            Some(_) => {
                row.warnings.push(format!(
                    "{}: another patient already has this number; left off",
                    field.key()
                ));
                *value = None;
            }
            None if !seen.insert((kind.as_str(), text)) => {
                row.warnings
                    .push(format!("{}: repeated in this file; left off", field.key()));
                *value = None;
            }
            None => {}
        }
    }
}

/// Decides each row's action from the clinic's choices, and drops identifiers another patient
/// (or an earlier row) already holds.
fn plan(rows: Vec<LenientRow>, existing: &Existing, choices: &Choices) -> Vec<Planned> {
    let mut first_of: HashMap<(String, String), usize> = HashMap::new();
    let mut seen_ids: HashSet<(&'static str, String)> = HashSet::new();
    let mut planned: Vec<Planned> = Vec::with_capacity(rows.len());
    for mut row in rows {
        let choice = choices.rows.get(&row.line).copied();
        if !row.errors.is_empty() {
            let errors = std::mem::take(&mut row.errors);
            planned.push(Planned {
                row,
                action: RowAction::Fail,
                duplicate_of: None,
                errors,
            });
            continue;
        }
        let key = duplicate_key(&row);
        let duplicate_of = key.as_ref().and_then(|key| {
            existing
                .people
                .get(&format!("{}|{}", key.0, key.1))
                .map(|(id, number)| DuplicateOf::Patient {
                    id: *id,
                    number: number.clone(),
                })
                .or_else(|| {
                    first_of
                        .get(key)
                        .map(|index| DuplicateOf::Row(planned[*index].row.line))
                })
        });
        let (action, errors) = match (&duplicate_of, choice.unwrap_or(choices.duplicates)) {
            (_, RowChoice::Skip) if choice == Some(RowChoice::Skip) => {
                (RowAction::Skip, vec!["skipped by choice".to_owned()])
            }
            (Some(DuplicateOf::Patient { number, .. }), RowChoice::Skip) => (
                RowAction::Skip,
                vec![format!("same phone and name as {number}")],
            ),
            (Some(DuplicateOf::Row(line)), RowChoice::Skip) => (
                RowAction::Skip,
                vec![format!("same phone and name as row {line}")],
            ),
            (Some(_), RowChoice::Merge) => (RowAction::Merge, Vec::new()),
            _ => (RowAction::Import, Vec::new()),
        };
        // Identifiers another patient or an earlier row holds are left off, with a warning;
        // one the patient merged into already holds is simply not added again.
        let merge_target = match (&duplicate_of, action) {
            (Some(DuplicateOf::Patient { id, .. }), RowAction::Merge) => Some(*id),
            _ => None,
        };
        if action != RowAction::Skip {
            drop_held_identifiers(&mut row, existing, merge_target, &mut seen_ids);
        }
        if action == RowAction::Import
            && let Some(key) = key
        {
            first_of.entry(key).or_insert(planned.len());
        }
        planned.push(Planned {
            row,
            action,
            duplicate_of,
            errors,
        });
    }
    // Rows merged into an earlier row fill its empty details.
    for index in 0..planned.len() {
        if planned[index].action == RowAction::Merge
            && let Some(DuplicateOf::Row(line)) = planned[index].duplicate_of
            && let Some(target) = planned[..index].iter().position(|p| p.row.line == line)
        {
            let source = planned[index].row.clone();
            fill_from(&mut planned[target].row, &source);
        }
    }
    planned
}

/// The values a row will be saved with, for the preview.
fn shown_values(row: &LenientRow, contact: bool) -> BTreeMap<&'static str, String> {
    let mut values = BTreeMap::new();
    if let Some(name) = &row.name {
        values.insert("full_name", name.as_str().to_owned());
    }
    if row.sex != Sex::Unknown {
        values.insert("sex", row.sex.as_str().to_owned());
    }
    if let Some(birth) = row.birth_date {
        let date = birth.date().to_string();
        values.insert(
            "date_of_birth",
            if birth.is_estimated() {
                format!("{date} (from age)")
            } else {
                date
            },
        );
    }
    if let Some(phone) = &row.phone {
        values.insert(
            "phone",
            if contact {
                phone.as_e164().to_owned()
            } else {
                phone.masked()
            },
        );
    }
    if let Some(email) = &row.email {
        values.insert(
            "email",
            if contact {
                email.as_str().to_owned()
            } else {
                "hidden".to_owned()
            },
        );
    }
    for (key, value) in [
        ("address", row.address.clone()),
        ("last_visit", row.last_visit.map(|d| d.to_string())),
        ("file_number", row.file_number.clone()),
        ("legacy_id", row.legacy_id.clone()),
    ] {
        if let Some(value) = value {
            values.insert(key, value);
        }
    }
    values
}

/// The session's rows read through the mapping, checked leniently.
fn read_session(
    session: &dal::SessionRow,
    mapping: &BTreeMap<ImportField, usize>,
    today: Date,
) -> Result<Vec<LenientRow>, AppError> {
    if !mapping.contains_key(&ImportField::FullName) {
        return Err(AppError::invalid(
            "mapping",
            "choose the column with the patient's name",
        ));
    }
    let mut used = HashSet::new();
    for column in mapping.values() {
        if *column >= session.headers.len() {
            return Err(AppError::invalid(
                "mapping",
                "a column number is out of range",
            ));
        }
        if !used.insert(*column) {
            return Err(AppError::invalid(
                "mapping",
                "a column is mapped to two fields",
            ));
        }
    }
    let cells = session.cells.clone().ok_or(AppError::Conflict(
        "this import session has ended; upload the file again",
    ))?;
    let records: Vec<(usize, Vec<String>)> =
        serde_json::from_value(cells).map_err(|_| AppError::Internal("cells"))?;
    Ok(map_rows(&records, mapping)
        .iter()
        .map(|row| read_leniently(row, today))
        .collect())
}

fn usable(session: Option<dal::SessionRow>) -> Result<dal::SessionRow, AppError> {
    let session = session.ok_or(AppError::NotFound("import session"))?;
    if session.status == "open" && session.expired {
        return Err(AppError::Conflict(
            "this import session has expired; upload the file again",
        ));
    }
    Ok(session)
}

fn notes(choices: &Choices) -> Vec<String> {
    let mut notes = Vec::new();
    if choices.mapping.contains_key(&ImportField::Balance) {
        notes.push(
            "balance: amounts owed are not imported; record opening balances in Billing".to_owned(),
        );
    }
    notes
}

fn outcome(
    planned: &[Planned],
    contact: bool,
    committed: bool,
    notes: Vec<String>,
) -> ImportOutcome {
    let count = |action: RowAction| planned.iter().filter(|p| p.action == action).count();
    let rows: Vec<RowOutcome> = planned
        .iter()
        .map(|p| RowOutcome {
            line: p.row.line,
            action: p.action,
            missing: if p.action == RowAction::Import {
                p.row.missing.clone()
            } else {
                Vec::new()
            },
            errors: p.errors.clone(),
            warnings: p.row.warnings.clone(),
            duplicate_of: p.duplicate_of.clone(),
            values: if committed {
                BTreeMap::new()
            } else {
                shown_values(&p.row, contact)
            },
            patient_id: None,
            number: None,
        })
        .collect();
    ImportOutcome {
        import_id: None,
        total: planned.len(),
        imported: count(RowAction::Import),
        incomplete: rows
            .iter()
            .filter(|r| r.action == RowAction::Import && !r.missing.is_empty())
            .count(),
        merged: count(RowAction::Merge),
        skipped: count(RowAction::Skip),
        failed: count(RowAction::Fail),
        notes,
        rows,
    }
}

/// Checks every row of a session through the clinic's choices; saves nothing.
///
/// # Errors
/// [`AppError::NotFound`] for no such session; [`AppError::Conflict`] when it has ended;
/// [`AppError::Invalid`] (field `mapping`) for an unusable mapping; [`AppError::Db`] on
/// failures.
pub async fn preview(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ImportSessionId,
    choices: &Choices,
    now: OffsetDateTime,
) -> Result<ImportOutcome, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let today = clinic_today(&actor.timezone, now);
    let contact = actor.permissions.allows(Permission::PatientsContact);
    db.scoped(&scope(actor, request_id), async |tx| {
        let session = usable(dal::find(tx.conn(), id.uuid()).await?)?;
        if session.status == "committed" {
            return Err(AppError::Conflict("this file has already been imported"));
        }
        let rows = read_session(&session, &choices.mapping, today)?;
        let found = existing(tx, &rows).await?;
        let planned = plan(rows, &found, choices);
        Ok(outcome(&planned, contact, false, notes(choices)))
    })
    .await
}

/// Imports a session's rows through the clinic's choices, in one transaction. Committing a
/// session that was already committed returns its recorded result.
///
/// # Errors
/// As [`preview`]; [`AppError::Db`] on failures.
pub async fn commit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ImportSessionId,
    choices: &Choices,
    now: OffsetDateTime,
) -> Result<ImportOutcome, AppError> {
    actor.require(Permission::PatientsWrite)?;
    let today = clinic_today(&actor.timezone, now);
    let prefix = NumberPrefix::parse(&actor.number_prefix).map_err(AppError::patient)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let session = usable(dal::lock(tx.conn(), id.uuid()).await?)?;
        if let Some(import_id) = session.import_id {
            return recorded(tx, ImportId::from_uuid(import_id)).await;
        }
        let rows = read_session(&session, &choices.mapping, today)?;
        let found = existing(tx, &rows).await?;
        let planned = plan(rows, &found, choices);
        let mut result = outcome(&planned, false, true, notes(choices));
        let import_id = ImportId::new_v7();
        save(
            tx,
            actor,
            &prefix,
            &session,
            choices,
            &planned,
            &mut result,
            import_id,
        )
        .await?;
        result.import_id = Some(import_id);
        Ok(result)
    })
    .await
}

/// The result recorded for a committed import.
async fn recorded(tx: &mut ScopedTx, import_id: ImportId) -> Result<ImportOutcome, AppError> {
    let rows = dal::recorded_rows(tx.conn(), import_id.uuid()).await?;
    let incomplete = rows.iter().filter(|row| row.incomplete).count();
    let rows: Vec<RowOutcome> = rows
        .into_iter()
        .map(|row| RowOutcome {
            line: usize::try_from(row.row_number).unwrap_or_default(),
            action: RowAction::parse_recorded(&row.status),
            missing: Vec::new(),
            errors: row.error.map(|e| vec![e]).unwrap_or_default(),
            warnings: Vec::new(),
            duplicate_of: None,
            values: BTreeMap::new(),
            patient_id: row.patient_id.map(PatientId::from_uuid),
            number: row.number,
        })
        .collect();
    let count = |action: RowAction| rows.iter().filter(|r| r.action == action).count();
    Ok(ImportOutcome {
        import_id: Some(import_id),
        total: rows.len(),
        imported: count(RowAction::Import),
        incomplete,
        merged: count(RowAction::Merge),
        skipped: count(RowAction::Skip),
        failed: count(RowAction::Fail),
        notes: Vec::new(),
        rows,
    })
}

/// Columns of the patients to insert or fill.
fn push_patient(
    columns: &mut ImportedPatients,
    id: PatientId,
    row: &LenientRow,
    offset: time::UtcOffset,
) {
    columns.ids.push(id.uuid());
    columns.full_names.push(
        row.name
            .as_ref()
            .map(|n| n.as_str().to_owned())
            .unwrap_or_default(),
    );
    columns.sexes.push(row.sex.as_str().to_owned());
    columns
        .dates_of_birth
        .push(row.birth_date.map(BirthDate::date));
    columns
        .estimated
        .push(row.birth_date.is_some_and(BirthDate::is_estimated));
    columns
        .phones
        .push(row.phone.as_ref().map(|p| p.as_e164().to_owned()));
    columns
        .emails
        .push(row.email.as_ref().map(|e| e.as_str().to_owned()));
    columns.languages.push(row.language.as_str().to_owned());
    columns
        .addresses
        .push(row.address.as_ref().map(|text| json!({ "text": text })));
    columns.last_visits.push(
        row.last_visit
            .map(|date| date.midnight().assume_offset(offset)),
    );
}

#[expect(
    clippy::too_many_arguments,
    clippy::too_many_lines,
    reason = "one transaction's writes, in order; splitting hides the order"
)]
async fn save(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    prefix: &NumberPrefix,
    session: &dal::SessionRow,
    choices: &Choices,
    planned: &[Planned],
    result: &mut ImportOutcome,
    import_id: ImportId,
) -> Result<(), AppError> {
    let offset = clinic_offset(&actor.timezone);
    let to_i32 = |n: usize| i32::try_from(n).map_err(|_| AppError::Internal("count"));
    let new_rows: Vec<usize> = (0..planned.len())
        .filter(|i| planned[*i].action == RowAction::Import)
        .collect();
    let mut created = ImportedPatients::default();
    let mut ids_by_line: HashMap<usize, (PatientId, String)> = HashMap::new();
    let (mut id_patients, mut id_kinds, mut id_values) = (Vec::new(), Vec::new(), Vec::new());
    let mut add_identifiers = |patient: PatientId, row: &LenientRow| {
        for (kind, value) in [
            (IdentifierKind::FileNumber, &row.file_number),
            (IdentifierKind::Legacy, &row.legacy_id),
        ] {
            if let Some(value) = value {
                id_patients.push(patient.uuid());
                id_kinds.push(kind.as_str().to_owned());
                id_values.push(value.clone());
            }
        }
    };
    if !new_rows.is_empty() {
        let first = imports::reserve_numbers(tx.conn(), "patient", to_i32(new_rows.len())?).await?;
        let first = u64::try_from(first).map_err(|_| AppError::Internal("negative number"))?;
        for (offset_n, index) in (0_u64..).zip(&new_rows) {
            let row = &planned[*index].row;
            let id = PatientId::new_v7();
            let number = PatientNumber::new(prefix, first + offset_n);
            push_patient(&mut created, id, row, offset);
            created.numbers.push(number.as_str().to_owned());
            add_identifiers(id, row);
            ids_by_line.insert(row.line, (id, number.as_str().to_owned()));
        }
        dal::insert_patients(tx.conn(), &created).await?;
    }
    // Rows merged into existing patients fill their empty details; several rows for one
    // patient are folded together first.
    let mut fills: Vec<(PatientId, LenientRow)> = Vec::new();
    for p in planned.iter().filter(|p| p.action == RowAction::Merge) {
        match &p.duplicate_of {
            Some(DuplicateOf::Patient { id, number }) => {
                ids_by_line.insert(p.row.line, (*id, number.clone()));
                if let Some((_, row)) = fills.iter_mut().find(|(patient, _)| patient == id) {
                    fill_from(row, &p.row);
                } else {
                    fills.push((*id, p.row.clone()));
                }
            }
            Some(DuplicateOf::Row(line)) => {
                if let Some(target) = ids_by_line.get(line).cloned() {
                    ids_by_line.insert(p.row.line, target);
                }
            }
            None => {}
        }
    }
    if !fills.is_empty() {
        let mut filled = ImportedPatients::default();
        for (id, row) in &fills {
            push_patient(&mut filled, *id, row, offset);
            add_identifiers(*id, row);
        }
        dal::fill_patients(tx.conn(), &filled).await?;
    }
    if !id_patients.is_empty() {
        imports::insert_identifiers(tx.conn(), &id_patients, &id_kinds, &id_values).await?;
    }

    let mut finish = Finish {
        import_id: import_id.uuid(),
        session_id: session.id,
        source: session.file_kind.clone(),
        file_name: session.file_name.clone(),
        sheet_name: session.sheet_name.clone(),
        mapping: Value::Object(
            choices
                .mapping
                .iter()
                .map(|(field, column)| {
                    (
                        field.key().to_owned(),
                        Value::String(session.headers[*column].clone()),
                    )
                })
                .collect(),
        ),
        ..Finish::default()
    };
    for (p, row) in planned.iter().zip(result.rows.iter_mut()) {
        let patient = ids_by_line.get(&p.row.line).cloned();
        if let Some((id, number)) = &patient {
            row.patient_id = Some(*id);
            row.number = Some(number.clone());
        }
        // A merge whose target was left out imports nothing.
        let action = if p.action == RowAction::Merge && patient.is_none() {
            row.action = RowAction::Skip;
            row.errors = vec!["the row it duplicates was not imported".to_owned()];
            RowAction::Skip
        } else {
            p.action
        };
        finish.row_numbers.push(to_i32(p.row.line)?);
        finish.statuses.push(action.as_str(true).to_owned());
        finish.errors.push(
            matches!(action, RowAction::Fail | RowAction::Skip)
                .then(|| row.errors.join("; ").chars().take(300).collect()),
        );
        finish.patient_ids.push(patient.map(|(id, _)| id.uuid()));
        if action == RowAction::Import
            && !p.row.missing.is_empty()
            && let Some((id, _)) = ids_by_line.get(&p.row.line)
        {
            {
                finish.gap_patients.push(id.uuid());
                finish.gap_rows.push(to_i32(p.row.line)?);
                finish.gap_missing.push(
                    p.row
                        .missing
                        .iter()
                        .map(|m| m.as_str())
                        .collect::<Vec<_>>()
                        .join(","),
                );
            }
        }
    }
    let count = |action: RowAction| result.rows.iter().filter(|r| r.action == action).count();
    result.merged = count(RowAction::Merge);
    result.skipped = count(RowAction::Skip);
    finish.counts = [
        to_i32(result.total)?,
        to_i32(result.imported)?,
        to_i32(result.failed)?,
        to_i32(result.skipped)?,
        to_i32(result.merged)?,
        to_i32(result.incomplete)?,
    ];
    let mut remembered = HashSet::new();
    for (field, column) in &choices.mapping {
        let key = header_key(&session.headers[*column]);
        if !key.is_empty() && !key.starts_with("column ") && remembered.insert(key.clone()) {
            finish.memory_keys.push(key);
            finish.memory_fields.push(field.key().to_owned());
        }
    }
    dal::finish(tx.conn(), &finish).await?;
    Ok(())
}

/// A patient on the to-do list.
#[derive(Debug, Clone)]
pub struct Gap {
    /// The entry; `None` for a patient registered here rather than imported (nothing to dismiss).
    pub id: Option<PatientGapId>,
    /// The patient.
    pub patient_id: PatientId,
    /// Their number.
    pub number: String,
    /// Their name.
    pub full_name: String,
    /// What is still missing.
    pub missing: Vec<Missing>,
    /// The file they came from.
    pub file_name: Option<String>,
    /// Its sheet.
    pub sheet_name: Option<String>,
    /// Their row in it.
    pub row: Option<usize>,
    /// When they were imported.
    pub imported_at: Option<OffsetDateTime>,
}

/// Patients still missing details: imported ones first, then those registered here with no
/// age or sex, oldest first, within the member's reach.
///
/// # Errors
/// [`AppError::Db`] on failures.
pub async fn gaps(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<Gap>, AppError> {
    actor.require(Permission::PatientsRead)?;
    let rows = db
        .scoped(&scope(actor, request_id), async |tx| {
            let reach = actor.reach(Permission::PatientsRead).member();
            Ok::<_, AppError>(dal::open_gaps(tx.conn(), GAP_PAGE, reach).await?)
        })
        .await?;
    Ok(rows
        .into_iter()
        .map(|row| Gap {
            id: row.id.map(PatientGapId::from_uuid),
            patient_id: PatientId::from_uuid(row.patient_id),
            number: row.number,
            full_name: row.full_name,
            missing: row
                .missing
                .iter()
                .filter_map(|m| Missing::parse(m))
                .collect(),
            file_name: row.file_name,
            sheet_name: row.sheet_name,
            row: row.row_number.and_then(|n| usize::try_from(n).ok()),
            imported_at: row.imported_at,
        })
        .collect())
}

/// Takes a patient off the to-do list, when the details can't be had.
///
/// # Errors
/// [`AppError::NotFound`] when the clinic has no such entry; [`AppError::Db`] on failures.
pub async fn dismiss_gap(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PatientGapId,
) -> Result<(), AppError> {
    actor.require(Permission::PatientsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::dismiss_gap(tx.conn(), id.uuid()).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("to-do entry"))
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use aarogyam_domain::import::MappedRow;
    use time::macros::date;

    fn lenient(line: usize, pairs: &[(ImportField, &str)]) -> LenientRow {
        read_leniently(
            &MappedRow {
                line,
                values: pairs
                    .iter()
                    .map(|(field, value)| (*field, (*value).to_owned()))
                    .collect(),
            },
            date!(2026 - 10 - 06),
        )
    }

    fn choices(duplicates: RowChoice) -> Choices {
        Choices {
            mapping: BTreeMap::new(),
            duplicates,
            rows: BTreeMap::new(),
        }
    }

    #[test]
    fn duplicates_are_skipped_or_merged_and_identifiers_kept_unique() {
        let rows = || {
            vec![
                lenient(
                    2,
                    &[
                        (ImportField::FullName, "Priya Sharma"),
                        (ImportField::Phone, "9876543210"),
                        (ImportField::LegacyId, "P-1"),
                    ],
                ),
                lenient(
                    3,
                    &[
                        (ImportField::FullName, "priya  sharma"),
                        (ImportField::Phone, "+91 98765 43210"),
                        (ImportField::Sex, "F"),
                        (ImportField::LegacyId, "P-1"),
                    ],
                ),
                lenient(
                    4,
                    &[
                        (ImportField::FullName, "Old Patient"),
                        (ImportField::Phone, "9876500000"),
                        (ImportField::FileNumber, "F-9"),
                    ],
                ),
                lenient(5, &[(ImportField::Phone, "9876500001")]),
            ]
        };
        let mut existing = Existing::default();
        let old = PatientId::new_v7();
        existing.people.insert(
            "+919876500000|old patient".to_owned(),
            (old, "AD-1".to_owned()),
        );
        existing
            .identifiers
            .insert(("file_number".to_owned(), "F-9".to_owned()), old);

        let skipped = plan(rows(), &existing, &choices(RowChoice::Skip));
        let actions: Vec<RowAction> = skipped.iter().map(|p| p.action).collect();
        assert_eq!(
            actions,
            [
                RowAction::Import,
                RowAction::Skip,
                RowAction::Skip,
                RowAction::Fail
            ]
        );
        assert_eq!(skipped[1].duplicate_of, Some(DuplicateOf::Row(2)));
        assert_eq!(skipped[1].errors, ["same phone and name as row 2"]);
        assert_eq!(skipped[2].errors, ["same phone and name as AD-1"]);
        assert!(skipped[3].errors[0].starts_with("full_name"));

        let merged = plan(rows(), &existing, &choices(RowChoice::Merge));
        assert_eq!(merged[1].action, RowAction::Merge);
        // The earlier row takes the sex it lacked; the repeated legacy ID is left off.
        assert_eq!(merged[0].row.sex, Sex::Female);
        assert_eq!(merged[0].row.missing, [Missing::DateOfBirth]);
        assert_eq!(merged[1].row.legacy_id, None);
        assert!(merged[1].row.warnings[0].contains("repeated"));
        // Merging into the patient who holds F-9 keeps it quietly (no duplicate is added).
        assert_eq!(merged[2].action, RowAction::Merge);
        assert_eq!(merged[2].row.warnings, Vec::<String>::new());

        let mut overridden = choices(RowChoice::Skip);
        overridden.rows.insert(2, RowChoice::Skip);
        overridden.rows.insert(4, RowChoice::Import);
        let chosen = plan(rows(), &existing, &overridden);
        assert_eq!(chosen[0].action, RowAction::Skip);
        // With row 2 left out, row 3 is the first of its kind.
        assert_eq!(chosen[1].action, RowAction::Import);
        assert_eq!(chosen[2].action, RowAction::Import);
        assert_eq!(chosen[2].row.file_number, None, "F-9 is another patient's");
    }

    #[test]
    fn file_names_are_cleaned_and_contacts_hidden() {
        assert_eq!(
            clean_file_name("C:\\Users\\desk\\patients.xlsx"),
            "patients.xlsx"
        );
        assert_eq!(clean_file_name("../../x.csv"), "x.csv");
        assert_eq!(clean_file_name("  "), "upload");
        assert_eq!(
            hide_contact(Some(ImportField::Phone), "98765 43210", false),
            "+91******3210"
        );
        assert_eq!(
            hide_contact(Some(ImportField::Email), "a@b.in", false),
            "hidden"
        );
        assert_eq!(
            hide_contact(Some(ImportField::Phone), "98765 43210", true),
            "98765 43210"
        );
        assert_eq!(hide_contact(None, "Priya", false), "Priya");
    }
}
