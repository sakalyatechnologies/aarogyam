//! Reading a spreadsheet a person uploads into rows of text: CSV in any common delimiter and
//! encoding (UTF-8 with or without a byte-order mark, UTF-16, Windows-1252), or one sheet of an
//! Excel `.xlsx` workbook. Generic: no clinic concept here, so it can move to
//! `sakalya-backend` unchanged.

use std::fmt;
use std::io::Cursor;

use aarogyam_domain::import::{ImportError, parse_delimited, sniff_delimiter};
use calamine::{Data, Reader, Xlsx};

/// Most bytes in an uploaded file.
pub const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
/// Most bytes a workbook may unpack to: a guard against compressed bombs.
const MAX_UNPACKED_BYTES: u128 = 64 * 1024 * 1024;
/// Most rows, header included.
pub const MAX_RECORDS: usize = 5_100;
/// Most columns.
pub const MAX_COLUMNS: usize = 100;
/// Longest cell kept; longer text is cut.
const MAX_CELL_CHARS: usize = 1_000;

/// What kind of file it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// Delimited text.
    Csv,
    /// An Excel workbook.
    Xlsx,
}

impl FileKind {
    /// `csv` or `xlsx`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Xlsx => "xlsx",
        }
    }
}

/// A file read into rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Table {
    /// CSV or Excel.
    pub kind: FileKind,
    /// The workbook's sheets, in order; empty for CSV.
    pub sheets: Vec<String>,
    /// The sheet read.
    pub sheet: Option<String>,
    /// Non-blank rows with their row number in the file (from 1).
    pub records: Vec<(usize, Vec<String>)>,
}

/// Why a file can't be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableError {
    /// Larger than [`MAX_FILE_BYTES`], or unpacks to too much.
    TooLarge,
    /// Nothing in it.
    Empty,
    /// More than [`MAX_RECORDS`] rows.
    TooManyRows,
    /// More than [`MAX_COLUMNS`] columns.
    TooManyColumns,
    /// An old binary `.xls`, which we don't read.
    OldExcel,
    /// The workbook is damaged or not a workbook.
    Unreadable,
    /// No sheet by that name.
    NoSuchSheet,
    /// A CSV problem.
    Csv(ImportError),
}

impl fmt::Display for TableError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge => write!(
                f,
                "the file is larger than {} MB",
                MAX_FILE_BYTES / 1024 / 1024
            ),
            Self::Empty => f.write_str("the file has no rows"),
            Self::TooManyRows => write!(f, "the file has more than {} rows", MAX_RECORDS - 100),
            Self::TooManyColumns => write!(f, "the file has more than {MAX_COLUMNS} columns"),
            Self::OldExcel => f.write_str("save the file as .xlsx or CSV and upload it again"),
            Self::Unreadable => f.write_str("the file is not a CSV or .xlsx file we can read"),
            Self::NoSuchSheet => f.write_str("the workbook has no sheet by that name"),
            Self::Csv(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for TableError {}

/// Reads `bytes` as an `.xlsx` workbook (by its content, not its name) or as CSV text.
/// `sheet` picks a workbook's sheet by name; the first otherwise.
///
/// # Errors
/// The [`TableError`] that stops the whole file.
pub fn read_table(bytes: &[u8], sheet: Option<&str>) -> Result<Table, TableError> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(TableError::TooLarge);
    }
    if bytes.is_empty() {
        return Err(TableError::Empty);
    }
    let table = if bytes.starts_with(b"PK\x03\x04") {
        read_xlsx(bytes, sheet)?
    } else if bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0]) {
        return Err(TableError::OldExcel);
    } else {
        let text = decode(bytes);
        let records = parse_delimited(&text, sniff_delimiter(&text)).map_err(TableError::Csv)?;
        Table {
            kind: FileKind::Csv,
            sheets: Vec::new(),
            sheet: None,
            records: records
                .into_iter()
                .map(|(line, cells)| (line, clip(cells)))
                .collect(),
        }
    };
    if table.records.is_empty() {
        return Err(TableError::Empty);
    }
    if table.records.len() > MAX_RECORDS {
        return Err(TableError::TooManyRows);
    }
    if table
        .records
        .iter()
        .any(|(_, cells)| cells.len() > MAX_COLUMNS)
    {
        return Err(TableError::TooManyColumns);
    }
    Ok(table)
}

/// Text from bytes: UTF-8 (a byte-order mark is dropped), UTF-16 with its mark, else
/// Windows-1252, which is what Excel on Windows writes for "CSV".
fn decode(bytes: &[u8]) -> String {
    if let Some((encoding, bom)) = encoding_rs::Encoding::for_bom(bytes) {
        let (text, _) = encoding.decode_without_bom_handling(&bytes[bom..]);
        return text.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => encoding_rs::WINDOWS_1252
            .decode_without_bom_handling(bytes)
            .0
            .into_owned(),
    }
}

/// Trims each cell, cuts long ones, and drops empty cells at the end of the row.
fn clip(cells: Vec<String>) -> Vec<String> {
    let mut cells: Vec<String> = cells
        .into_iter()
        .map(|cell| {
            let cell = cell.trim();
            if cell.chars().count() > MAX_CELL_CHARS {
                cell.chars().take(MAX_CELL_CHARS).collect()
            } else {
                cell.to_owned()
            }
        })
        .collect();
    while cells.last().is_some_and(String::is_empty) {
        cells.pop();
    }
    cells
}

fn read_xlsx(bytes: &[u8], sheet: Option<&str>) -> Result<Table, TableError> {
    let unpacked = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| TableError::Unreadable)?
        .decompressed_size()
        .ok_or(TableError::Unreadable)?;
    if unpacked > MAX_UNPACKED_BYTES {
        return Err(TableError::TooLarge);
    }
    let mut workbook: Xlsx<_> =
        calamine::open_workbook_from_rs(Cursor::new(bytes)).map_err(|_| TableError::Unreadable)?;
    let sheets = workbook.sheet_names();
    let name = match sheet {
        Some(wanted) => sheets
            .iter()
            .find(|name| name.as_str() == wanted)
            .ok_or(TableError::NoSuchSheet)?
            .clone(),
        None => sheets.first().ok_or(TableError::Empty)?.clone(),
    };
    let range = workbook
        .worksheet_range(&name)
        .map_err(|_| TableError::Unreadable)?;
    let first_row = range.start().map_or(0, |(row, _)| row as usize);
    let first_column = range.start().map_or(0, |(_, column)| column as usize);
    if range.height() > MAX_RECORDS * 2 {
        return Err(TableError::TooManyRows);
    }
    if range.width() + first_column > MAX_COLUMNS * 2 {
        return Err(TableError::TooManyColumns);
    }
    let records = range
        .rows()
        .enumerate()
        .filter_map(|(offset, row)| {
            let mut cells = vec![String::new(); first_column];
            cells.extend(row.iter().map(cell_text));
            let cells = clip(cells);
            (!cells.is_empty()).then_some((first_row + offset + 1, cells))
        })
        .collect();
    Ok(Table {
        kind: FileKind::Xlsx,
        sheets,
        sheet: Some(name),
        records,
    })
}

/// A cell as the text a person would see: whole numbers without `.0` (phone numbers are
/// often stored as numbers), dates as `YYYY-MM-DD`.
fn cell_text(cell: &Data) -> String {
    match cell {
        Data::String(text) | Data::DateTimeIso(text) | Data::DurationIso(text) => text.clone(),
        Data::Int(number) => number.to_string(),
        Data::Float(number) => whole(*number).map_or_else(|| number.to_string(), |n| n.to_string()),
        Data::Bool(value) => if *value { "TRUE" } else { "FALSE" }.to_owned(),
        Data::DateTime(date) if date.is_datetime() => {
            let (year, month, day, ..) = date.to_ymd_hms_milli();
            format!("{year:04}-{month:02}-{day:02}")
        }
        Data::DateTime(date) => date.as_f64().to_string(),
        Data::Error(_) | Data::Empty => String::new(),
    }
}

/// A float that holds a whole number, as an integer.
#[expect(
    clippy::cast_possible_truncation,
    reason = "checked to be whole and within i64 first"
)]
fn whole(number: f64) -> Option<i64> {
    (number.fract() == 0.0 && number.abs() < 9.0e15).then_some(number as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORKBOOK: &[u8] = include_bytes!("../testdata/patients.xlsx");

    fn cells(table: &Table, index: usize) -> Vec<&str> {
        table.records[index].1.iter().map(String::as_str).collect()
    }

    #[test]
    fn csv_in_any_encoding_and_delimiter() {
        let utf8 = read_table(
            "\u{feff}Naav;Mobile\r\nPriya;98765 43210\r\n".as_bytes(),
            None,
        )
        .unwrap();
        assert_eq!(utf8.kind, FileKind::Csv);
        assert_eq!(cells(&utf8, 0), ["Naav", "Mobile"]);
        assert_eq!(cells(&utf8, 1), ["Priya", "98765 43210"]);

        // "José" in Windows-1252: é is 0xE9, not valid UTF-8.
        let latin = read_table(b"Name\tCity\nJos\xe9\tPune\n", None).unwrap();
        assert_eq!(cells(&latin, 1), ["José", "Pune"]);

        let mut utf16 = vec![0xff, 0xfe];
        for unit in "Name,Phone\nनाव,1\n".encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        let utf16 = read_table(&utf16, None).unwrap();
        assert_eq!(cells(&utf16, 1), ["नाव", "1"]);
    }

    #[test]
    fn limits_and_bad_files() {
        assert_eq!(read_table(b"", None), Err(TableError::Empty));
        assert_eq!(read_table(b"\n\n", None), Err(TableError::Empty));
        assert_eq!(
            read_table(&vec![b'a'; MAX_FILE_BYTES + 1], None),
            Err(TableError::TooLarge)
        );
        assert_eq!(
            read_table(&[0xd0, 0xcf, 0x11, 0xe0, 0, 0], None),
            Err(TableError::OldExcel)
        );
        assert_eq!(
            read_table(b"PK\x03\x04not really", None),
            Err(TableError::Unreadable)
        );
        let wide = format!("{}\n", vec!["a"; MAX_COLUMNS + 1].join(","));
        assert_eq!(
            read_table(wide.as_bytes(), None),
            Err(TableError::TooManyColumns)
        );
        let long = format!("Name\n{}", "x\n".repeat(MAX_RECORDS));
        assert_eq!(
            read_table(long.as_bytes(), None),
            Err(TableError::TooManyRows)
        );
        assert_eq!(
            read_table(b"a,\"b\n", None),
            Err(TableError::Csv(ImportError::UnclosedQuote))
        );
    }

    #[test]
    fn xlsx_first_or_chosen_sheet() {
        let table = read_table(WORKBOOK, None).unwrap();
        assert_eq!(table.kind, FileKind::Xlsx);
        assert_eq!(table.sheets, ["Patients", "Old"]);
        assert_eq!(table.sheet.as_deref(), Some("Patients"));
        // The title is row 1; row 2 is blank and left out.
        assert_eq!(table.records[0].0, 1);
        assert_eq!(table.records[1].0, 3);
        assert_eq!(cells(&table, 1)[1], "Naav");
        assert_eq!(
            cells(&table, 2),
            [
                "1",
                "Priya Sharma",
                "9876543210",
                "F",
                "1990-04-12",
                "12 MG Road, Pune",
                "05/09/2026",
                "500"
            ]
        );
        let old = read_table(WORKBOOK, Some("Old")).unwrap();
        assert_eq!(cells(&old, 1), ["Old Patient", "9876500000"]);
        assert_eq!(
            read_table(WORKBOOK, Some("Nope")),
            Err(TableError::NoSuchSheet)
        );
    }
}
