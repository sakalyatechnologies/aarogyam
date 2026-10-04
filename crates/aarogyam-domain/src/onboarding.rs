//! Clinics joining Aarogyam: applications from the public landing page.

/// Where a clinic's application stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplicationStatus {
    /// Waiting for Sakalya staff.
    Pending,
    /// The clinic was created and its owner invited.
    Approved,
    /// Turned down.
    Rejected,
}

impl ApplicationStatus {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }

    /// Parses a stored value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "pending" => Some(Self::Pending),
            "approved" => Some(Self::Approved),
            "rejected" => Some(Self::Rejected),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_round_trip() {
        for status in [
            ApplicationStatus::Pending,
            ApplicationStatus::Approved,
            ApplicationStatus::Rejected,
        ] {
            assert_eq!(ApplicationStatus::parse(status.as_str()), Some(status));
        }
        assert_eq!(ApplicationStatus::parse("open"), None);
    }
}
