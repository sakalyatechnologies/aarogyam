//! Patients: the validated values a clinic records about a person.

use std::fmt;

use sakalya_types::PhoneE164;
use time::{Date, Month};

/// Why a patient value was rejected. Messages name the field, never the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PatientError {
    /// The name is empty, too long, or contains control characters.
    #[error("full_name must be 1 to 200 characters of text")]
    Name,
    /// The clinic's number prefix is not 1 to 3 capital letters.
    #[error("number prefix must be 1 to 3 capital letters")]
    Prefix,
    /// The patient number is not a prefix, a hyphen and digits.
    #[error("number must look like SD-1042")]
    Number,
    /// The date of birth is in the future or before 1900.
    #[error("date_of_birth must be between 1900 and today")]
    BirthDate,
    /// The age is over 130.
    #[error("age_years must be between 0 and 130")]
    Age,
    /// Both a date of birth and an age were given.
    #[error("give date_of_birth or age_years, not both")]
    BirthDateAndAge,
    /// The email address is not plausible.
    #[error("email is not a valid address")]
    Email,
    /// The language tag is not like `en-IN`.
    #[error("preferred_language must look like en-IN")]
    Language,
    /// A status or sex value the database doesn't know.
    #[error("unknown value")]
    UnknownValue,
}

macro_rules! text_enum {
    ($(#[$doc:meta])* $name:ident { $($(#[$vdoc:meta])* $variant:ident => $text:literal),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($(#[$vdoc])* $variant,)*
        }

        impl $name {
            /// The value stored in the database and sent over the API.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text,)* }
            }

            /// Parses the stored value.
            ///
            /// # Errors
            /// [`PatientError::UnknownValue`] for anything else.
            pub fn parse(text: &str) -> Result<Self, PatientError> {
                match text { $($text => Ok(Self::$variant),)* _ => Err(PatientError::UnknownValue) }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

text_enum!(
    /// Sex as recorded by the clinic.
    Sex {
        /// Female.
        Female => "female",
        /// Male.
        Male => "male",
        /// Another sex.
        Other => "other",
        /// Not recorded.
        Unknown => "unknown",
    }
);

text_enum!(
    /// Whether a patient record is in use.
    PatientStatus {
        /// A current patient.
        Active => "active",
        /// Not seen for a long time, or moved away.
        Inactive => "inactive",
        /// The patient has died.
        Deceased => "deceased",
        /// Merged into another record; reads resolve to that one.
        Merged => "merged",
    }
);

/// The 1 to 3 capital letters that start a clinic's patient numbers: `SD` in `SD-1042`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumberPrefix(Box<str>);

impl NumberPrefix {
    /// Validates a prefix.
    ///
    /// # Errors
    /// [`PatientError::Prefix`] unless the text is 1 to 3 ASCII capital letters.
    pub fn parse(text: &str) -> Result<Self, PatientError> {
        if (1..=3).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_uppercase()) {
            Ok(Self(text.into()))
        } else {
            Err(PatientError::Prefix)
        }
    }

    /// The prefix text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A clinic's readable patient number, such as `SD-1042`. Unique within the clinic, used in
/// URLs and said aloud; never reused.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PatientNumber(Box<str>);

impl PatientNumber {
    /// The number issued as `value` under `prefix`.
    #[must_use]
    pub fn new(prefix: &NumberPrefix, value: u64) -> Self {
        Self(format!("{}-{value}", prefix.as_str()).into())
    }

    /// Validates a stored or typed number (case-insensitive, hyphen optional: `sd1042`).
    ///
    /// # Errors
    /// [`PatientError::Number`] unless it is 1 to 3 letters, an optional hyphen and 1 to 12 digits.
    pub fn parse(text: &str) -> Result<Self, PatientError> {
        let text = text.trim();
        let letters = text.bytes().take_while(u8::is_ascii_alphabetic).count();
        let rest = text[letters..]
            .strip_prefix('-')
            .unwrap_or(&text[letters..]);
        if (1..=3).contains(&letters)
            && (1..=12).contains(&rest.len())
            && rest.bytes().all(|b| b.is_ascii_digit())
        {
            Ok(Self(
                format!("{}-{rest}", text[..letters].to_ascii_uppercase()).into(),
            ))
        } else {
            Err(PatientError::Number)
        }
    }

    /// The number text, such as `SD-1042`.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for PatientNumber {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A person's name as entered: trimmed, inner whitespace collapsed to single spaces,
/// 1 to 200 characters, no control characters. Any script is allowed.
#[derive(Clone, PartialEq, Eq)]
pub struct PersonName(Box<str>);

impl PersonName {
    /// Most characters a name may have.
    pub const MAX_CHARS: usize = 200;

    /// Validates and normalises a name.
    ///
    /// # Errors
    /// [`PatientError::Name`] when empty after trimming, too long, or containing control characters.
    pub fn parse(text: &str) -> Result<Self, PatientError> {
        if text.chars().any(char::is_control)
            && text.chars().any(|c| c.is_control() && !c.is_whitespace())
        {
            return Err(PatientError::Name);
        }
        let normalised = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let chars = normalised.chars().count();
        if chars == 0 || chars > Self::MAX_CHARS {
            return Err(PatientError::Name);
        }
        Ok(Self(normalised.into()))
    }

    /// The name text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Names are personal data: debug output shows only the length.
impl fmt::Debug for PersonName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "PersonName({} chars)", self.0.chars().count())
    }
}

/// A plausible email address, lower-cased. Deliverability is proven by sending, not here.
#[derive(Clone, PartialEq, Eq)]
pub struct Email(Box<str>);

impl Email {
    /// Validates an address.
    ///
    /// # Errors
    /// [`PatientError::Email`] unless it has one `@` with text on both sides, a dot in the
    /// domain, no spaces, and at most 254 characters.
    pub fn parse(text: &str) -> Result<Self, PatientError> {
        let text = text.trim().to_lowercase();
        let valid = text.len() <= 254
            && !text.contains(char::is_whitespace)
            && text.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty()
                    && !domain.contains('@')
                    && domain.contains('.')
                    && !domain.starts_with('.')
                    && !domain.ends_with('.')
            });
        if valid {
            Ok(Self(text.into()))
        } else {
            Err(PatientError::Email)
        }
    }

    /// The address.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Email {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Email(***)")
    }
}

/// A language tag such as `en-IN`, `hi-IN` or `mr-IN`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Language(Box<str>);

impl Language {
    /// Validates a tag of two lower-case letters, a hyphen and two capitals.
    ///
    /// # Errors
    /// [`PatientError::Language`] for anything else.
    pub fn parse(text: &str) -> Result<Self, PatientError> {
        let bytes = text.as_bytes();
        let valid = bytes.len() == 5
            && bytes[..2].iter().all(u8::is_ascii_lowercase)
            && bytes[2] == b'-'
            && bytes[3..].iter().all(u8::is_ascii_uppercase);
        if valid {
            Ok(Self(text.into()))
        } else {
            Err(PatientError::Language)
        }
    }

    /// The default for Indian clinics.
    #[must_use]
    pub fn english_india() -> Self {
        Self("en-IN".into())
    }

    /// The tag.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A date of birth, either known or estimated from an age the patient gave.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BirthDate {
    /// The actual date.
    Exact(Date),
    /// Estimated from an age: the same day and month as today, that many years ago.
    Estimated(Date),
}

impl BirthDate {
    /// Oldest age accepted.
    pub const MAX_AGE: u16 = 130;

    /// A known date of birth.
    ///
    /// # Errors
    /// [`PatientError::BirthDate`] when after `today` or before 1900.
    pub fn exact(date: Date, today: Date) -> Result<Self, PatientError> {
        if date > today || date.year() < 1900 {
            Err(PatientError::BirthDate)
        } else {
            Ok(Self::Exact(date))
        }
    }

    /// A date of birth estimated from an age in years.
    ///
    /// # Errors
    /// [`PatientError::Age`] when the age is over [`Self::MAX_AGE`].
    pub fn from_age(age_years: u16, today: Date) -> Result<Self, PatientError> {
        if age_years > Self::MAX_AGE {
            return Err(PatientError::Age);
        }
        let year = today.year() - i32::from(age_years);
        // 29 February doesn't exist in every year; use 28 February then.
        let date = Date::from_calendar_date(year, today.month(), today.day())
            .or_else(|_| Date::from_calendar_date(year, Month::February, 28))
            .map_err(|_| PatientError::Age)?;
        Ok(Self::Estimated(date))
    }

    /// The date, exact or estimated.
    #[must_use]
    pub const fn date(self) -> Date {
        match self {
            Self::Exact(date) | Self::Estimated(date) => date,
        }
    }

    /// Whether the date was estimated from an age.
    #[must_use]
    pub const fn is_estimated(self) -> bool {
        matches!(self, Self::Estimated(_))
    }

    /// Age in whole years on `today`.
    #[must_use]
    pub fn age_on(self, today: Date) -> u16 {
        let born = self.date();
        let mut years = today.year() - born.year();
        if (today.month() as u8, today.day()) < (born.month() as u8, born.day()) {
            years -= 1;
        }
        u16::try_from(years.max(0)).unwrap_or(0)
    }
}

/// A patient as registered: every field validated.
#[derive(Debug, Clone)]
pub struct NewPatient {
    /// Full name.
    pub full_name: PersonName,
    /// Sex.
    pub sex: Sex,
    /// Date of birth, if known or estimated.
    pub birth_date: Option<BirthDate>,
    /// Contact phone; contact information, never identity.
    pub phone: Option<PhoneE164>,
    /// Contact email.
    pub email: Option<Email>,
    /// Language for messages and printouts.
    pub preferred_language: Language,
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn names_are_normalised_and_bounded() {
        assert_eq!(
            PersonName::parse("  Priya   Sharma ").unwrap().as_str(),
            "Priya Sharma"
        );
        assert_eq!(
            PersonName::parse("प्रिया शर्मा").unwrap().as_str(),
            "प्रिया शर्मा"
        );
        assert_eq!(PersonName::parse("   "), Err(PatientError::Name));
        assert_eq!(PersonName::parse("Priya\u{0}"), Err(PatientError::Name));
        assert!(PersonName::parse(&"a".repeat(200)).is_ok());
        assert_eq!(PersonName::parse(&"a".repeat(201)), Err(PatientError::Name));
    }

    #[test]
    fn debug_never_shows_personal_values() {
        let name = PersonName::parse("Priya Sharma").unwrap();
        assert!(!format!("{name:?}").contains("Priya"));
        let email = Email::parse("priya@example.in").unwrap();
        assert!(!format!("{email:?}").contains("priya"));
    }

    #[test]
    fn patient_numbers_normalise() {
        let prefix = NumberPrefix::parse("SD").unwrap();
        assert_eq!(PatientNumber::new(&prefix, 1042).as_str(), "SD-1042");
        assert_eq!(PatientNumber::parse("sd1042").unwrap().as_str(), "SD-1042");
        assert_eq!(PatientNumber::parse(" SD-7 ").unwrap().as_str(), "SD-7");
        assert_eq!(PatientNumber::parse("1042"), Err(PatientError::Number));
        assert_eq!(PatientNumber::parse("ABCD-1"), Err(PatientError::Number));
        assert_eq!(PatientNumber::parse("SD-"), Err(PatientError::Number));
        assert_eq!(NumberPrefix::parse("sd"), Err(PatientError::Prefix));
    }

    #[test]
    fn birth_dates_from_age_and_exact() {
        let today = date!(2026 - 10 - 03);
        let estimated = BirthDate::from_age(36, today).unwrap();
        assert_eq!(estimated.date(), date!(1990 - 10 - 03));
        assert!(estimated.is_estimated());
        assert_eq!(estimated.age_on(today), 36);
        let leap = BirthDate::from_age(1, date!(2028 - 02 - 29)).unwrap();
        assert_eq!(leap.date(), date!(2027 - 02 - 28));
        assert_eq!(BirthDate::from_age(131, today), Err(PatientError::Age));
        assert_eq!(
            BirthDate::exact(date!(2026 - 10 - 04), today),
            Err(PatientError::BirthDate)
        );
        assert_eq!(
            BirthDate::exact(date!(1899 - 12 - 31), today),
            Err(PatientError::BirthDate)
        );
        assert_eq!(
            BirthDate::exact(date!(1990 - 10 - 04), today)
                .unwrap()
                .age_on(today),
            35
        );
    }

    #[test]
    fn emails_and_languages() {
        assert_eq!(
            Email::parse(" Priya@Example.IN ").unwrap().as_str(),
            "priya@example.in"
        );
        for bad in [
            "priya",
            "@example.in",
            "priya@",
            "pri ya@example.in",
            "priya@example",
            "a@b@c.in",
        ] {
            assert_eq!(Email::parse(bad), Err(PatientError::Email), "{bad}");
        }
        assert!(Language::parse("mr-IN").is_ok());
        assert_eq!(Language::parse("english"), Err(PatientError::Language));
    }

    #[test]
    fn text_enums_round_trip() {
        for sex in [Sex::Female, Sex::Male, Sex::Other, Sex::Unknown] {
            assert_eq!(Sex::parse(sex.as_str()), Ok(sex));
        }
        assert_eq!(PatientStatus::parse("merged"), Ok(PatientStatus::Merged));
        assert_eq!(Sex::parse("f"), Err(PatientError::UnknownValue));
    }
}
