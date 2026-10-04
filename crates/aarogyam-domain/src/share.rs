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
}
