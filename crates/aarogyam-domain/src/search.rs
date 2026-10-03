//! What the front desk typed into the patient search box, and how to look it up.

use sakalya_types::{CallingCode, PhoneE164};

use crate::patient::PatientNumber;

/// A search, classified so each kind uses an index that works under row-level security.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatientQuery {
    /// A full patient number such as `SD-1042` (or `sd1042`).
    Number(PatientNumber),
    /// Only digits, shorter than a phone number: the digits of a patient number (`1042`).
    NumberDigits(u64),
    /// A phone number, matched exactly against both phone columns.
    Phone(PhoneE164),
    /// The start of a name, normalised like the stored `search_name`.
    NamePrefix(String),
}

impl PatientQuery {
    /// Fewest characters for a name search; shorter input matches too much to be useful.
    pub const MIN_NAME_CHARS: usize = 2;

    /// Classifies raw search text. Returns `None` for input too short or empty to search.
    #[must_use]
    pub fn classify(raw: &str, default_code: CallingCode) -> Option<Self> {
        let text = raw.trim();
        if text.is_empty() {
            return None;
        }
        if let Ok(number) = PatientNumber::parse(text) {
            return Some(Self::Number(number));
        }
        let phone_like = text
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | ' ' | '-' | '(' | ')'));
        let digits = text.chars().filter(char::is_ascii_digit).count();
        if phone_like
            && digits >= 10
            && let Ok(phone) = PhoneE164::parse_with_default(text, default_code)
        {
            return Some(Self::Phone(phone));
        }
        if text.chars().all(|c| c.is_ascii_digit()) {
            return text.parse().ok().map(Self::NumberDigits);
        }
        let name = normalise_name(text);
        (name.chars().count() >= Self::MIN_NAME_CHARS).then_some(Self::NamePrefix(name))
    }
}

/// Lower-cases and collapses whitespace exactly like the database's generated
/// `patients.search_name` column, so prefix matches line up.
#[must_use]
pub fn normalise_name(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify(text: &str) -> Option<PatientQuery> {
        PatientQuery::classify(text, CallingCode::INDIA)
    }

    #[test]
    fn numbers_phones_and_names() {
        assert_eq!(
            classify("sd-1042"),
            Some(PatientQuery::Number(
                PatientNumber::parse("SD-1042").unwrap()
            ))
        );
        assert_eq!(classify("1042"), Some(PatientQuery::NumberDigits(1042)));
        match classify("98765 43210") {
            Some(PatientQuery::Phone(phone)) => assert_eq!(phone.as_e164(), "+919876543210"),
            other => panic!("expected a phone, got {other:?}"),
        }
        assert_eq!(
            classify("  Priya   SH "),
            Some(PatientQuery::NamePrefix("priya sh".into()))
        );
        assert_eq!(
            classify("प्रि"),
            Some(PatientQuery::NamePrefix("प्रि".into()))
        );
    }

    #[test]
    fn too_little_to_search() {
        assert_eq!(classify(""), None);
        assert_eq!(classify("   "), None);
        assert_eq!(classify("p"), None);
    }

    #[test]
    fn normalisation_matches_the_database_column() {
        assert_eq!(normalise_name("  Priya\t  Sharma "), "priya sharma");
    }
}
