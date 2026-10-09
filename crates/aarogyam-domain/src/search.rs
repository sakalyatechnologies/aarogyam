//! What the front desk typed into the patient search box, and how to look it up.

use sakalya_types::{CallingCode, PhoneE164};

use crate::patient::PatientNumber;

/// A search, classified so each kind uses an index that works under row-level security.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatientQuery {
    /// A full patient number such as `SD-1042` (or `sd1042`).
    Number(PatientNumber),
    /// Digits shorter than a full phone number: the digits of a patient number (`1042`), and
    /// from four digits also the end of a phone number. `number` is `None` when the digits
    /// came with separators (`98 99`), which a patient number never has.
    Digits {
        /// The patient number's digits.
        number: Option<u64>,
        /// The last digits of a phone number.
        phone_tail: Option<PhoneTail>,
    },
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
        let all_digits = text.chars().all(|c| c.is_ascii_digit());
        if all_digits || (phone_like && !text.contains('+') && digits > 0) {
            let compact: String = text.chars().filter(char::is_ascii_digit).collect();
            let number = if all_digits { text.parse().ok() } else { None };
            let phone_tail = PhoneTail::parse(&compact);
            if number.is_some() || phone_tail.is_some() {
                return Some(Self::Digits { number, phone_tail });
            }
        }
        let name = normalise_name(text);
        (name.chars().count() >= Self::MIN_NAME_CHARS).then_some(Self::NamePrefix(name))
    }
}

/// The last digits of a phone number (4 to 15 ASCII digits), as typed into the search box.
/// Its `Debug` hides the digits so a logged query never carries them.
#[derive(Clone, PartialEq, Eq)]
pub struct PhoneTail(String);

impl PhoneTail {
    /// Fewest digits that identify a phone well enough to search on.
    pub const MIN_DIGITS: usize = 4;

    /// `digits` when it is 4 to 15 ASCII digits, the most an E.164 number has.
    #[must_use]
    pub fn parse(digits: &str) -> Option<Self> {
        ((Self::MIN_DIGITS..=15).contains(&digits.len())
            && digits.bytes().all(|b| b.is_ascii_digit()))
        .then(|| Self(digits.to_owned()))
    }

    /// The digits.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for PhoneTail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PhoneTail({} digits)", self.0.len())
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
        assert_eq!(
            classify("1042"),
            Some(PatientQuery::Digits {
                number: Some(1042),
                phone_tail: PhoneTail::parse("1042"),
            })
        );
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
    fn phone_tails() {
        // Too short for a phone tail: only a patient number.
        assert_eq!(
            classify("42"),
            Some(PatientQuery::Digits {
                number: Some(42),
                phone_tail: None,
            })
        );
        // Separators: only a phone tail, compacted.
        assert_eq!(
            classify("98 99"),
            Some(PatientQuery::Digits {
                number: None,
                phone_tail: PhoneTail::parse("9899"),
            })
        );
        // Leading zeros stay in the tail.
        match classify("0099") {
            Some(PatientQuery::Digits {
                phone_tail: Some(tail),
                ..
            }) => assert_eq!(tail.as_str(), "0099"),
            other => panic!("expected a phone tail, got {other:?}"),
        }
        assert!(PhoneTail::parse("123").is_none());
        assert!(PhoneTail::parse("12a4").is_none());
        assert!(PhoneTail::parse("1234567890123456").is_none());
    }

    #[test]
    fn phone_tail_debug_hides_the_digits() {
        let tail = PhoneTail::parse("98765").unwrap();
        assert_eq!(format!("{tail:?}"), "PhoneTail(5 digits)");
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
