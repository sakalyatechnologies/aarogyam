//! Notice and consent records (DPDP Act 2023): what a patient agreed to, which version of the
//! clinic's notice they were shown, when and how, and whether they have withdrawn.

/// Longest notice-version label.
pub const MAX_VERSION: usize = 40;
/// Longest note.
pub const MAX_NOTE: usize = 500;
/// The notice version recorded when the caller names none (a walk-in at the desk). Clinics
/// can't set their own yet; until they can, this is the label of the template notice
/// (`web/apps/website` legal pages).
pub const DEFAULT_NOTICE_VERSION: &str = "v1 2026-10";

text_value! {
    /// What the patient agreed to.
    Purpose ("purpose") {
        /// Keeping their record and treating them. The clinic's core purpose.
        Care => "care",
        /// Appointment and recall reminders by SMS, `WhatsApp` or email.
        Reminders => "reminders",
        /// Offers and promotional messages.
        Promotional => "promotional",
        /// Sharing records with another clinic or doctor they name.
        Sharing => "sharing",
        /// Use of de-identified data for research or teaching.
        Research => "research",
    }
}

text_value! {
    /// How the patient gave or withdrew consent.
    Method ("method") {
        /// A signed or ticked paper form.
        Paper => "paper",
        /// Said aloud and noted by staff.
        Verbal => "verbal",
        /// Accepted in an app or the booking page.
        App => "app",
    }
}

text_value! {
    /// Where a consent record stands.
    Status ("status") {
        /// In force.
        Given => "given",
        /// The patient withdrew it. The record stays as history.
        Withdrawn => "withdrawn",
    }
}

/// Why a consent value was refused. Messages never echo the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ConsentError {
    /// The notice version is empty, padded or too long.
    #[error("must be 1 to {MAX_VERSION} characters, without spaces at either end")]
    Version,
    /// The note is too long or has control characters.
    #[error("must be at most {MAX_NOTE} characters of plain text")]
    Note,
}

/// Checks a notice-version label such as `v1 2026-10`.
///
/// # Errors
/// [`ConsentError::Version`] when empty, padded or longer than [`MAX_VERSION`].
pub fn version(text: &str) -> Result<&str, ConsentError> {
    let length = text.chars().count();
    if text != text.trim()
        || length == 0
        || length > MAX_VERSION
        || text.chars().any(char::is_control)
    {
        return Err(ConsentError::Version);
    }
    Ok(text)
}

/// Checks an optional note; blank becomes `None`.
///
/// # Errors
/// [`ConsentError::Note`] when longer than [`MAX_NOTE`] or holding control characters.
pub fn note(text: Option<&str>) -> Result<Option<&str>, ConsentError> {
    let Some(text) = text.map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    if text.chars().count() > MAX_NOTE || text.chars().any(|c| c.is_control() && c != '\n') {
        return Err(ConsentError::Note);
    }
    Ok(Some(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_short_trimmed_labels() {
        assert_eq!(version("v1 2026-10"), Ok("v1 2026-10"));
        assert_eq!(version(""), Err(ConsentError::Version));
        assert_eq!(version(" v1"), Err(ConsentError::Version));
        assert_eq!(version(&"a".repeat(41)), Err(ConsentError::Version));
    }

    #[test]
    fn notes_are_optional_and_bounded() {
        assert_eq!(note(None), Ok(None));
        assert_eq!(note(Some("  ")), Ok(None));
        assert_eq!(note(Some(" signed form 12 ")), Ok(Some("signed form 12")));
        assert_eq!(note(Some(&"a".repeat(501))), Err(ConsentError::Note));
    }

    #[test]
    fn values_round_trip() {
        for purpose in Purpose::ALL {
            assert_eq!(Purpose::parse(purpose.as_str()), Ok(*purpose));
        }
        assert!(Method::parse("fax").is_err());
    }
}
