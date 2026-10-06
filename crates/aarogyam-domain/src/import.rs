//! Patient imports: reading CSV text, mapping its columns to our fields, and reading the loose
//! formats spreadsheets use for dates and sex.

use std::collections::BTreeMap;
use std::fmt;

use time::{Date, Month};

/// Most rows in one import, not counting the header.
pub const MAX_ROWS: usize = 5_000;
/// Most bytes of CSV text in one import.
pub const MAX_BYTES: usize = 2 * 1024 * 1024;

/// Why a file can't be imported at all. Row-level problems are reported per row instead.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportError {
    /// More than [`MAX_BYTES`].
    TooLarge,
    /// No header line, or no rows under it.
    Empty,
    /// More than [`MAX_ROWS`] rows.
    TooManyRows,
    /// A quoted field never ends.
    UnclosedQuote,
    /// The mapping names a field we don't import.
    UnknownField(String),
    /// The mapping names a column the header doesn't have.
    MissingColumn(String),
    /// The mapping has no column for the full name.
    NameNotMapped,
}

impl fmt::Display for ImportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge => write!(f, "the file is larger than {} MB", MAX_BYTES / 1024 / 1024),
            Self::Empty => f.write_str("the file needs a header line and at least one row"),
            Self::TooManyRows => write!(f, "the file has more than {MAX_ROWS} rows"),
            Self::UnclosedQuote => f.write_str("a quoted field never ends"),
            Self::UnknownField(field) => write!(f, "{field} is not a field we import"),
            Self::MissingColumn(column) => write!(f, "the header has no column {column:?}"),
            Self::NameNotMapped => f.write_str("map a column to full_name"),
        }
    }
}

impl std::error::Error for ImportError {}

/// A field a patient import fills.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ImportField {
    /// Full name (required).
    FullName,
    /// Sex: `F`, `M`, `female`, `male`, `other`; blank means unknown.
    Sex,
    /// Date of birth: `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY`.
    DateOfBirth,
    /// Age in years, when the date of birth is unknown.
    AgeYears,
    /// Phone.
    Phone,
    /// Email.
    Email,
    /// Language tag such as `hi-IN`.
    PreferredLanguage,
    /// The clinic's file number, kept as an identifier.
    FileNumber,
    /// The old software's patient ID, kept as an identifier.
    LegacyId,
    /// Postal address, kept as written.
    Address,
    /// The date of the last visit.
    LastVisit,
    /// An amount the patient owes; recognised so it isn't mistaken for another field, not
    /// imported (opening balances are entered in billing).
    Balance,
}

impl ImportField {
    /// Every field.
    pub const ALL: [Self; 12] = [
        Self::FullName,
        Self::Sex,
        Self::DateOfBirth,
        Self::AgeYears,
        Self::Phone,
        Self::Email,
        Self::PreferredLanguage,
        Self::FileNumber,
        Self::LegacyId,
        Self::Address,
        Self::LastVisit,
        Self::Balance,
    ];

    /// The field's name in a mapping.
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::FullName => "full_name",
            Self::Sex => "sex",
            Self::DateOfBirth => "date_of_birth",
            Self::AgeYears => "age_years",
            Self::Phone => "phone",
            Self::Email => "email",
            Self::PreferredLanguage => "preferred_language",
            Self::FileNumber => "file_number",
            Self::LegacyId => "legacy_id",
            Self::Address => "address",
            Self::LastVisit => "last_visit",
            Self::Balance => "balance",
        }
    }

    /// Parses a field name.
    #[must_use]
    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|field| field.key() == key)
    }
}

/// Splits CSV text (RFC 4180: commas, double-quoted fields, `""` for a quote, CRLF or LF) into
/// records. Blank lines are skipped. Each record carries its line number in the file.
///
/// # Errors
/// [`ImportError::UnclosedQuote`].
pub fn parse_csv(text: &str) -> Result<Vec<(usize, Vec<String>)>, ImportError> {
    parse_delimited(text, ',')
}

/// The delimiter a text file most likely uses: comma, semicolon, tab or pipe, whichever splits
/// the first lines (outside quotes) into the most columns, most consistently. Comma when none.
#[must_use]
pub fn sniff_delimiter(text: &str) -> char {
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(20)
        .collect();
    let count = |line: &str, delimiter: char| {
        let mut quoted = false;
        let mut n = 0_usize;
        for c in line.chars() {
            if c == '"' {
                quoted = !quoted;
            } else if c == delimiter && !quoted {
                n += 1;
            }
        }
        n
    };
    let mut best = (',', 0_usize);
    for delimiter in [',', ';', '\t', '|'] {
        let counts: Vec<usize> = lines.iter().map(|line| count(line, delimiter)).collect();
        let Some(&first) = counts.first() else {
            continue;
        };
        // Lines agreeing with the first, weighted by the columns they make.
        let agreeing = counts.iter().filter(|n| **n == first).count();
        let score = if first == 0 {
            0
        } else {
            agreeing * 100 + first
        };
        if score > best.1 {
            best = (delimiter, score);
        }
    }
    best.0
}

/// [`parse_csv`] with another delimiter, such as `;` (European Excel) or a tab.
///
/// # Errors
/// [`ImportError::UnclosedQuote`].
pub fn parse_delimited(
    text: &str,
    delimiter: char,
) -> Result<Vec<(usize, Vec<String>)>, ImportError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut line = 1;
    let mut record_line = 1;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    field.push('"');
                    chars.next();
                }
                '"' => quoted = false,
                '\n' => {
                    line += 1;
                    field.push(c);
                }
                _ => field.push(c),
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => quoted = true,
            c if c == delimiter => record.push(std::mem::take(&mut field)),
            '\r' if chars.peek() == Some(&'\n') => {}
            '\n' | '\r' => {
                record.push(std::mem::take(&mut field));
                if record.iter().any(|value| !value.trim().is_empty()) {
                    records.push((record_line, std::mem::take(&mut record)));
                } else {
                    record.clear();
                }
                line += 1;
                record_line = line;
            }
            _ => field.push(c),
        }
    }
    if quoted {
        return Err(ImportError::UnclosedQuote);
    }
    record.push(field);
    if record.iter().any(|value| !value.trim().is_empty()) {
        records.push((record_line, record));
    }
    Ok(records)
}

/// One row of the file, read through the mapping: our field to the cell's trimmed text.
/// Blank cells are left out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MappedRow {
    /// Line in the file (the header is line 1).
    pub line: usize,
    /// Values by field.
    pub values: BTreeMap<ImportField, String>,
}

impl MappedRow {
    /// The value of `field`, if the cell wasn't blank.
    #[must_use]
    pub fn get(&self, field: ImportField) -> Option<&str> {
        self.values.get(&field).map(String::as_str)
    }
}

/// Reads CSV text through a mapping of our field names to the file's column headers (matched
/// without regard to case or surrounding spaces).
///
/// # Errors
/// The [`ImportError`] that stops the whole file.
pub fn read_rows(
    text: &str,
    mapping: &BTreeMap<String, String>,
) -> Result<Vec<MappedRow>, ImportError> {
    if text.len() > MAX_BYTES {
        return Err(ImportError::TooLarge);
    }
    let mut records = parse_csv(text)?.into_iter();
    let (_, header) = records.next().ok_or(ImportError::Empty)?;
    let header: Vec<String> = header
        .iter()
        .map(|name| name.trim().to_lowercase())
        .collect();
    let mut columns = Vec::new();
    for (key, column) in mapping {
        let field =
            ImportField::from_key(key).ok_or_else(|| ImportError::UnknownField(key.clone()))?;
        let wanted = column.trim().to_lowercase();
        let index = header
            .iter()
            .position(|name| *name == wanted)
            .ok_or_else(|| ImportError::MissingColumn(column.clone()))?;
        columns.push((field, index));
    }
    if !columns
        .iter()
        .any(|(field, _)| *field == ImportField::FullName)
    {
        return Err(ImportError::NameNotMapped);
    }
    let rows: Vec<MappedRow> = records
        .map(|(line, cells)| MappedRow {
            line,
            values: columns
                .iter()
                .filter_map(|(field, index)| {
                    let value = cells.get(*index)?.trim();
                    (!value.is_empty()).then(|| (*field, value.to_owned()))
                })
                .collect(),
        })
        .collect();
    if rows.is_empty() {
        return Err(ImportError::Empty);
    }
    if rows.len() > MAX_ROWS {
        return Err(ImportError::TooManyRows);
    }
    Ok(rows)
}

/// Reads the sex values spreadsheets use: `F`/`female`, `M`/`male`, `O`/`other`, `U`/`unknown`,
/// in any case, plus common Hindi and Marathi words (`stri`, `mahila`, `purush`, `स्त्री`,
/// `पुरुष`). Returns our value, or `None` when unreadable.
#[must_use]
pub fn loose_sex(text: &str) -> Option<&'static str> {
    let text = text.trim().trim_end_matches('.').to_lowercase();
    match text.as_str() {
        "f" | "female" | "woman" | "fem" | "girl" | "stri" | "stree" | "mahila" | "स्त्री"
        | "स्री" | "महिला" | "औरत" => Some("female"),
        "m" | "male" | "man" | "boy" | "purush" | "पुरुष" | "पु" | "आदमी" => {
            Some("male")
        }
        "o" | "other" | "t" | "transgender" | "इतर" | "अन्य" => Some("other"),
        "u" | "unknown" => Some("unknown"),
        _ => None,
    }
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

fn month_number(text: &str) -> Option<u8> {
    if let Ok(number) = text.parse::<u8>() {
        return Some(number);
    }
    let text = text.to_lowercase();
    let prefix = text.get(..3)?;
    (1_u8..)
        .zip(MONTHS)
        .find_map(|(number, name)| (name == prefix).then_some(number))
}

/// Reads a date as `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY` (Indian order, day
/// first), or with the month as a word (`12-Apr-1990`, `12 April 1990`). A time after the date,
/// as exports add (`12/04/1990 00:00`), is ignored. Two-digit years are refused: guessing the
/// century would be inventing.
#[must_use]
pub fn loose_date(text: &str) -> Option<Date> {
    let text = text.trim();
    let first = text.split(' ').next().unwrap_or(text);
    // An ISO timestamp's time (`1990-04-12T00:00:00`), not the T of a month like OCT.
    let first = match first.find('T') {
        Some(at) if first[at + 1..].starts_with(|c: char| c.is_ascii_digit()) => &first[..at],
        _ => first,
    };
    let parts: Vec<&str> = if first.contains(['-', '/', '.']) {
        first.split(['-', '/', '.']).collect()
    } else {
        text.split([' ', ','])
            .filter(|part| !part.is_empty())
            .collect()
    };
    let [a, b, c] = parts.as_slice() else {
        return None;
    };
    let (year, month, day) = if a.len() == 4 {
        (*a, *b, *c)
    } else if c.len() == 4 {
        (*c, *b, *a)
    } else {
        return None;
    };
    let year: i32 = year.parse().ok()?;
    let month = month_number(month)?;
    let day: u8 = day.parse().ok()?;
    Date::from_calendar_date(year, Month::try_from(month).ok()?, day).ok()
}

/// Reads an age in years: `32`, `32 yrs`, `32Y`, `32 years`, `32 वर्ष`. Ages above 130 are
/// refused.
#[must_use]
pub fn loose_age(text: &str) -> Option<u16> {
    let text = text.trim().to_lowercase();
    let digits_end = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let (digits, rest) = text.split_at(digits_end);
    let rest = rest.trim().trim_end_matches('.');
    let unit_ok = matches!(
        rest,
        "" | "y" | "yr" | "yrs" | "year" | "years" | "वर्ष" | "वर्षे" | "साल"
    );
    let age: u16 = digits.parse().ok()?;
    (unit_ok && age <= 130).then_some(age)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn mapping(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn csv_handles_quotes_newlines_and_blank_lines() {
        let text = "\u{feff}Name,Note\r\n\"Shah, Meera\",\"said \"\"hi\"\"\"\r\n\r\nRavi,\"two\nlines\"\nlast,";
        let records = parse_csv(text).unwrap();
        assert_eq!(records.len(), 4);
        assert_eq!(
            records[1],
            (2, vec!["Shah, Meera".into(), "said \"hi\"".into()])
        );
        assert_eq!(records[2], (4, vec!["Ravi".into(), "two\nlines".into()]));
        assert_eq!(records[3], (6, vec!["last".into(), String::new()]));
        assert_eq!(parse_csv("a,\"b"), Err(ImportError::UnclosedQuote));
    }

    #[test]
    fn rows_are_read_through_the_mapping() {
        let text = "Patient Name, Mobile ,Old ID\nPriya,98765 43210,P-1\n Ravi ,,P-2\n";
        let rows = read_rows(
            text,
            &mapping(&[
                ("full_name", "patient name"),
                ("phone", "Mobile"),
                ("legacy_id", "Old ID"),
            ]),
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].line, 2);
        assert_eq!(rows[0].get(ImportField::Phone), Some("98765 43210"));
        assert_eq!(rows[1].get(ImportField::FullName), Some("Ravi"));
        assert_eq!(rows[1].get(ImportField::Phone), None);

        assert_eq!(
            read_rows(text, &mapping(&[("phone", "Mobile")])),
            Err(ImportError::NameNotMapped)
        );
        assert_eq!(
            read_rows(text, &mapping(&[("full_name", "Name")])),
            Err(ImportError::MissingColumn("Name".into()))
        );
        assert_eq!(
            read_rows(text, &mapping(&[("blood", "Mobile")])),
            Err(ImportError::UnknownField("blood".into()))
        );
        assert_eq!(
            read_rows("Name\n", &mapping(&[("full_name", "Name")])),
            Err(ImportError::Empty)
        );
        let many = format!("Name\n{}", "x\n".repeat(MAX_ROWS + 1));
        assert_eq!(
            read_rows(&many, &mapping(&[("full_name", "Name")])),
            Err(ImportError::TooManyRows)
        );
    }

    #[test]
    fn delimiters_are_sniffed() {
        assert_eq!(sniff_delimiter("a;b;c\n1;2;3\n"), ';');
        assert_eq!(sniff_delimiter("a\tb\n1\t\"x;y\"\n"), '\t');
        assert_eq!(sniff_delimiter("name,phone\n\"Shah; M\",1\n"), ',');
        assert_eq!(sniff_delimiter("name\nPriya\n"), ',');
        let rows = parse_delimited("a;b\n\"x;y\";2\n", ';').unwrap();
        assert_eq!(rows[1].1, vec!["x;y".to_owned(), "2".to_owned()]);
    }

    #[test]
    fn loose_values() {
        assert_eq!(loose_sex(" F "), Some("female"));
        assert_eq!(loose_sex("Male"), Some("male"));
        assert_eq!(loose_sex("x"), None);
        assert_eq!(loose_date("1990-04-12"), Some(date!(1990 - 04 - 12)));
        assert_eq!(loose_date("12/04/1990"), Some(date!(1990 - 04 - 12)));
        assert_eq!(loose_date("12.04.1990"), Some(date!(1990 - 04 - 12)));
        assert_eq!(loose_date("31/02/1990"), None);
        assert_eq!(loose_date("April 1990"), None);
        assert_eq!(loose_date("12-Apr-1990"), Some(date!(1990 - 04 - 12)));
        assert_eq!(loose_date("12 April 1990"), Some(date!(1990 - 04 - 12)));
        assert_eq!(
            loose_date("12/04/1990 00:00:00"),
            Some(date!(1990 - 04 - 12))
        );
        assert_eq!(loose_date("12/04/90"), None);
        assert_eq!(loose_date("01-OCT-1990"), Some(date!(1990 - 10 - 01)));
        assert_eq!(
            loose_date("1990-04-12T00:00:00"),
            Some(date!(1990 - 04 - 12))
        );
        assert_eq!(loose_sex("स्त्री"), Some("female"));
        assert_eq!(loose_sex("Purush"), Some("male"));
        assert_eq!(loose_sex("M."), Some("male"));
        assert_eq!(loose_age("32"), Some(32));
        assert_eq!(loose_age("32 Yrs"), Some(32));
        assert_eq!(loose_age("7y"), Some(7));
        assert_eq!(loose_age("200"), None);
        assert_eq!(loose_age("thirty"), None);
    }
}
