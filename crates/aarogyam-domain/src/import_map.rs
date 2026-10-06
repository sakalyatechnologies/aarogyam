//! Smart import: finding the header row of a clinic's file, suggesting which of our fields
//! each column holds (from the header in English, Hindi or Marathi, and from the values), and
//! checking each row leniently: what can be read is kept, what can't is reported and left
//! empty. Nothing is ever guessed into a record.

use std::collections::{BTreeMap, BTreeSet};

use sakalya_types::{CallingCode, PhoneE164};
use time::Date;

use crate::import::{ImportField, MappedRow, loose_age, loose_date, loose_sex};
use crate::patient::{BirthDate, Email, Language, PersonName, Sex};
use crate::schedule::parse_identifier;

/// Rows looked at to find the header.
const HEADER_SEARCH_ROWS: usize = 10;
/// Values per column looked at to recognise its contents.
const SAMPLE_VALUES: usize = 200;

/// Why a column got its suggested field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Basis {
    /// The clinic mapped this header before.
    Saved,
    /// The header and the values agree.
    HeaderAndValues,
    /// The header names the field.
    Header,
    /// The values look like the field.
    Values,
    /// Nothing recognisable, or another column matched better.
    None,
}

impl Basis {
    /// The value sent over the API.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Saved => "saved",
            Self::HeaderAndValues => "header_and_values",
            Self::Header => "header",
            Self::Values => "values",
            Self::None => "none",
        }
    }
}

/// The suggested field for one column.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Suggestion {
    /// Column index, from 0.
    pub column: usize,
    /// The field, if any.
    pub field: Option<ImportField>,
    /// How sure, 0 to 100.
    pub confidence: u8,
    /// Why.
    pub basis: Basis,
}

/// A header as compared: lower case, punctuation and runs of spaces as one space. Devanagari
/// letters and signs are kept.
#[must_use]
pub fn header_key(header: &str) -> String {
    let spaced: String = header
        .chars()
        .map(|c| {
            if c.is_ascii_punctuation() || c.is_whitespace() || c == '।' {
                ' '
            } else {
                c
            }
        })
        .collect::<String>()
        .to_lowercase();
    let key = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    key.chars().take(120).collect()
}

/// Headers each field goes by, as [`header_key`]s: English, Hindi and Marathi (in Latin
/// letters and in Devanagari). Matched whole first, then as words inside a longer header.
const SYNONYMS: &[(ImportField, &[&str])] = &[
    (
        ImportField::FullName,
        &[
            "name",
            "patient name",
            "patients name",
            "patient s name",
            "full name",
            "pt name",
            "patient",
            "naam",
            "nam",
            "naav",
            "nav",
            "rugna",
            "rugna naav",
            "rugnache naav",
            "rugnache nav",
            "mareez",
            "mariz",
            "mareez ka naam",
            "नाव",
            "नाम",
            "पूर्ण नाव",
            "रुग्णाचे नाव",
            "रुग्ण",
            "मरीज़ का नाम",
            "मरीज का नाम",
        ],
    ),
    (
        ImportField::Phone,
        &[
            "mobile",
            "mobile no",
            "mobile number",
            "mob",
            "mob no",
            "phone",
            "phone no",
            "phone number",
            "ph",
            "ph no",
            "contact",
            "contact no",
            "contact number",
            "cell",
            "whatsapp",
            "whatsapp no",
            "tel",
            "telephone",
            "sampark",
            "sampark kramank",
            "mobile kramank",
            "फोन",
            "फ़ोन",
            "मोबाईल",
            "मोबाइल",
            "मोबाईल नंबर",
            "संपर्क",
            "संपर्क क्रमांक",
        ],
    ),
    (
        ImportField::DateOfBirth,
        &[
            "dob",
            "d o b",
            "date of birth",
            "birth date",
            "birthdate",
            "birthday",
            "born",
            "janm tarikh",
            "janma tarikh",
            "janmatarikh",
            "janmatithi",
            "janm tithi",
            "जन्म तारीख",
            "जन्मतारीख",
            "जन्म तिथि",
            "जन्मतिथि",
            "जन्मदिनांक",
        ],
    ),
    (
        ImportField::AgeYears,
        &[
            "age",
            "age yrs",
            "age years",
            "age in years",
            "vay",
            "vaya",
            "umar",
            "umr",
            "umra",
            "वय",
            "उम्र",
            "आयु",
        ],
    ),
    (
        ImportField::Sex,
        &["sex", "gender", "m f", "ling", "jender", "लिंग"],
    ),
    (
        ImportField::Email,
        &[
            "email",
            "e mail",
            "email id",
            "email address",
            "mail",
            "ईमेल",
        ],
    ),
    (
        ImportField::Address,
        &[
            "address",
            "addr",
            "residence",
            "residential address",
            "pata",
            "patta",
            "पत्ता",
            "पता",
        ],
    ),
    (
        ImportField::LastVisit,
        &[
            "last visit",
            "last visit date",
            "last visited",
            "last seen",
            "visit date",
            "last appointment",
            "previous visit",
            "shevatchi bhet",
            "akhri visit",
            "अंतिम भेट",
            "शेवटची भेट",
        ],
    ),
    (
        ImportField::Balance,
        &[
            "balance",
            "due",
            "dues",
            "amount due",
            "outstanding",
            "pending",
            "pending amount",
            "baki",
            "baaki",
            "udhari",
            "बाकी",
            "शिल्लक",
            "बकाया",
        ],
    ),
    (
        ImportField::FileNumber,
        &[
            "file no",
            "file number",
            "file",
            "case no",
            "case number",
            "case paper no",
            "opd no",
            "reg no",
            "registration no",
            "registration number",
            "card no",
            "केस नंबर",
        ],
    ),
    (
        ImportField::LegacyId,
        &[
            "patient id",
            "id",
            "old id",
            "legacy id",
            "uhid",
            "mrn",
            "patient code",
            "code",
        ],
    ),
    (
        ImportField::PreferredLanguage,
        &["language", "preferred language", "bhasha", "भाषा"],
    ),
];

/// Words that make a header about someone else ("Father's name", "Doctor phone"), or about
/// a field we don't import, so it isn't matched to the patient's own.
const NOT_THE_PATIENT: &[&str] = &[
    "father",
    "mother",
    "husband",
    "wife",
    "spouse",
    "guardian",
    "relative",
    "emergency",
    "doctor",
    "dr",
    "referred",
    "reference",
    "ref",
    "consultant",
    "employer",
    "company",
    "insurance",
    "वडील",
    "पिता",
];

/// The field a header names, with confidence: a whole match 95, the words of a known header
/// inside a longer one 75.
#[must_use]
pub fn header_match(header: &str) -> Option<(ImportField, u8)> {
    let key = header_key(header);
    if key.is_empty() {
        return None;
    }
    let words: Vec<&str> = key.split(' ').collect();
    if words.iter().any(|word| NOT_THE_PATIENT.contains(word)) {
        return None;
    }
    for (field, names) in SYNONYMS {
        if names.contains(&key.as_str()) {
            return Some((*field, 95));
        }
    }
    // The longest known header whose words all appear: "patient mobile no" is a phone,
    // "date of last visit" a last visit. Single short words match only whole.
    let mut best: Option<(ImportField, usize)> = None;
    for (field, names) in SYNONYMS {
        for name in *names {
            let name_words: Vec<&str> = name.split(' ').collect();
            if name.chars().count() < 3 || (name_words.len() == 1 && name.len() < 4) {
                continue;
            }
            if [
                "patient", "id", "code", "file", "pending", "due", "nam", "nav",
            ]
            .contains(name)
            {
                continue;
            }
            if name_words.iter().all(|word| words.contains(word))
                && best.is_none_or(|(_, len)| name.len() > len)
            {
                best = Some((*field, name.len()));
            }
        }
    }
    best.map(|(field, _)| (field, 75))
}

/// How the values of a column look: the share of non-blank values readable as each kind.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Shape {
    samples: usize,
    phone: f32,
    email: f32,
    sex: f32,
    date: f32,
    old_dates: f32,
    age: f32,
    words: f32,
    long_text: f32,
    /// 1, 2, 3...: a serial number column, not ages.
    serial: bool,
}

#[expect(
    clippy::cast_precision_loss,
    reason = "counts of at most a few hundred samples"
)]
fn shape(values: &[&str], today: Date) -> Shape {
    let values: Vec<&str> = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .take(SAMPLE_VALUES)
        .collect();
    if values.is_empty() {
        return Shape::default();
    }
    let share = |test: &dyn Fn(&str) -> bool| {
        values.iter().filter(|value| test(value)).count() as f32 / values.len() as f32
    };
    let ten_years_ago = today.year() - 10;
    Shape {
        samples: values.len(),
        phone: share(&|v| {
            v.chars().filter(char::is_ascii_digit).count() >= 10
                && PhoneE164::parse_with_default(v, CallingCode::INDIA).is_ok()
        }),
        email: share(&|v| v.contains('@') && Email::parse(v).is_ok()),
        sex: share(&|v| loose_sex(v).is_some()),
        date: share(&|v| loose_date(v).is_some()),
        old_dates: share(&|v| loose_date(v).is_some_and(|d| d.year() < ten_years_ago)),
        age: share(&|v| loose_age(v).is_some_and(|age| age <= 110)),
        words: share(&|v| {
            v.chars().any(char::is_alphabetic)
                && v.chars()
                    .all(|c| c.is_alphabetic() || c == ' ' || c == '.' || is_devanagari_sign(c))
                && v.split_whitespace().count() <= 5
                && loose_sex(v).is_none()
        }),
        long_text: share(&|v| v.chars().count() >= 20 && (v.contains(',') || v.contains(' '))),
        serial: values.len() >= 2
            && values
                .iter()
                .map(|v| v.parse::<u64>().ok())
                .collect::<Option<Vec<u64>>>()
                .is_some_and(|numbers| numbers.windows(2).all(|w| w[1] == w[0] + 1)),
    }
}

/// Devanagari vowel signs and marks, which are not letters to `char::is_alphabetic`.
const fn is_devanagari_sign(c: char) -> bool {
    matches!(c, '\u{0900}'..='\u{0903}' | '\u{093a}'..='\u{094f}' | '\u{0951}'..='\u{0957}' | '\u{0962}' | '\u{0963}')
}

impl Shape {
    /// The field the values alone suggest, with confidence.
    fn suggests(&self) -> Option<(ImportField, u8)> {
        if self.samples == 0 || self.serial {
            return None;
        }
        if self.email >= 0.8 {
            return Some((ImportField::Email, 80));
        }
        if self.phone >= 0.8 {
            return Some((ImportField::Phone, 75));
        }
        if self.sex >= 0.9 {
            return Some((ImportField::Sex, 75));
        }
        if self.date >= 0.8 {
            // Mostly older than ten years: births; otherwise visits.
            return Some(if self.old_dates >= 0.5 * self.date {
                (ImportField::DateOfBirth, 55)
            } else {
                (ImportField::LastVisit, 50)
            });
        }
        if self.age >= 0.9 {
            return Some((ImportField::AgeYears, 45));
        }
        if self.long_text >= 0.6 {
            return Some((ImportField::Address, 40));
        }
        if self.words >= 0.8 {
            return Some((ImportField::FullName, 40));
        }
        None
    }

    /// How well the values fit `field`, from 0 to 1; `None` when the values can't tell.
    fn fits(&self, field: ImportField) -> Option<f32> {
        if self.samples < 3 {
            return None;
        }
        match field {
            ImportField::Phone => Some(self.phone),
            ImportField::Email => Some(self.email),
            ImportField::Sex => Some(self.sex),
            ImportField::DateOfBirth | ImportField::LastVisit => Some(self.date),
            ImportField::AgeYears => Some(self.age),
            _ => None,
        }
    }
}

/// Finds the header among the first rows: the row naming the most known fields, else the
/// first with two or more filled cells. Returns its index in `records`.
#[must_use]
pub fn find_header(records: &[(usize, Vec<String>)]) -> Option<usize> {
    let mut best: Option<(usize, usize)> = None;
    for (index, (_, cells)) in records.iter().enumerate().take(HEADER_SEARCH_ROWS) {
        let known = cells
            .iter()
            .filter_map(|cell| header_match(cell))
            .map(|(field, _)| field)
            .collect::<BTreeSet<_>>()
            .len();
        if known > 0 && best.is_none_or(|(_, most)| known > most) {
            best = Some((index, known));
        }
    }
    best.map(|(index, _)| index).or_else(|| {
        records
            .iter()
            .position(|(_, cells)| cells.iter().filter(|c| !c.trim().is_empty()).count() >= 2)
    })
}

/// Suggests a field for each column from its header, its values (`rows` are the data rows)
/// and what the clinic chose before for the same header (`saved`, by [`header_key`]). Each
/// field goes to at most one column: the most confident.
#[must_use]
pub fn suggest(
    headers: &[String],
    rows: &[Vec<String>],
    saved: &BTreeMap<String, ImportField>,
    today: Date,
) -> Vec<Suggestion> {
    let mut candidates: Vec<Suggestion> = headers
        .iter()
        .enumerate()
        .map(|(column, header)| {
            if let Some(field) = saved.get(&header_key(header)) {
                return Suggestion {
                    column,
                    field: Some(*field),
                    confidence: 100,
                    basis: Basis::Saved,
                };
            }
            let values: Vec<&str> = rows
                .iter()
                .filter_map(|row| row.get(column).map(String::as_str))
                .collect();
            let shape = shape(&values, today);
            let by_values = shape.suggests();
            let (field, confidence, basis) = match (header_match(header), by_values) {
                (Some((field, confidence)), _) => match shape.fits(field) {
                    // The header says phone but the values are not phones: trust the values
                    // when they clearly are something else, else lower the confidence.
                    Some(fit) if fit < 0.5 => match by_values {
                        Some((other, value_confidence)) if value_confidence >= 70 => {
                            (Some(other), 60, Basis::Values)
                        }
                        _ => (Some(field), confidence.saturating_sub(35), Basis::Header),
                    },
                    Some(_) => (
                        Some(field),
                        confidence.saturating_add(4).min(99),
                        Basis::HeaderAndValues,
                    ),
                    None => {
                        if by_values.is_some_and(|(other, _)| other == field) {
                            (
                                Some(field),
                                confidence.saturating_add(4).min(99),
                                Basis::HeaderAndValues,
                            )
                        } else {
                            (Some(field), confidence, Basis::Header)
                        }
                    }
                },
                (None, Some((field, confidence))) => (Some(field), confidence, Basis::Values),
                (None, None) => (None, 0, Basis::None),
            };
            Suggestion {
                column,
                field,
                confidence,
                basis,
            }
        })
        .collect();
    // Most confident first claims its field; ties go to the leftmost column.
    let mut order: Vec<usize> = (0..candidates.len()).collect();
    order.sort_by_key(|index| (std::cmp::Reverse(candidates[*index].confidence), *index));
    let mut taken = BTreeSet::new();
    for index in order {
        let suggestion = &mut candidates[index];
        if let Some(field) = suggestion.field
            && !taken.insert(field)
        {
            *suggestion = Suggestion {
                column: suggestion.column,
                field: None,
                confidence: 0,
                basis: Basis::None,
            };
        }
    }
    candidates
}

/// A detail a patient should have that an imported row lacked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Missing {
    /// No usable phone.
    Phone,
    /// Sex not recorded.
    Sex,
    /// Neither a date of birth nor an age.
    DateOfBirth,
}

impl Missing {
    /// Every detail checked.
    pub const ALL: [Self; 3] = [Self::Phone, Self::Sex, Self::DateOfBirth];

    /// The value stored and sent over the API.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Phone => "phone",
            Self::Sex => "sex",
            Self::DateOfBirth => "date_of_birth",
        }
    }

    /// Parses a stored value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|missing| missing.as_str() == text)
    }
}

/// One row read leniently: every readable value, and what was wrong with the rest.
#[derive(Debug, Clone)]
pub struct LenientRow {
    /// Row in the file.
    pub line: usize,
    /// The name; without one the row can't become a patient.
    pub name: Option<PersonName>,
    /// Sex, `Unknown` when blank or unreadable.
    pub sex: Sex,
    /// Date of birth, exact or from an age.
    pub birth_date: Option<BirthDate>,
    /// Phone.
    pub phone: Option<PhoneE164>,
    /// Email.
    pub email: Option<Email>,
    /// Language, English (India) when blank or unreadable.
    pub language: Language,
    /// Address as written.
    pub address: Option<String>,
    /// The last visit, not in the future.
    pub last_visit: Option<Date>,
    /// The clinic's file number.
    pub file_number: Option<String>,
    /// The old software's ID.
    pub legacy_id: Option<String>,
    /// Why the row can't be imported, as `field: problem`. Never echoes values.
    pub errors: Vec<String>,
    /// Values that couldn't be read and were left empty, as `field: problem`.
    pub warnings: Vec<String>,
    /// Details still to collect.
    pub missing: Vec<Missing>,
}

/// Longest address kept.
const MAX_ADDRESS: usize = 500;

/// Reads a mapped row, keeping what is readable. Only a missing or unusable name stops the
/// row; any other unreadable value is left empty with a warning.
#[must_use]
#[expect(
    clippy::too_many_lines,
    reason = "one lenient read per field, in the order shown in the preview"
)]
pub fn read_leniently(row: &MappedRow, today: Date) -> LenientRow {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let name = match row.get(ImportField::FullName) {
        None => {
            errors.push("full_name: missing; a patient needs a name".to_owned());
            None
        }
        Some(text) => PersonName::parse(text).map_or_else(
            |error| {
                errors.push(format!("full_name: {error}"));
                None
            },
            Some,
        ),
    };
    let sex = row
        .get(ImportField::Sex)
        .and_then(|text| {
            let sex = loose_sex(text).and_then(|value| Sex::parse(value).ok());
            if sex.is_none() {
                warnings.push("sex: not readable, left empty".to_owned());
            }
            sex
        })
        .unwrap_or(Sex::Unknown);
    let exact = row.get(ImportField::DateOfBirth).and_then(|text| {
        let birth = loose_date(text).and_then(|date| BirthDate::exact(date, today).ok());
        if birth.is_none() {
            warnings.push("date_of_birth: not a date we can read, left empty".to_owned());
        }
        birth
    });
    // A date of birth wins over an age; spreadsheets often have both.
    let birth_date = exact.or_else(|| {
        row.get(ImportField::AgeYears).and_then(|text| {
            let birth = loose_age(text).and_then(|age| BirthDate::from_age(age, today).ok());
            if birth.is_none() {
                warnings.push("age_years: not an age we can read, left empty".to_owned());
            }
            birth
        })
    });
    let phone = row.get(ImportField::Phone).and_then(|text| {
        let phone = PhoneE164::parse_with_default(text, CallingCode::INDIA).ok();
        if phone.is_none() {
            warnings.push("phone: not a phone number we can read, left empty".to_owned());
        }
        phone
    });
    let email = row.get(ImportField::Email).and_then(|text| {
        let email = Email::parse(text).ok();
        if email.is_none() {
            warnings.push("email: not a valid address, left empty".to_owned());
        }
        email
    });
    let language = row
        .get(ImportField::PreferredLanguage)
        .and_then(|text| {
            let language = Language::parse(text).ok();
            if language.is_none() {
                warnings
                    .push("preferred_language: use a tag such as hi-IN; English kept".to_owned());
            }
            language
        })
        .unwrap_or_else(Language::english_india);
    let address = row.get(ImportField::Address).map(|text| {
        if text.chars().count() > MAX_ADDRESS {
            warnings.push(format!(
                "address: longer than {MAX_ADDRESS} characters, shortened"
            ));
        }
        text.chars().take(MAX_ADDRESS).collect::<String>()
    });
    let last_visit = row
        .get(ImportField::LastVisit)
        .and_then(|text| match loose_date(text) {
            Some(date) if date <= today => Some(date),
            Some(_) => {
                warnings.push("last_visit: in the future, left empty".to_owned());
                None
            }
            None => {
                warnings.push("last_visit: not a date we can read, left empty".to_owned());
                None
            }
        });
    let mut identifier = |field: ImportField| {
        row.get(field).and_then(|text| {
            parse_identifier(text).map_or_else(
                |error| {
                    warnings.push(format!("{}: {error}; left empty", field.key()));
                    None
                },
                Some,
            )
        })
    };
    let file_number = identifier(ImportField::FileNumber);
    let legacy_id = identifier(ImportField::LegacyId);
    let mut missing = Vec::new();
    if phone.is_none() {
        missing.push(Missing::Phone);
    }
    if sex == Sex::Unknown {
        missing.push(Missing::Sex);
    }
    if birth_date.is_none() {
        missing.push(Missing::DateOfBirth);
    }
    LenientRow {
        line: row.line,
        name,
        sex,
        birth_date,
        phone,
        email,
        language,
        address,
        last_visit,
        file_number,
        legacy_id,
        errors,
        warnings,
        missing,
    }
}

/// The key two rows are compared by to find the same person: the phone and the name in lower
/// case with single spaces. Rows without a phone are never called duplicates: families share
/// numbers, and a name alone is not enough.
#[must_use]
pub fn duplicate_key(row: &LenientRow) -> Option<(String, String)> {
    Some((
        row.phone.as_ref()?.as_e164().to_owned(),
        row.name.as_ref()?.as_str().to_lowercase(),
    ))
}

/// Reads data rows through a mapping of field to column index. Blank cells are left out.
#[must_use]
pub fn map_rows(
    records: &[(usize, Vec<String>)],
    mapping: &BTreeMap<ImportField, usize>,
) -> Vec<MappedRow> {
    records
        .iter()
        .map(|(line, cells)| MappedRow {
            line: *line,
            values: mapping
                .iter()
                .filter_map(|(field, column)| {
                    let value = cells.get(*column)?.trim();
                    (!value.is_empty()).then(|| (*field, value.to_owned()))
                })
                .collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    const TODAY: Date = date!(2026 - 10 - 06);

    fn strings(cells: &[&str]) -> Vec<String> {
        cells.iter().map(|c| (*c).to_owned()).collect()
    }

    #[test]
    fn headers_are_recognised_in_three_languages() {
        let cases = [
            ("Patient Name", ImportField::FullName),
            ("NAAV", ImportField::FullName),
            ("रुग्णाचे नाव", ImportField::FullName),
            ("Mobile No.", ImportField::Phone),
            ("Contact", ImportField::Phone),
            ("Patient mobile number", ImportField::Phone),
            ("D.O.B", ImportField::DateOfBirth),
            ("Date of Birth", ImportField::DateOfBirth),
            ("Age (yrs)", ImportField::AgeYears),
            ("Vay", ImportField::AgeYears),
            ("Gender", ImportField::Sex),
            ("Sex (M/F)", ImportField::Sex),
            ("लिंग", ImportField::Sex),
            ("Address", ImportField::Address),
            ("Patta", ImportField::Address),
            ("Last Visit", ImportField::LastVisit),
            ("Date of last visit", ImportField::LastVisit),
            ("Balance", ImportField::Balance),
            ("Baki", ImportField::Balance),
            ("Case No", ImportField::FileNumber),
            ("UHID", ImportField::LegacyId),
        ];
        for (header, field) in cases {
            assert_eq!(header_match(header).map(|m| m.0), Some(field), "{header}");
        }
        assert_eq!(header_match("Father's name"), None);
        assert_eq!(header_match("Doctor phone"), None);
        assert_eq!(header_match("Remarks"), None);
        assert_eq!(header_match("Name").map(|m| m.1), Some(95));
        assert_eq!(header_match("Patient mobile number").map(|m| m.1), Some(75));
    }

    #[test]
    fn the_header_row_is_found_below_a_title() {
        let records = vec![
            (1, strings(&["Sunrise Dental patient list 2025", "", ""])),
            (2, strings(&["", "", ""])),
            (3, strings(&["Sr", "Naav", "Mobile"])),
            (4, strings(&["1", "Priya", "9876543210"])),
        ];
        assert_eq!(find_header(&records), Some(2));
        let plain = vec![(1, strings(&["a", "b"])), (2, strings(&["1", "2"]))];
        assert_eq!(find_header(&plain), Some(0));
    }

    #[test]
    fn columns_are_suggested_from_headers_values_and_memory() {
        let headers = strings(&[
            "Sr", "Naav", "Contact", "Col4", "Col5", "Remarks", "Mobile 2",
        ]);
        let rows = vec![
            strings(&[
                "1",
                "Priya Sharma",
                "98765 43210",
                "F",
                "12/04/1990",
                "ok",
                "x",
            ]),
            strings(&[
                "2",
                "Ravi Kumar",
                "+91 98765 43211",
                "M",
                "01-OCT-1985",
                "",
                "y",
            ]),
            strings(&["3", "Meera", "098765 43212", "f", "1979-02-01", "", "z"]),
        ];
        let saved = BTreeMap::from([(header_key("Remarks"), ImportField::Address)]);
        let suggestions = suggest(&headers, &rows, &saved, TODAY);
        let field = |column: usize| suggestions[column].field;
        assert_eq!(field(0), None);
        assert_eq!(field(1), Some(ImportField::FullName));
        assert_eq!(field(2), Some(ImportField::Phone));
        assert_eq!(suggestions[2].basis, Basis::HeaderAndValues);
        assert_eq!(field(3), Some(ImportField::Sex));
        assert_eq!(suggestions[3].basis, Basis::Values);
        assert_eq!(field(4), Some(ImportField::DateOfBirth));
        assert_eq!(field(5), Some(ImportField::Address));
        assert_eq!(suggestions[5].basis, Basis::Saved);
        assert_eq!(suggestions[5].confidence, 100);
        // "Mobile 2" names a phone, but the phone is taken by a surer column.
        assert_eq!(field(6), None);
    }

    #[test]
    fn a_header_contradicted_by_its_values_is_doubted() {
        let headers = strings(&["Contact"]);
        let rows = vec![
            strings(&["a@x.in"]),
            strings(&["b@y.in"]),
            strings(&["c@z.in"]),
        ];
        let suggestions = suggest(&headers, &rows, &BTreeMap::new(), TODAY);
        assert_eq!(suggestions[0].field, Some(ImportField::Email));
        assert_eq!(suggestions[0].basis, Basis::Values);
    }

    fn mapped(pairs: &[(ImportField, &str)]) -> MappedRow {
        MappedRow {
            line: 5,
            values: pairs
                .iter()
                .map(|(field, value)| (*field, (*value).to_owned()))
                .collect(),
        }
    }

    #[test]
    fn rows_keep_what_is_readable_and_list_what_is_missing() {
        let row = read_leniently(
            &mapped(&[
                (ImportField::FullName, "Priya Sharma"),
                (ImportField::Phone, "12"),
                (ImportField::AgeYears, "36 yrs"),
                (ImportField::LastVisit, "01/01/2030"),
                (ImportField::LegacyId, " P-1 "),
            ]),
            TODAY,
        );
        assert_eq!(row.errors, Vec::<String>::new());
        assert_eq!(row.warnings.len(), 2, "{:?}", row.warnings);
        assert!(
            row.warnings.iter().all(|w| !w.contains("12")),
            "never echoes values"
        );
        assert!(row.birth_date.unwrap().is_estimated());
        assert_eq!(row.missing, [Missing::Phone, Missing::Sex]);
        assert_eq!(row.legacy_id.as_deref(), Some("P-1"));
        assert_eq!(duplicate_key(&row), None);

        let nameless = read_leniently(&mapped(&[(ImportField::Phone, "9876543210")]), TODAY);
        assert_eq!(nameless.errors.len(), 1);
        assert!(nameless.errors[0].starts_with("full_name"));

        let full = read_leniently(
            &mapped(&[
                (ImportField::FullName, "Ravi  Kumar"),
                (ImportField::Phone, "98765 43210"),
                (ImportField::Sex, "पुरुष"),
                (ImportField::DateOfBirth, "12-Apr-1990"),
            ]),
            TODAY,
        );
        assert_eq!(full.missing, []);
        assert_eq!(
            duplicate_key(&full),
            Some(("+919876543210".to_owned(), "ravi kumar".to_owned()))
        );
    }

    #[test]
    fn rows_are_mapped_by_column_index() {
        let records = vec![(4, strings(&["1", "Priya", " ", "F"]))];
        let mapping = BTreeMap::from([
            (ImportField::FullName, 1),
            (ImportField::Phone, 2),
            (ImportField::Sex, 3),
            (ImportField::Email, 9),
        ]);
        let rows = map_rows(&records, &mapping);
        assert_eq!(rows[0].line, 4);
        assert_eq!(rows[0].get(ImportField::FullName), Some("Priya"));
        assert_eq!(rows[0].get(ImportField::Phone), None);
        assert_eq!(rows[0].get(ImportField::Email), None);
    }
}
