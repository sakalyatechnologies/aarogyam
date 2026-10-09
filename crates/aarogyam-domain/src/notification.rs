//! Notifications for clinic staff: what happened (an online booking waiting for an answer, one
//! confirmed automatically, one cancelled by the patient), the inbox messages a reminder or an
//! escalation leaves, and when the reminder job acts. Pure rules; IDs only, never patient data.

use std::fmt;

use time::{Duration, OffsetDateTime, Time};

/// A stored value that isn't one of the known ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("unknown value")]
pub struct UnknownValue;

macro_rules! stored_enum {
    ($(#[$doc:meta])* $name:ident { $($(#[$vdoc:meta])* $variant:ident => $text:literal),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $name {
            $($(#[$vdoc])* $variant,)*
        }

        impl $name {
            /// Every value, in declaration order.
            pub const ALL: &'static [Self] = &[$(Self::$variant,)*];

            /// The value stored in the database and sent over the API.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text,)* }
            }

            /// Parses the stored value.
            ///
            /// # Errors
            /// [`UnknownValue`] for anything else.
            pub fn parse(text: &str) -> Result<Self, UnknownValue> {
                match text { $($text => Ok(Self::$variant),)* _ => Err(UnknownValue) }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

stored_enum!(
    /// What a staff notification is about.
    NotificationKind {
        /// A patient asked for an appointment online; it waits for Confirm or Decline.
        BookingRequested => "booking_requested",
        /// A patient booked online and the clinic confirms such bookings automatically.
        BookingConfirmedAuto => "booking_confirmed_auto",
        /// A patient cancelled an appointment themselves.
        BookingCancelledByPatient => "booking_cancelled_by_patient",
        /// Lab work is past its due date and still at the lab.
        LabOverdue => "lab_overdue",
    }
);

stored_enum!(
    /// What an inbox message is.
    InboxKind {
        /// A booking request is still waiting: everyone who handles appointments is reminded.
        BookingReminder => "booking_reminder",
        /// A booking request is still waiting after the reminder: the owners are told.
        BookingEscalation => "booking_escalation",
    }
);

stored_enum!(
    /// Who an inbox message is for.
    Audience {
        /// Every member who sees the appointment's notifications.
        Clinic => "clinic",
        /// Members with the owner role.
        Owners => "owners",
    }
);

impl InboxKind {
    /// Who this kind of message is addressed to.
    #[must_use]
    pub const fn audience(self) -> Audience {
        match self {
            Self::BookingReminder => Audience::Clinic,
            Self::BookingEscalation => Audience::Owners,
        }
    }
}

/// The role key whose members get escalations.
pub const OWNER_ROLE: &str = "owner";

/// Whether a member with `role_key` receives messages for `audience` (a clinic message also
/// needs the appointment to be within the member's reach).
#[must_use]
pub fn addressed_to(audience: Audience, role_key: &str) -> bool {
    match audience {
        Audience::Clinic => true,
        Audience::Owners => role_key == OWNER_ROLE,
    }
}

/// Most unread notifications the bell counts; the portal shows more as "99+".
pub const UNREAD_CAP: i64 = 100;
/// How far back the bell counts unread notifications, in days.
pub const UNREAD_WINDOW_DAYS: i32 = 30;
/// Default page size of the feed.
pub const DEFAULT_PAGE: i64 = 30;
/// Largest page size of the feed.
pub const MAX_PAGE: i64 = 100;

/// The page size asked for, within 1 to [`MAX_PAGE`]; [`DEFAULT_PAGE`] when absent.
#[must_use]
pub fn page_size(asked: Option<u32>) -> i64 {
    asked.map_or(DEFAULT_PAGE, |n| i64::from(n).clamp(1, MAX_PAGE))
}

/// Default minutes a booking request may wait before everyone is reminded.
pub const DEFAULT_REMINDER_MINUTES: u16 = 15;

/// When the clinic is open, in its local time. Clinics can't set opening hours yet, so the job
/// uses [`OpenHours::DEFAULT`] (09:00 to 21:00) for every clinic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenHours {
    /// Opening time, inclusive.
    pub opens: Time,
    /// Closing time, exclusive.
    pub closes: Time,
}

// Whole hours from literals below 24, so the fallback is never taken.
const fn hour(h: u8) -> Time {
    match Time::from_hms(h, 0, 0) {
        Ok(time) => time,
        Err(_) => Time::MIDNIGHT,
    }
}

impl OpenHours {
    /// 09:00 to 21:00.
    pub const DEFAULT: Self = Self {
        opens: hour(9),
        closes: hour(21),
    };

    /// Whether `local` (the clinic's wall-clock time) is within opening hours.
    #[must_use]
    pub fn contains(self, local: Time) -> bool {
        self.opens <= local && local < self.closes
    }
}

/// What the reminder job does next for one open booking request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReminderStep {
    /// Remind everyone who handles appointments (an inbox message for the clinic).
    Remind,
    /// Tell the owners (an inbox message for them).
    Escalate,
}

impl ReminderStep {
    /// The inbox message this step leaves.
    #[must_use]
    pub const fn inbox_kind(self) -> InboxKind {
        match self {
            Self::Remind => InboxKind::BookingReminder,
            Self::Escalate => InboxKind::BookingEscalation,
        }
    }

    /// The stored value the database function takes.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Remind => "remind",
            Self::Escalate => "escalate",
        }
    }
}

/// An open (unhandled, not yet escalated) booking request as the job sees it.
#[derive(Debug, Clone, Copy)]
pub struct OpenRequest {
    /// When the notification was written.
    pub created_at: OffsetDateTime,
    /// When everyone was reminded, if they were.
    pub reminded_at: Option<OffsetDateTime>,
    /// The clinic's wall-clock time now.
    pub local_now: Time,
}

/// The step due now, if any. Nothing happens outside opening hours. A request is reminded once
/// it has waited `minutes`; it is escalated once `minutes` more have passed since the reminder
/// (so `2 × minutes` after the booking when the clinic was open throughout; a request made at
/// night is reminded at opening and escalated `minutes` later, never both at once).
#[must_use]
pub fn due_step(
    request: OpenRequest,
    now: OffsetDateTime,
    minutes: u16,
    hours: OpenHours,
) -> Option<ReminderStep> {
    if !hours.contains(request.local_now) {
        return None;
    }
    let wait = Duration::minutes(i64::from(minutes));
    match request.reminded_at {
        None if now - request.created_at >= wait => Some(ReminderStep::Remind),
        Some(reminded) if now - reminded >= wait => Some(ReminderStep::Escalate),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{datetime, time};

    fn open(created: OffsetDateTime, reminded: Option<OffsetDateTime>, local: Time) -> OpenRequest {
        OpenRequest {
            created_at: created,
            reminded_at: reminded,
            local_now: local,
        }
    }

    #[test]
    fn reminds_after_the_wait_then_escalates_after_as_long_again() {
        let booked = datetime!(2026-10-08 05:00 UTC);
        let hours = OpenHours::DEFAULT;
        let at = |minutes| booked + Duration::minutes(minutes);
        let noon = time!(12:00);
        assert_eq!(due_step(open(booked, None, noon), at(14), 15, hours), None);
        assert_eq!(
            due_step(open(booked, None, noon), at(15), 15, hours),
            Some(ReminderStep::Remind)
        );
        let reminded = Some(at(16));
        assert_eq!(
            due_step(open(booked, reminded, noon), at(30), 15, hours),
            None
        );
        assert_eq!(
            due_step(open(booked, reminded, noon), at(31), 15, hours),
            Some(ReminderStep::Escalate)
        );
    }

    #[test]
    fn nothing_happens_outside_opening_hours() {
        let booked = datetime!(2026-10-08 17:00 UTC);
        let late = booked + Duration::hours(3);
        let hours = OpenHours::DEFAULT;
        assert_eq!(
            due_step(open(booked, None, time!(22:30)), late, 15, hours),
            None
        );
        assert_eq!(
            due_step(open(booked, None, time!(08:59)), late, 15, hours),
            None
        );
        assert_eq!(
            due_step(open(booked, None, time!(09:00)), late, 15, hours),
            Some(ReminderStep::Remind)
        );
        // Reminded at opening: the escalation waits its own interval.
        let reminded = Some(late);
        assert_eq!(
            due_step(
                open(booked, reminded, time!(09:02)),
                late + Duration::minutes(2),
                15,
                hours
            ),
            None
        );
        assert!(!hours.contains(time!(21:00)));
    }

    #[test]
    fn values_round_trip_and_escalations_go_to_owners() {
        for kind in NotificationKind::ALL {
            assert_eq!(NotificationKind::parse(kind.as_str()), Ok(*kind));
        }
        for kind in InboxKind::ALL {
            assert_eq!(InboxKind::parse(kind.as_str()), Ok(*kind));
        }
        assert_eq!(NotificationKind::parse("booking"), Err(UnknownValue));
        assert_eq!(
            ReminderStep::Escalate.inbox_kind().audience(),
            Audience::Owners
        );
        assert!(addressed_to(Audience::Owners, OWNER_ROLE));
        assert!(!addressed_to(Audience::Owners, "front_desk"));
        assert!(addressed_to(Audience::Clinic, "front_desk"));
        assert_eq!(page_size(None), DEFAULT_PAGE);
        assert_eq!(page_size(Some(0)), 1);
        assert_eq!(page_size(Some(10_000)), MAX_PAGE);
    }
}
