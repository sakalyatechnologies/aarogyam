//! The patient app: link codes a clinic issues, the states of a link between a patient account
//! and a clinic's record, and when a patient may cancel their own appointment.
//!
//! A patient account reads a clinic's records only through an active link, made by a code the
//! clinic issued or by a match the clinic confirmed; never automatically by phone or name
//! (`docs/patient-access.md`, section 3).

use std::fmt;

use time::{Duration, OffsetDateTime};

use crate::schedule::AppointmentStatus;

/// How long a link code works after the clinic issues it.
pub const LINK_CODE_LIFETIME: Duration = Duration::days(7);

/// Characters a link code uses: Crockford's base 32, without I, L, O and U, so it reads aloud
/// and types without confusion.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Characters in a code (50 bits).
const CODE_LEN: usize = 10;

/// A one-time code that links a patient account to one clinic record, such as `7KQ2M-X9D4T`.
/// Stored only as a hash; shown once to the clinic (as text and a QR code) and emailed to the
/// patient.
#[derive(Clone, PartialEq, Eq)]
pub struct LinkCode(String);

impl fmt::Debug for LinkCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LinkCode(..)")
    }
}

/// Text that isn't a link code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a link code is 10 letters and digits, such as 7KQ2M-X9D4T")]
pub struct InvalidLinkCode;

impl LinkCode {
    /// A code from 7 random bytes (the first 50 bits are used).
    #[must_use]
    pub fn from_random(bytes: [u8; 7]) -> Self {
        let mut bits = u64::from_be_bytes([
            0, bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6],
        ]) >> 6;
        let mut code = [0_u8; CODE_LEN];
        for slot in code.iter_mut().rev() {
            *slot = ALPHABET[usize::try_from(bits & 31).unwrap_or(0)];
            bits >>= 5;
        }
        Self(code.iter().map(|&b| char::from(b)).collect())
    }

    /// Reads a code as a person typed it: any case, with or without spaces and dashes; `O` is
    /// read as zero and `I` or `L` as one.
    ///
    /// # Errors
    /// [`InvalidLinkCode`] unless it is 10 characters of the code alphabet.
    pub fn parse(text: &str) -> Result<Self, InvalidLinkCode> {
        let mut code = String::with_capacity(CODE_LEN);
        for c in text.chars() {
            let c = match c.to_ascii_uppercase() {
                ' ' | '-' => continue,
                'O' => '0',
                'I' | 'L' => '1',
                other => other,
            };
            if !c.is_ascii() || !ALPHABET.contains(&(c as u8)) {
                return Err(InvalidLinkCode);
            }
            code.push(c);
        }
        if code.len() == CODE_LEN {
            Ok(Self(code))
        } else {
            Err(InvalidLinkCode)
        }
    }

    /// The code without separators, which is what is hashed.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The code as shown and emailed: two groups of five, `7KQ2M-X9D4T`.
    #[must_use]
    pub fn display(&self) -> String {
        let (head, tail) = self.0.split_at(CODE_LEN / 2);
        format!("{head}-{tail}")
    }
}

macro_rules! link_enum {
    ($(#[$doc:meta])* $name:ident { $($(#[$vdoc:meta])* $variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $name {
            $($(#[$vdoc])* $variant,)+
        }

        impl $name {
            /// The stored text.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text,)+ }
            }

            /// Parses the stored text.
            #[must_use]
            pub fn parse(text: &str) -> Option<Self> {
                match text { $($text => Some(Self::$variant),)+ _ => None }
            }
        }
    };
}

link_enum!(
    /// Where a link between a patient account and a clinic's record stands.
    LinkStatus {
        /// The patient asked for a match; the clinic hasn't confirmed it.
        Pending => "pending",
        /// The account reads the record's appointments, prescriptions, bills and shared files.
        Active => "active",
        /// The clinic turned the match down, or a code settled it.
        Declined => "declined",
        /// Ended by the patient or the clinic.
        Revoked => "revoked",
    }
);

link_enum!(
    /// How a link was made.
    LinkedVia {
        /// The patient redeemed a code the clinic issued.
        Code => "code",
        /// The clinic confirmed a match the patient asked for.
        ClinicConfirmed => "clinic_confirmed",
    }
);

link_enum!(
    /// What redeeming a link code did.
    RedeemOutcome {
        /// A new link.
        Linked => "linked",
        /// The account already held this record's link.
        AlreadyLinked => "already_linked",
        /// The account is linked to another record at the clinic.
        OtherRecord => "other_record",
        /// Another account holds this record's link.
        Taken => "taken",
    }
);

/// Whether a patient may still cancel an appointment themselves: it is waiting, booked or
/// confirmed, and starts at least `notice` from `now` (the clinic's minimum booking notice, so
/// a slot freed late can still be taken).
#[must_use]
pub fn patient_may_cancel(
    status: AppointmentStatus,
    starts_at: OffsetDateTime,
    now: OffsetDateTime,
    notice: Duration,
) -> bool {
    matches!(
        status,
        AppointmentStatus::Requested | AppointmentStatus::Booked | AppointmentStatus::Confirmed
    ) && starts_at - now >= notice
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_use_fifty_random_bits_in_the_alphabet() {
        let zero = LinkCode::from_random([0; 7]);
        assert_eq!(zero.as_str(), "0000000000");
        let ones = LinkCode::from_random([0xff; 7]);
        assert_eq!(ones.as_str(), "ZZZZZZZZZZ");
        let code = LinkCode::from_random([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde]);
        assert_eq!(code.as_str().len(), 10);
        assert!(code.as_str().bytes().all(|b| ALPHABET.contains(&b)));
        assert_eq!(code.display().len(), 11);
        assert_eq!(&code.display()[5..6], "-");
        assert_eq!(format!("{code:?}"), "LinkCode(..)");
    }

    #[test]
    fn typed_codes_are_forgiving_but_strict_about_length() {
        let code = LinkCode::from_random([1, 2, 3, 4, 5, 6, 7]);
        assert_eq!(LinkCode::parse(&code.display()).unwrap(), code);
        assert_eq!(
            LinkCode::parse(&code.display().to_lowercase()).unwrap(),
            code
        );
        assert_eq!(
            LinkCode::parse(" 7kq2m x9d4t ").unwrap().as_str(),
            "7KQ2MX9D4T"
        );
        assert_eq!(
            LinkCode::parse("OIL00-00000").unwrap().as_str(),
            "0110000000"
        );
        assert_eq!(LinkCode::parse("7KQ2M-X9D4"), Err(InvalidLinkCode));
        assert_eq!(LinkCode::parse("7KQ2M-X9D4TT"), Err(InvalidLinkCode));
        assert_eq!(LinkCode::parse("7KQ2M-X9D4U"), Err(InvalidLinkCode));
        assert_eq!(LinkCode::parse("7KQ2M_X9D4T"), Err(InvalidLinkCode));
        assert_eq!(LinkCode::parse("7KQ2M-X9D4é"), Err(InvalidLinkCode));
    }

    #[test]
    fn statuses_round_trip() {
        for status in [
            LinkStatus::Pending,
            LinkStatus::Active,
            LinkStatus::Declined,
            LinkStatus::Revoked,
        ] {
            assert_eq!(LinkStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(LinkedVia::parse("code"), Some(LinkedVia::Code));
        assert_eq!(RedeemOutcome::parse("taken"), Some(RedeemOutcome::Taken));
        assert_eq!(LinkStatus::parse("other"), None);
    }

    #[test]
    fn patients_cancel_only_open_appointments_with_notice() {
        let now = OffsetDateTime::UNIX_EPOCH + Duration::days(20_000);
        let notice = Duration::hours(2);
        let later = now + Duration::hours(3);
        assert!(patient_may_cancel(
            AppointmentStatus::Requested,
            later,
            now,
            notice
        ));
        assert!(patient_may_cancel(
            AppointmentStatus::Confirmed,
            later,
            now,
            notice
        ));
        assert!(patient_may_cancel(
            AppointmentStatus::Booked,
            now + notice,
            now,
            notice
        ));
        assert!(!patient_may_cancel(
            AppointmentStatus::Booked,
            now + Duration::hours(1),
            now,
            notice
        ));
        assert!(!patient_may_cancel(
            AppointmentStatus::Arrived,
            later,
            now,
            notice
        ));
        assert!(!patient_may_cancel(
            AppointmentStatus::Cancelled,
            later,
            now,
            notice
        ));
        assert!(!patient_may_cancel(
            AppointmentStatus::Completed,
            later,
            now,
            notice
        ));
    }
}
