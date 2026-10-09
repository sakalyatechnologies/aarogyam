//! Patient self-booking: the clinic's online booking settings and the slot maths that turns
//! working hours, leave and existing appointments into the times a patient may take. Pure
//! rules; the same function answers "which slots are free" and "may this slot be booked".

use std::fmt;

use time::{Date, Duration, OffsetDateTime, PrimitiveDateTime, UtcOffset};

use crate::schedule::Shift;

/// Most open (requested, booked or confirmed, in the future) self-bookings one verified person
/// may hold in a clinic.
pub const MAX_OPEN_SELF_BOOKINGS: i64 = 2;

/// Why booking settings were refused. Messages never contain patient data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BookingError {
    /// Slot length is not 5 to 240 minutes in steps of 5.
    SlotMinutes,
    /// Buffer is not 0 to 120 minutes.
    BufferMinutes,
    /// Horizon is not 1 to 180 days.
    HorizonDays,
    /// Minimum notice is not 0 to 10 080 minutes (a week).
    MinNotice,
    /// The reminder wait is not 5 to 240 minutes.
    ReminderMinutes,
}

impl fmt::Display for BookingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::SlotMinutes => "must be 5 to 240 minutes, in steps of 5",
            Self::BufferMinutes => "must be 0 to 120 minutes",
            Self::HorizonDays => "must be 1 to 180 days",
            Self::MinNotice => "must be 0 to 10080 minutes",
            Self::ReminderMinutes => "must be 5 to 240 minutes",
        })
    }
}

impl std::error::Error for BookingError {}

/// A clinic's online booking settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BookingSettings {
    /// Whether the public booking page works.
    pub enabled: bool,
    /// Length of one slot in minutes.
    pub slot_minutes: u16,
    /// Gap kept free around other appointments, in minutes.
    pub buffer_minutes: u16,
    /// Whether a booking is confirmed at once (`true`) or waits for the front desk (`false`).
    pub auto_confirm: bool,
    /// How many days ahead patients may book, counting today.
    pub horizon_days: u16,
    /// How soon before a slot it stops being offered, in minutes.
    pub min_notice_minutes: u16,
    /// How long a booking request may wait, in opening hours, before staff are reminded; the
    /// owners are told after as long again.
    pub reminder_minutes: u16,
}

impl Default for BookingSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            slot_minutes: 15,
            buffer_minutes: 0,
            auto_confirm: false,
            horizon_days: 30,
            min_notice_minutes: 60,
            reminder_minutes: crate::notification::DEFAULT_REMINDER_MINUTES,
        }
    }
}

impl BookingSettings {
    /// Checks the numbers.
    ///
    /// # Errors
    /// The [`BookingError`] for the first value out of range.
    pub const fn validate(self) -> Result<Self, BookingError> {
        if self.slot_minutes < 5 || self.slot_minutes > 240 || !self.slot_minutes.is_multiple_of(5)
        {
            return Err(BookingError::SlotMinutes);
        }
        if self.buffer_minutes > 120 {
            return Err(BookingError::BufferMinutes);
        }
        if self.horizon_days < 1 || self.horizon_days > 180 {
            return Err(BookingError::HorizonDays);
        }
        if self.min_notice_minutes > 10_080 {
            return Err(BookingError::MinNotice);
        }
        if self.reminder_minutes < 5 || self.reminder_minutes > 240 {
            return Err(BookingError::ReminderMinutes);
        }
        Ok(self)
    }

    /// Reads the stored settings object, using the default for anything missing or invalid.
    #[must_use]
    pub fn from_stored(stored: &serde_json::Value) -> Self {
        let defaults = Self::default();
        let number = |key: &str, default: u16| {
            stored
                .get(key)
                .and_then(serde_json::Value::as_u64)
                .and_then(|n| u16::try_from(n).ok())
                .unwrap_or(default)
        };
        let flag = |key: &str, default: bool| {
            stored
                .get(key)
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(default)
        };
        Self {
            enabled: flag("enabled", defaults.enabled),
            slot_minutes: number("slot_minutes", defaults.slot_minutes),
            buffer_minutes: number("buffer_minutes", defaults.buffer_minutes),
            auto_confirm: flag("auto_confirm", defaults.auto_confirm),
            horizon_days: number("horizon_days", defaults.horizon_days),
            min_notice_minutes: number("min_notice_minutes", defaults.min_notice_minutes),
            reminder_minutes: number("reminder_minutes", defaults.reminder_minutes),
        }
        .validate()
        .unwrap_or(defaults)
    }

    /// The settings as the stored object.
    #[must_use]
    pub fn to_stored(&self) -> serde_json::Value {
        serde_json::json!({
            "enabled": self.enabled,
            "slot_minutes": self.slot_minutes,
            "buffer_minutes": self.buffer_minutes,
            "auto_confirm": self.auto_confirm,
            "horizon_days": self.horizon_days,
            "min_notice_minutes": self.min_notice_minutes,
            "reminder_minutes": self.reminder_minutes,
        })
    }

    /// Whether `day` may be booked on `today`: from today to `horizon_days` days.
    #[must_use]
    pub fn in_window(&self, day: Date, today: Date) -> bool {
        let ahead = (day - today).whole_days();
        (0..i64::from(self.horizon_days)).contains(&ahead)
    }
}

/// A stretch of time, half-open: `[starts_at, ends_at)`.
pub type Span = (OffsetDateTime, OffsetDateTime);

fn overlaps(span: Span, starts_at: OffsetDateTime, ends_at: OffsetDateTime) -> bool {
    span.0 < ends_at && starts_at < span.1
}

/// When the question is asked: which local day, what today is, the clinic's offset, and now.
#[derive(Debug, Clone, Copy)]
pub struct Asked {
    /// The local day wanted.
    pub day: Date,
    /// Today in the clinic.
    pub today: Date,
    /// The clinic's UTC offset.
    pub offset: UtcOffset,
    /// The current instant.
    pub now: OffsetDateTime,
}

/// One doctor's commitments.
#[derive(Debug, Clone, Copy)]
pub struct Commitments<'a> {
    /// Weekly hours.
    pub shifts: &'a [Shift],
    /// Active appointments.
    pub busy: &'a [Span],
    /// Leave blocks.
    pub leave: &'a [Span],
}

/// The start times a patient may book on a local day with one doctor, in the clinic's offset.
///
/// Slots run from each shift's start in steps of the slot length and must end inside the shift.
/// A slot is dropped when it overlaps leave, overlaps an active appointment widened by the
/// buffer on both sides, or starts sooner than the minimum notice from now. A doctor with no
/// shift that weekday offers nothing (unlike staff booking, which doesn't check hours for a
/// doctor with none). Days outside the booking window offer nothing.
#[must_use]
pub fn free_slots(
    asked: Asked,
    doctor: Commitments<'_>,
    settings: &BookingSettings,
) -> Vec<OffsetDateTime> {
    let Asked {
        day,
        today,
        offset,
        now,
    } = asked;
    if !settings.in_window(day, today) {
        return Vec::new();
    }
    let weekday = day.weekday().number_from_monday();
    let length = Duration::minutes(i64::from(settings.slot_minutes));
    let buffer = Duration::minutes(i64::from(settings.buffer_minutes));
    let earliest = now + Duration::minutes(i64::from(settings.min_notice_minutes));
    let mut shifts: Vec<&Shift> = doctor
        .shifts
        .iter()
        .filter(|s| s.weekday == weekday)
        .collect();
    shifts.sort_by_key(|shift| shift.starts);
    let mut slots = Vec::new();
    for shift in shifts {
        let end = PrimitiveDateTime::new(day, shift.ends).assume_offset(offset);
        let mut at = PrimitiveDateTime::new(day, shift.starts).assume_offset(offset);
        while at + length <= end {
            let to = at + length;
            let taken = doctor
                .busy
                .iter()
                .any(|b| overlaps(*b, at - buffer, to + buffer))
                || doctor.leave.iter().any(|l| overlaps(*l, at, to));
            if at >= earliest && !taken {
                slots.push(at);
            }
            at += length;
        }
    }
    slots
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime, offset, time};

    const IST: UtcOffset = offset!(+5:30);

    fn monday(starts: time::Time, ends: time::Time) -> Shift {
        Shift {
            weekday: 1,
            starts,
            ends,
        }
    }

    fn long_ago() -> OffsetDateTime {
        datetime!(2026-10-01 00:00 UTC)
    }

    fn ask(today: Date, now: OffsetDateTime) -> Asked {
        Asked {
            day: date!(2026 - 10 - 05),
            today,
            offset: IST,
            now,
        }
    }

    fn offered(
        shifts: &[Shift],
        busy: &[Span],
        leave: &[Span],
        settings: &BookingSettings,
    ) -> Vec<String> {
        let asked = ask(date!(2026 - 10 - 04), long_ago());
        free_slots(
            asked,
            Commitments {
                shifts,
                busy,
                leave,
            },
            settings,
        )
        .iter()
        .map(|at| format!("{:02}:{:02}", at.hour(), at.minute()))
        .collect()
    }

    #[test]
    fn slots_step_through_the_shift_and_end_inside_it() {
        let shift = [monday(time!(09:00), time!(10:00))];
        assert_eq!(
            offered(&shift, &[], &[], &BookingSettings::default()),
            ["09:00", "09:15", "09:30", "09:45"]
        );
        let odd = [monday(time!(09:00), time!(09:50))];
        assert_eq!(
            offered(&odd, &[], &[], &BookingSettings::default()).len(),
            3
        );
        let thirty = BookingSettings {
            slot_minutes: 30,
            ..BookingSettings::default()
        };
        assert_eq!(offered(&shift, &[], &[], &thirty), ["09:00", "09:30"]);
    }

    #[test]
    fn two_shifts_leave_the_break_empty() {
        let shifts = [
            monday(time!(14:00), time!(14:30)),
            monday(time!(09:00), time!(09:30)),
        ];
        assert_eq!(
            offered(&shifts, &[], &[], &BookingSettings::default()),
            ["09:00", "09:15", "14:00", "14:15"]
        );
    }

    #[test]
    fn a_day_without_a_shift_offers_nothing() {
        let tuesday = [Shift {
            weekday: 2,
            starts: time!(09:00),
            ends: time!(17:00),
        }];
        assert_eq!(
            offered(&tuesday, &[], &[], &BookingSettings::default()),
            Vec::<String>::new()
        );
        assert_eq!(
            offered(&[], &[], &[], &BookingSettings::default()),
            Vec::<String>::new()
        );
    }

    #[test]
    fn appointments_and_leave_remove_the_slots_they_touch() {
        let shift = [monday(time!(09:00), time!(10:00))];
        // 09:15 to 09:30 local is 03:45 to 04:00 UTC.
        let busy = [(
            datetime!(2026-10-05 03:45 UTC),
            datetime!(2026-10-05 04:00 UTC),
        )];
        assert_eq!(
            offered(&shift, &busy, &[], &BookingSettings::default()),
            ["09:00", "09:30", "09:45"]
        );
        let leave = [(
            datetime!(2026-10-05 04:00 UTC),
            datetime!(2026-10-05 05:00 UTC),
        )];
        assert_eq!(
            offered(&shift, &[], &leave, &BookingSettings::default()),
            ["09:00", "09:15"]
        );
    }

    #[test]
    fn the_buffer_widens_appointments_but_not_leave() {
        let shift = [monday(time!(09:00), time!(10:00))];
        let busy = [(
            datetime!(2026-10-05 03:45 UTC),
            datetime!(2026-10-05 04:00 UTC),
        )];
        let buffered = BookingSettings {
            buffer_minutes: 15,
            ..BookingSettings::default()
        };
        assert_eq!(offered(&shift, &busy, &[], &buffered), ["09:45"]);
        let leave = [(
            datetime!(2026-10-05 04:00 UTC),
            datetime!(2026-10-05 05:00 UTC),
        )];
        assert_eq!(offered(&shift, &[], &leave, &buffered), ["09:00", "09:15"]);
    }

    #[test]
    fn notice_and_the_window_limit_what_is_offered() {
        let shift = [monday(time!(09:00), time!(10:00))];
        let settings = BookingSettings::default();
        let doctor = Commitments {
            shifts: &shift,
            busy: &[],
            leave: &[],
        };
        let none = Vec::<OffsetDateTime>::new();
        // 09:10 local; an hour's notice leaves nothing that morning.
        let now = datetime!(2026-10-05 03:40 UTC);
        let asked = ask(date!(2026 - 10 - 05), now);
        assert_eq!(free_slots(asked, doctor, &settings), none);
        // A past day and a day beyond the horizon.
        for today in [date!(2026 - 10 - 06), date!(2026 - 09 - 05)] {
            let asked = ask(today, long_ago());
            assert_eq!(free_slots(asked, doctor, &settings), none);
        }
    }

    #[test]
    fn settings_are_checked() {
        assert!(BookingSettings::default().validate().is_ok());
        let bad = |change: fn(&mut BookingSettings)| {
            let mut s = BookingSettings::default();
            change(&mut s);
            s.validate()
        };
        assert_eq!(bad(|s| s.slot_minutes = 7), Err(BookingError::SlotMinutes));
        assert_eq!(bad(|s| s.slot_minutes = 0), Err(BookingError::SlotMinutes));
        assert_eq!(
            bad(|s| s.buffer_minutes = 121),
            Err(BookingError::BufferMinutes)
        );
        assert_eq!(bad(|s| s.horizon_days = 0), Err(BookingError::HorizonDays));
        assert_eq!(
            bad(|s| s.min_notice_minutes = 20_000),
            Err(BookingError::MinNotice)
        );
    }
}
