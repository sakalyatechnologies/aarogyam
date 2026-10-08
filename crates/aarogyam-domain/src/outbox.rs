//! Messages sent because of a change: channels, what each message is, and when a failed
//! delivery is tried again.

use time::{Duration, OffsetDateTime};

/// How a message travels. More channels (text messages, push) come with the notification
/// service; each needs consent and quiet-hour rules first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// Email.
    Email,
}

impl Channel {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Email => "email",
        }
    }

    /// Parses the stored value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "email" => Some(Self::Email),
            _ => None,
        }
    }
}

/// What a queued message is about; picks its template.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageKind {
    /// Someone was invited to join a clinic's staff.
    StaffInvited,
    /// A prescription link was sent to its patient.
    PrescriptionShared,
    /// A patient asked for an appointment online and waits for the front desk.
    BookingRequested,
    /// An appointment booked online is confirmed.
    BookingConfirmed,
    /// An appointment requested online was declined.
    BookingDeclined,
    /// A clinic invited a patient to the patient app with a link code.
    PatientAppInvited,
}

impl MessageKind {
    /// The stored event key.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StaffInvited => "staff.invited",
            Self::PrescriptionShared => "prescription.shared",
            Self::BookingRequested => "booking.requested",
            Self::BookingConfirmed => "booking.confirmed",
            Self::BookingDeclined => "booking.declined",
            Self::PatientAppInvited => "patient_app.invited",
        }
    }

    /// Parses the stored event key.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "staff.invited" => Some(Self::StaffInvited),
            "prescription.shared" => Some(Self::PrescriptionShared),
            "booking.requested" => Some(Self::BookingRequested),
            "booking.confirmed" => Some(Self::BookingConfirmed),
            "booking.declined" => Some(Self::BookingDeclined),
            "patient_app.invited" => Some(Self::PatientAppInvited),
            _ => None,
        }
    }
}

/// Attempts before a message is abandoned.
pub const MAX_ATTEMPTS: u32 = 5;

/// When to try a message again after `attempts` failed attempts: 30 seconds, then four times
/// longer each time (2, 8 and 32 minutes); `None` once [`MAX_ATTEMPTS`] have failed.
#[must_use]
pub fn retry_at(attempts: u32, now: OffsetDateTime) -> Option<OffsetDateTime> {
    if attempts == 0 || attempts >= MAX_ATTEMPTS {
        return None;
    }
    let factor = 4_i64.checked_pow(attempts - 1)?;
    Some(now + Duration::seconds(30 * factor))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_back_off_then_give_up() {
        let now = OffsetDateTime::UNIX_EPOCH;
        let waits: Vec<i64> = (1..MAX_ATTEMPTS)
            .map(|attempt| (retry_at(attempt, now).unwrap() - now).whole_seconds())
            .collect();
        assert_eq!(waits, [30, 120, 480, 1920]);
        assert_eq!(retry_at(MAX_ATTEMPTS, now), None);
        assert_eq!(retry_at(0, now), None);
    }

    #[test]
    fn stored_values_round_trip() {
        assert_eq!(
            Channel::parse(Channel::Email.as_str()),
            Some(Channel::Email)
        );
        assert_eq!(Channel::parse("pigeon"), None);
        assert_eq!(
            MessageKind::parse(MessageKind::StaffInvited.as_str()),
            Some(MessageKind::StaffInvited)
        );
    }
}
