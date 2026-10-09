//! Support grants: a clinic owner lets one named Sakalya staff member read the clinic's
//! records, for a stated reason, from now until an end at most seven days away
//! (`docs/decisions.md`, "Support grants").

use time::{Duration, OffsetDateTime};

/// The longest a grant may run.
pub const MAX_LENGTH: Duration = Duration::days(7);

/// The shortest a grant may run, so it doesn't end before anyone can use it.
pub const MIN_LENGTH: Duration = Duration::minutes(15);

/// Why a grant was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum GrantError {
    /// The reason is too short or too long.
    #[error("must be 3 to 500 characters")]
    Reason,
    /// The end is less than 15 minutes away.
    #[error("must be at least 15 minutes from now")]
    TooSoon,
    /// The end is more than seven days away.
    #[error("must be at most 7 days from now")]
    TooLate,
}

/// The reason for a grant: trimmed, 3 to 500 characters.
///
/// # Errors
/// [`GrantError::Reason`] otherwise.
pub fn reason(text: &str) -> Result<String, GrantError> {
    let text = text.trim();
    if (3..=500).contains(&text.chars().count()) {
        Ok(text.to_owned())
    } else {
        Err(GrantError::Reason)
    }
}

/// Checks the end of a grant that starts at `now`.
///
/// # Errors
/// [`GrantError::TooSoon`] or [`GrantError::TooLate`].
pub fn check_end(now: OffsetDateTime, ends_at: OffsetDateTime) -> Result<(), GrantError> {
    if ends_at < now + MIN_LENGTH {
        Err(GrantError::TooSoon)
    } else if ends_at > now + MAX_LENGTH {
        Err(GrantError::TooLate)
    } else {
        Ok(())
    }
}

/// Where a grant stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantStatus {
    /// The staff member may read now.
    Active,
    /// It reached its end.
    Ended,
    /// The clinic revoked it.
    Revoked,
}

impl GrantStatus {
    /// The grant's state at `now`.
    #[must_use]
    pub fn at(
        ends_at: OffsetDateTime,
        revoked_at: Option<OffsetDateTime>,
        now: OffsetDateTime,
    ) -> Self {
        if revoked_at.is_some() {
            Self::Revoked
        } else if ends_at <= now {
            Self::Ended
        } else {
            Self::Active
        }
    }

    /// The value sent to clients.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Ended => "ended",
            Self::Revoked => "revoked",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grants_run_between_fifteen_minutes_and_seven_days() {
        let now = OffsetDateTime::UNIX_EPOCH;
        assert_eq!(
            check_end(now, now + Duration::minutes(14)),
            Err(GrantError::TooSoon)
        );
        assert_eq!(check_end(now, now + Duration::minutes(15)), Ok(()));
        assert_eq!(check_end(now, now + Duration::days(7)), Ok(()));
        assert_eq!(
            check_end(now, now + Duration::days(7) + Duration::seconds(1)),
            Err(GrantError::TooLate)
        );
    }

    #[test]
    fn status_follows_revocation_then_the_end() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let later = now + Duration::hours(1);
        assert_eq!(GrantStatus::at(later, None, now), GrantStatus::Active);
        assert_eq!(GrantStatus::at(now, None, now), GrantStatus::Ended);
        assert_eq!(GrantStatus::at(later, Some(now), now), GrantStatus::Revoked);
        assert_eq!(reason("  ab "), Err(GrantError::Reason));
        assert_eq!(
            reason(" Fix the letterhead ").unwrap(),
            "Fix the letterhead"
        );
    }
}
