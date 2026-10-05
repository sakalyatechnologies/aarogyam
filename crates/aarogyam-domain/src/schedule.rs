//! Scheduling rules: appointment statuses and the moves between them, booking times, chairs
//! and doctors, weekly hours, the waiting-room queue, and what needs the front desk's attention.

use std::fmt;

use time::{Date, Duration, OffsetDateTime, Time, UtcOffset};

/// Why a scheduling value or change was refused. Messages never contain patient data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScheduleError {
    /// A status, kind or other listed value is not one of the allowed ones.
    UnknownValue,
    /// The end is not after the start.
    Times,
    /// Shorter than [`MIN_APPOINTMENT`].
    TooShort,
    /// Longer than [`MAX_APPOINTMENT`].
    TooLong,
    /// A date range runs backwards or spans more than [`MAX_RANGE_DAYS`] days.
    Range,
    /// The status can't change from the first to the second.
    Transition(AppointmentStatus, AppointmentStatus),
    /// The queue token's status can't change from the first to the second.
    QueueTransition(QueueStatus, QueueStatus),
    /// Cancelling needs a reason.
    ReasonRequired,
    /// A reason or note is empty or too long.
    Text,
    /// A name is empty or too long.
    Name,
    /// A calendar colour is not `#RRGGBB`.
    Color,
    /// A shift's weekday is not 1 (Monday) to 7 (Sunday), or it ends before it starts.
    Shift,
    /// Two shifts on the same day overlap.
    ShiftOverlap,
    /// More shifts than [`MAX_SHIFTS`].
    TooManyShifts,
    /// A completed, cancelled or no-show appointment can't be changed.
    Finished,
    /// A patient identifier is empty, too long or has control characters.
    Identifier,
}

impl fmt::Display for ScheduleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownValue => f.write_str("unknown value"),
            Self::Times => f.write_str("the end must be after the start"),
            Self::TooShort => f.write_str("an appointment lasts at least 5 minutes"),
            Self::TooLong => f.write_str("an appointment lasts at most 12 hours"),
            Self::Range => write!(
                f,
                "from must not be after to, and the range is at most {MAX_RANGE_DAYS} days"
            ),
            Self::Transition(from, to) => write!(
                f,
                "an appointment that is {} can't become {}",
                from.as_str(),
                to.as_str()
            ),
            Self::QueueTransition(from, to) => write!(
                f,
                "a token that is {} can't become {}",
                from.as_str(),
                to.as_str()
            ),
            Self::ReasonRequired => f.write_str("cancelling needs a reason"),
            Self::Text => f.write_str("must be 1 to 200 characters"),
            Self::Name => f.write_str("must be 1 to 120 characters"),
            Self::Color => f.write_str("must be a colour such as #136650"),
            Self::Shift => f.write_str(
                "weekday must be 1 (Monday) to 7 (Sunday) and a shift must end after it starts",
            ),
            Self::ShiftOverlap => f.write_str("two shifts on the same day overlap"),
            Self::TooManyShifts => write!(f, "at most {MAX_SHIFTS} shifts a week"),
            Self::Finished => {
                f.write_str("a completed, cancelled or no-show appointment can't be changed")
            }
            Self::Identifier => f.write_str("must be 1 to 64 characters"),
        }
    }
}

impl std::error::Error for ScheduleError {}

/// Shortest appointment.
pub const MIN_APPOINTMENT: Duration = Duration::minutes(5);
/// Longest appointment.
pub const MAX_APPOINTMENT: Duration = Duration::hours(12);
/// Most days a calendar read may span.
pub const MAX_RANGE_DAYS: i64 = 31;
/// Most shifts in a doctor's week.
pub const MAX_SHIFTS: usize = 28;
/// A booked patient not arrived this long after the start is late.
pub const LATE_AFTER: Duration = Duration::minutes(15);
/// A patient waiting longer than this needs attention.
pub const LONG_WAIT: Duration = Duration::minutes(30);

macro_rules! text_enum {
    ($(#[$doc:meta])* $name:ident { $($(#[$vdoc:meta])* $variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $name {
            $($(#[$vdoc])* $variant),+
        }

        impl $name {
            /// Every value, in order.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            /// The stored text.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }

            /// Parses the stored text.
            ///
            /// # Errors
            /// [`ScheduleError::UnknownValue`] for anything else.
            pub fn parse(text: &str) -> Result<Self, ScheduleError> {
                match text {
                    $($text => Ok(Self::$variant),)+
                    _ => Err(ScheduleError::UnknownValue),
                }
            }
        }
    };
}

text_enum!(
    /// Where an appointment stands.
    AppointmentStatus {
        /// Asked for by the patient online; the front desk has not confirmed or declined it.
        Requested => "requested",
        /// Booked, not yet confirmed.
        Booked => "booked",
        /// The patient confirmed they are coming.
        Confirmed => "confirmed",
        /// The patient is at the clinic, waiting.
        Arrived => "arrived",
        /// The patient is in the chair.
        InChair => "in_chair",
        /// Seen.
        Completed => "completed",
        /// Called off, with a reason.
        Cancelled => "cancelled",
        /// The patient didn't come.
        NoShow => "no_show",
    }
);

impl AppointmentStatus {
    /// Whether the appointment still holds its chair (not cancelled or a no-show).
    #[must_use]
    pub const fn is_active(self) -> bool {
        !matches!(self, Self::Cancelled | Self::NoShow)
    }

    /// Whether nothing more happens to it.
    #[must_use]
    pub const fn is_finished(self) -> bool {
        matches!(self, Self::Completed | Self::Cancelled | Self::NoShow)
    }

    /// Whether the patient has not come in yet.
    #[must_use]
    pub const fn is_upcoming(self) -> bool {
        matches!(self, Self::Booked | Self::Confirmed)
    }

    /// The transition table. Finished appointments stay finished: rebook instead.
    #[must_use]
    pub const fn can_become(self, to: Self) -> bool {
        matches!(
            (self, to),
            (Self::Requested, Self::Confirmed | Self::Cancelled)
                | (
                    Self::Booked,
                    Self::Confirmed | Self::Arrived | Self::Cancelled | Self::NoShow
                )
                | (
                    Self::Confirmed,
                    Self::Arrived | Self::Cancelled | Self::NoShow
                )
                | (
                    Self::Arrived,
                    Self::InChair | Self::Completed | Self::Cancelled
                )
                | (Self::InChair, Self::Completed)
        )
    }
}

/// A short free-text reason or note: trimmed, 1 to 200 characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reason(String);

impl Reason {
    /// Parses a reason.
    ///
    /// # Errors
    /// [`ScheduleError::Text`] when empty after trimming or longer than 200 characters.
    pub fn parse(text: &str) -> Result<Self, ScheduleError> {
        let text = text.trim();
        if text.is_empty() || text.chars().count() > 200 {
            return Err(ScheduleError::Text);
        }
        Ok(Self(text.to_owned()))
    }

    /// The text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Checks a status change and returns the cancel reason to store, if any.
///
/// # Errors
/// [`ScheduleError::Transition`] when the table doesn't allow it,
/// [`ScheduleError::ReasonRequired`] when cancelling without a reason, [`ScheduleError::Text`]
/// for a bad reason.
pub fn check_transition(
    from: AppointmentStatus,
    to: AppointmentStatus,
    reason: Option<&str>,
) -> Result<Option<Reason>, ScheduleError> {
    if !from.can_become(to) {
        return Err(ScheduleError::Transition(from, to));
    }
    let reason = reason
        .filter(|text| !text.trim().is_empty())
        .map(Reason::parse)
        .transpose()?;
    if to == AppointmentStatus::Cancelled && reason.is_none() {
        return Err(ScheduleError::ReasonRequired);
    }
    Ok(reason)
}

text_enum!(
    /// What an appointment is for.
    AppointmentKind {
        /// A first visit.
        New => "new",
        /// A follow-up visit.
        FollowUp => "follow_up",
        /// A planned procedure.
        Procedure => "procedure",
        /// Pain or an accident, fitted in.
        Emergency => "emergency",
    }
);

text_enum!(
    /// How an appointment was booked.
    BookingSource {
        /// At the front desk.
        FrontDesk => "front_desk",
        /// Over the phone.
        Phone => "phone",
        /// On the clinic's website.
        Website => "website",
        /// In the patient app.
        App => "app",
        /// Over `WhatsApp`.
        Whatsapp => "whatsapp",
    }
);

text_enum!(
    /// What kind of place a room is.
    RoomKind {
        /// A dental chair.
        Chair => "chair",
        /// A consulting or procedure room.
        Room => "room",
        /// A lab.
        Lab => "lab",
    }
);

text_enum!(
    /// A waiting-room token's place in the queue.
    QueueStatus {
        /// Waiting to be called.
        Waiting => "waiting",
        /// In the chair.
        InChair => "in_chair",
        /// Seen.
        Done => "done",
        /// Left without being seen.
        Left => "left",
    }
);

impl QueueStatus {
    /// The token status that follows an appointment status, for appointments with a token.
    #[must_use]
    pub const fn for_appointment(status: AppointmentStatus) -> Option<Self> {
        match status {
            AppointmentStatus::Arrived => Some(Self::Waiting),
            AppointmentStatus::InChair => Some(Self::InChair),
            AppointmentStatus::Completed => Some(Self::Done),
            AppointmentStatus::Cancelled | AppointmentStatus::NoShow => Some(Self::Left),
            AppointmentStatus::Requested
            | AppointmentStatus::Booked
            | AppointmentStatus::Confirmed => None,
        }
    }

    /// The appointment status a token change stands for, for tokens with an appointment.
    #[must_use]
    pub const fn appointment_status(self) -> Option<AppointmentStatus> {
        match self {
            Self::Waiting => None,
            Self::InChair => Some(AppointmentStatus::InChair),
            Self::Done => Some(AppointmentStatus::Completed),
            Self::Left => Some(AppointmentStatus::Cancelled),
        }
    }

    /// The token transition table.
    #[must_use]
    pub const fn can_become(self, to: Self) -> bool {
        matches!(
            (self, to),
            (Self::Waiting, Self::InChair | Self::Done | Self::Left) | (Self::InChair, Self::Done)
        )
    }

    /// Checks a token status change.
    ///
    /// # Errors
    /// [`ScheduleError::QueueTransition`] when the table doesn't allow it.
    pub const fn check(self, to: Self) -> Result<(), ScheduleError> {
        if self.can_become(to) {
            Ok(())
        } else {
            Err(ScheduleError::QueueTransition(self, to))
        }
    }
}

/// When an appointment starts and ends, checked: at least 5 minutes, at most 12 hours.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeSlot {
    starts_at: OffsetDateTime,
    ends_at: OffsetDateTime,
}

impl TimeSlot {
    /// Checks a slot. Times are kept in UTC.
    ///
    /// # Errors
    /// [`ScheduleError::Times`], [`ScheduleError::TooShort`] or [`ScheduleError::TooLong`].
    pub fn new(starts_at: OffsetDateTime, ends_at: OffsetDateTime) -> Result<Self, ScheduleError> {
        let length = ends_at - starts_at;
        if length <= Duration::ZERO {
            return Err(ScheduleError::Times);
        }
        if length < MIN_APPOINTMENT {
            return Err(ScheduleError::TooShort);
        }
        if length > MAX_APPOINTMENT {
            return Err(ScheduleError::TooLong);
        }
        Ok(Self {
            starts_at: starts_at.to_offset(UtcOffset::UTC),
            ends_at: ends_at.to_offset(UtcOffset::UTC),
        })
    }

    /// The start, in UTC.
    #[must_use]
    pub const fn starts_at(self) -> OffsetDateTime {
        self.starts_at
    }

    /// The end, in UTC.
    #[must_use]
    pub const fn ends_at(self) -> OffsetDateTime {
        self.ends_at
    }

    /// Whether two half-open slots share any time.
    #[must_use]
    pub fn overlaps(self, starts_at: OffsetDateTime, ends_at: OffsetDateTime) -> bool {
        self.starts_at < ends_at && starts_at < self.ends_at
    }
}

/// Local dates from `from` to `to`, both included, at most [`MAX_RANGE_DAYS`] days.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateSpan {
    from: Date,
    to: Date,
}

impl DateSpan {
    /// Checks a span.
    ///
    /// # Errors
    /// [`ScheduleError::Range`] when `from` is after `to` or the span is too long.
    pub fn new(from: Date, to: Date) -> Result<Self, ScheduleError> {
        let days = (to - from).whole_days();
        if !(0..MAX_RANGE_DAYS).contains(&days) {
            return Err(ScheduleError::Range);
        }
        Ok(Self { from, to })
    }

    /// The first day.
    #[must_use]
    pub const fn from(self) -> Date {
        self.from
    }

    /// The last day.
    #[must_use]
    pub const fn to(self) -> Date {
        self.to
    }
}

/// A name for a chair or a doctor: trimmed, inner spaces collapsed, 1 to `max` characters.
///
/// # Errors
/// [`ScheduleError::Name`].
pub fn parse_name(text: &str, max: usize) -> Result<String, ScheduleError> {
    let name = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > max {
        return Err(ScheduleError::Name);
    }
    Ok(name)
}

/// A calendar colour, `#RRGGBB`, stored upper-case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarColor(String);

impl CalendarColor {
    /// Parses `#rrggbb` in either case.
    ///
    /// # Errors
    /// [`ScheduleError::Color`].
    pub fn parse(text: &str) -> Result<Self, ScheduleError> {
        let text = text.trim();
        let hex = text.strip_prefix('#').ok_or(ScheduleError::Color)?;
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(ScheduleError::Color);
        }
        Ok(Self(format!("#{}", hex.to_ascii_uppercase())))
    }

    /// The colour.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// One stretch of a doctor's week.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shift {
    /// ISO weekday, 1 Monday to 7 Sunday.
    pub weekday: u8,
    /// Local start.
    pub starts: Time,
    /// Local end.
    pub ends: Time,
}

/// A doctor's checked week: valid shifts, none overlapping on the same day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeeklyHours(Vec<Shift>);

impl WeeklyHours {
    /// Checks and sorts a week of shifts.
    ///
    /// # Errors
    /// [`ScheduleError::Shift`], [`ScheduleError::ShiftOverlap`] or
    /// [`ScheduleError::TooManyShifts`].
    pub fn new(mut shifts: Vec<Shift>) -> Result<Self, ScheduleError> {
        if shifts.len() > MAX_SHIFTS {
            return Err(ScheduleError::TooManyShifts);
        }
        if shifts
            .iter()
            .any(|shift| !(1..=7).contains(&shift.weekday) || shift.starts >= shift.ends)
        {
            return Err(ScheduleError::Shift);
        }
        shifts.sort_by_key(|shift| (shift.weekday, shift.starts));
        if shifts
            .windows(2)
            .any(|pair| pair[0].weekday == pair[1].weekday && pair[1].starts < pair[0].ends)
        {
            return Err(ScheduleError::ShiftOverlap);
        }
        Ok(Self(shifts))
    }

    /// The shifts, by weekday and start.
    #[must_use]
    pub fn shifts(&self) -> &[Shift] {
        &self.0
    }
}

/// Whether a slot falls inside one of the shifts, read in the clinic's offset. A doctor with
/// no hours set is not checked. A slot crossing local midnight is never inside.
#[must_use]
pub fn within_hours(shifts: &[Shift], slot: TimeSlot, offset: UtcOffset) -> bool {
    if shifts.is_empty() {
        return true;
    }
    let start = slot.starts_at().to_offset(offset);
    let end = slot.ends_at().to_offset(offset);
    let same_day = start.date() == end.date() || end.time() == Time::MIDNIGHT;
    if !same_day {
        return false;
    }
    let weekday = start.weekday().number_from_monday();
    let end_time = if end.time() == Time::MIDNIGHT && end.date() != start.date() {
        Time::from_hms(23, 59, 59).unwrap_or(Time::MIDNIGHT)
    } else {
        end.time()
    };
    shifts.iter().any(|shift| {
        shift.weekday == weekday && shift.starts <= start.time() && end_time <= shift.ends
    })
}

/// Whether a booked patient is late: not arrived [`LATE_AFTER`] after the start.
#[must_use]
pub fn is_late(status: AppointmentStatus, starts_at: OffsetDateTime, now: OffsetDateTime) -> bool {
    status.is_upcoming() && now > starts_at + LATE_AFTER
}

/// Whether a waiting patient has waited longer than [`LONG_WAIT`].
#[must_use]
pub fn waits_too_long(status: QueueStatus, issued_at: OffsetDateTime, now: OffsetDateTime) -> bool {
    status == QueueStatus::Waiting && now - issued_at > LONG_WAIT
}

/// Whole minutes between two instants, never negative.
#[must_use]
pub fn minutes_between(from: OffsetDateTime, to: OffsetDateTime) -> i64 {
    (to - from).whole_minutes().max(0)
}

text_enum!(
    /// Another number a patient is known by.
    IdentifierKind {
        /// The clinic's own file or card number.
        FileNumber => "file_number",
        /// The ID in the software the clinic used before.
        Legacy => "legacy",
        /// A smart-card number.
        SmartCard => "smart_card",
        /// ABHA number.
        AbhaNumber => "abha_number",
        /// ABHA address.
        AbhaAddress => "abha_address",
    }
);

/// A patient identifier's value: trimmed, 1 to 64 characters, no control characters.
///
/// # Errors
/// [`ScheduleError::Identifier`].
pub fn parse_identifier(text: &str) -> Result<String, ScheduleError> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 64 || text.chars().any(char::is_control) {
        return Err(ScheduleError::Identifier);
    }
    Ok(text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime, offset, time};

    #[test]
    fn statuses_round_trip() {
        for status in AppointmentStatus::ALL {
            assert_eq!(AppointmentStatus::parse(status.as_str()), Ok(*status));
        }
        assert_eq!(
            AppointmentStatus::parse("scheduled"),
            Err(ScheduleError::UnknownValue)
        );
        for status in QueueStatus::ALL {
            assert_eq!(QueueStatus::parse(status.as_str()), Ok(*status));
        }
    }

    #[test]
    fn the_transition_table_moves_forward_only() {
        use AppointmentStatus::*;
        let allowed = [
            (Requested, Confirmed),
            (Requested, Cancelled),
            (Booked, Confirmed),
            (Booked, Arrived),
            (Booked, Cancelled),
            (Booked, NoShow),
            (Confirmed, Arrived),
            (Confirmed, Cancelled),
            (Confirmed, NoShow),
            (Arrived, InChair),
            (Arrived, Completed),
            (Arrived, Cancelled),
            (InChair, Completed),
        ];
        for from in AppointmentStatus::ALL {
            for to in AppointmentStatus::ALL {
                assert_eq!(
                    from.can_become(*to),
                    allowed.contains(&(*from, *to)),
                    "{from:?} -> {to:?}"
                );
            }
        }
        assert_eq!(
            check_transition(Completed, Booked, None),
            Err(ScheduleError::Transition(Completed, Booked))
        );
        assert_eq!(
            check_transition(Booked, Cancelled, Some("  ")),
            Err(ScheduleError::ReasonRequired)
        );
        assert_eq!(
            check_transition(Booked, Cancelled, Some(" Patient called ")),
            Ok(Some(Reason("Patient called".into())))
        );
        assert_eq!(check_transition(Booked, Arrived, None), Ok(None));
    }

    #[test]
    fn queue_follows_appointments() {
        assert_eq!(
            QueueStatus::for_appointment(AppointmentStatus::Arrived),
            Some(QueueStatus::Waiting)
        );
        assert_eq!(
            QueueStatus::for_appointment(AppointmentStatus::Confirmed),
            None
        );
        for token in QueueStatus::ALL {
            if let Some(status) = token.appointment_status() {
                assert_eq!(QueueStatus::for_appointment(status), Some(*token));
            }
        }
        assert!(QueueStatus::Waiting.check(QueueStatus::InChair).is_ok());
        assert_eq!(
            QueueStatus::Done.check(QueueStatus::Waiting),
            Err(ScheduleError::QueueTransition(
                QueueStatus::Done,
                QueueStatus::Waiting
            ))
        );
    }

    #[test]
    fn slots_are_bounded() {
        let start = datetime!(2026-10-05 04:30 UTC);
        assert_eq!(TimeSlot::new(start, start), Err(ScheduleError::Times));
        assert_eq!(
            TimeSlot::new(start, start + Duration::minutes(4)),
            Err(ScheduleError::TooShort)
        );
        assert_eq!(
            TimeSlot::new(start, start + Duration::hours(13)),
            Err(ScheduleError::TooLong)
        );
        let slot = TimeSlot::new(
            datetime!(2026-10-05 10:00 +05:30),
            datetime!(2026-10-05 10:30 +05:30),
        )
        .unwrap();
        assert_eq!(slot.starts_at(), start);
        assert!(slot.overlaps(start + Duration::minutes(29), start + Duration::hours(1)));
        assert!(!slot.overlaps(start + Duration::minutes(30), start + Duration::hours(1)));
    }

    #[test]
    fn spans_are_at_most_a_month() {
        assert!(DateSpan::new(date!(2026 - 10 - 01), date!(2026 - 10 - 31)).is_ok());
        assert_eq!(
            DateSpan::new(date!(2026 - 10 - 01), date!(2026 - 11 - 01)),
            Err(ScheduleError::Range)
        );
        assert_eq!(
            DateSpan::new(date!(2026 - 10 - 02), date!(2026 - 10 - 01)),
            Err(ScheduleError::Range)
        );
    }

    #[test]
    fn names_colours_and_identifiers() {
        assert_eq!(parse_name("  Chair   1 ", 60).unwrap(), "Chair 1");
        assert_eq!(parse_name(" ", 60), Err(ScheduleError::Name));
        assert_eq!(CalendarColor::parse("#0f766e").unwrap().as_str(), "#0F766E");
        assert_eq!(CalendarColor::parse("teal"), Err(ScheduleError::Color));
        assert_eq!(parse_identifier(" F-12 ").unwrap(), "F-12");
        assert_eq!(parse_identifier("a\nb"), Err(ScheduleError::Identifier));
    }

    #[test]
    fn hours_are_checked_and_cover_slots() {
        let morning = Shift {
            weekday: 1,
            starts: time!(09:00),
            ends: time!(13:00),
        };
        let evening = Shift {
            weekday: 1,
            starts: time!(17:00),
            ends: time!(20:00),
        };
        let week = WeeklyHours::new(vec![evening, morning]).unwrap();
        assert_eq!(week.shifts()[0], morning);
        assert_eq!(
            WeeklyHours::new(vec![
                morning,
                Shift {
                    starts: time!(12:00),
                    ..evening
                }
            ]),
            Err(ScheduleError::ShiftOverlap)
        );
        assert_eq!(
            WeeklyHours::new(vec![Shift {
                weekday: 8,
                ..morning
            }]),
            Err(ScheduleError::Shift)
        );
        // Monday 5 October 2026, 10:00 to 10:30 in India.
        let inside = TimeSlot::new(
            datetime!(2026-10-05 04:30 UTC),
            datetime!(2026-10-05 05:00 UTC),
        )
        .unwrap();
        let lunch = TimeSlot::new(
            datetime!(2026-10-05 08:00 UTC),
            datetime!(2026-10-05 08:30 UTC),
        )
        .unwrap();
        assert!(within_hours(week.shifts(), inside, offset!(+05:30)));
        assert!(!within_hours(week.shifts(), lunch, offset!(+05:30)));
        assert!(within_hours(&[], lunch, offset!(+05:30)));
    }

    #[test]
    fn attention_thresholds() {
        let start = datetime!(2026-10-05 04:30 UTC);
        assert!(!is_late(
            AppointmentStatus::Booked,
            start,
            start + Duration::minutes(15)
        ));
        assert!(is_late(
            AppointmentStatus::Confirmed,
            start,
            start + Duration::minutes(16)
        ));
        assert!(!is_late(
            AppointmentStatus::Arrived,
            start,
            start + Duration::hours(1)
        ));
        assert!(waits_too_long(
            QueueStatus::Waiting,
            start,
            start + Duration::minutes(31)
        ));
        assert!(!waits_too_long(
            QueueStatus::InChair,
            start,
            start + Duration::hours(1)
        ));
        assert_eq!(minutes_between(start + Duration::minutes(5), start), 0);
    }
}
