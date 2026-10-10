//! Patient links: a clinic sends an expiring link, and the patient opens it with the PIN
//! printed on the paper. Wrong PINs are limited.

use time::{Duration, OffsetDateTime};

/// How long a link works.
pub const LINK_LIFETIME: Duration = Duration::days(7);

/// Wrong PINs before the link locks for good; the clinic sends a new one.
pub const MAX_PIN_ATTEMPTS: i32 = 5;

/// A six-digit PIN as typed by the patient.
#[derive(Clone, PartialEq, Eq)]
pub struct Pin(String);

impl Pin {
    /// Accepts exactly six digits, ignoring spaces around them.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        (text.len() == 6 && text.bytes().all(|b| b.is_ascii_digit())).then(|| Self(text.to_owned()))
    }

    /// The digits.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Pin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Pin(******)")
    }
}

/// Whether a link can be opened now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkState {
    /// Open it with the PIN.
    Usable,
    /// Past its expiry, or revoked by the clinic.
    Expired,
    /// Too many wrong PINs.
    Locked,
}

impl LinkState {
    /// Decides from the stored link.
    #[must_use]
    pub fn of(
        now: OffsetDateTime,
        expires_at: OffsetDateTime,
        revoked: bool,
        locked: bool,
    ) -> Self {
        if locked {
            Self::Locked
        } else if revoked || now >= expires_at {
            Self::Expired
        } else {
            Self::Usable
        }
    }
}

/// A kind of record a link to a patient's records can show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordType {
    /// The current dental chart.
    Chart,
    /// The patient's X-rays.
    Xrays,
    /// Issued bills.
    Bills,
}

impl RecordType {
    /// Every kind, in the order links list them.
    pub const ALL: [Self; 3] = [Self::Chart, Self::Xrays, Self::Bills];

    /// The name used in requests and stored on the link.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Chart => "chart",
            Self::Xrays => "xrays",
            Self::Bills => "bills",
        }
    }

    /// Parses `chart`, `xrays` or `bills`.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.as_str() == text)
    }
}

/// Parses the record types of a request: one to three different kinds, listed in the fixed
/// order whatever order they came in.
///
/// # Errors
/// [`ShareError::RecordTypes`] for none, an unknown kind or a repeat.
pub fn check_record_types(names: &[String]) -> Result<Vec<RecordType>, ShareError> {
    let mut kinds = Vec::new();
    for name in names {
        let kind = RecordType::parse(name).ok_or(ShareError::RecordTypes)?;
        if kinds.contains(&kind) {
            return Err(ShareError::RecordTypes);
        }
        kinds.push(kind);
    }
    if kinds.is_empty() {
        return Err(ShareError::RecordTypes);
    }
    kinds.sort_by_key(|kind| RecordType::ALL.iter().position(|k| k == kind));
    Ok(kinds)
}

/// How long a link to records works: the clinic's choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expiry {
    /// One hour.
    OneHour,
    /// Twenty-four hours.
    OneDay,
    /// Seven days.
    SevenDays,
}

impl Expiry {
    /// Parses `1h`, `24h` or `7d`.
    ///
    /// # Errors
    /// [`ShareError::Expiry`] for anything else.
    pub fn parse(text: &str) -> Result<Self, ShareError> {
        match text {
            "1h" => Ok(Self::OneHour),
            "24h" => Ok(Self::OneDay),
            "7d" => Ok(Self::SevenDays),
            _ => Err(ShareError::Expiry),
        }
    }

    /// The time from creation.
    #[must_use]
    pub const fn duration(self) -> Duration {
        match self {
            Self::OneHour => Duration::hours(1),
            Self::OneDay => Duration::hours(24),
            Self::SevenDays => LINK_LIFETIME,
        }
    }
}

/// Why a link to records was refused. Messages name the field, never the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ShareError {
    /// None, an unknown kind or a repeat.
    #[error("record_types must list one to three of chart, xrays and bills, each once")]
    RecordTypes,
    /// Not one of the offered lifetimes.
    #[error("expires_in must be 1h, 24h or 7d")]
    Expiry,
}

impl ShareError {
    /// The request field the error concerns.
    #[must_use]
    pub const fn field(self) -> &'static str {
        match self {
            Self::RecordTypes => "record_types",
            Self::Expiry => "expires_in",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn pins_are_six_digits_and_never_printed() {
        assert_eq!(Pin::parse(" 042917 ").unwrap().as_str(), "042917");
        assert!(Pin::parse("42917").is_none());
        assert!(Pin::parse("04291a").is_none());
        assert_eq!(
            format!("{:?}", Pin::parse("123456").unwrap()),
            "Pin(******)"
        );
    }

    #[test]
    fn links_expire_and_lock() {
        let now = datetime!(2026-10-04 10:00 UTC);
        let later = now + LINK_LIFETIME;
        assert_eq!(LinkState::of(now, later, false, false), LinkState::Usable);
        assert_eq!(
            LinkState::of(later, later, false, false),
            LinkState::Expired
        );
        assert_eq!(LinkState::of(now, later, true, false), LinkState::Expired);
        assert_eq!(LinkState::of(now, later, false, true), LinkState::Locked);
    }

    #[test]
    fn record_links_take_known_types_and_lifetimes() {
        let names = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            check_record_types(&names(&["bills", "chart"])),
            Ok(vec![RecordType::Chart, RecordType::Bills])
        );
        for bad in [&[][..], &["chart", "chart"], &["notes"]] {
            assert_eq!(
                check_record_types(&names(bad)),
                Err(ShareError::RecordTypes)
            );
        }
        assert_eq!(
            Expiry::parse("24h").unwrap().duration(),
            Duration::hours(24)
        );
        assert_eq!(Expiry::parse("7d").unwrap().duration(), LINK_LIFETIME);
        assert_eq!(Expiry::parse("2h"), Err(ShareError::Expiry));
    }
}
