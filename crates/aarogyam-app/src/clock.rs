//! Dates as a clinic sees them. "Today", ages and financial years follow the clinic's time
//! zone: 00:30 in Mumbai on 1 April is still 31 March in UTC.

use time::{Date, Duration, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};

/// The UTC offset of a clinic's IANA time zone. Indian zones are fixed at +05:30 (no daylight
/// saving); other zones fall back to UTC until a time-zone database is added for clinics
/// outside India.
#[must_use]
pub fn clinic_offset(timezone: &str) -> UtcOffset {
    match timezone {
        "Asia/Kolkata" | "Asia/Calcutta" => UtcOffset::from_hms(5, 30, 0).unwrap_or(UtcOffset::UTC),
        _ => UtcOffset::UTC,
    }
}

/// Today's date in the clinic's time zone.
#[must_use]
pub fn clinic_today(timezone: &str, now: OffsetDateTime) -> Date {
    now.to_offset(clinic_offset(timezone)).date()
}

/// The instants covering clinic days `from` to `to`, both included (see [`days_bounds`]).
#[must_use]
pub fn day_range(timezone: &str, from: Date, to: Date) -> (OffsetDateTime, OffsetDateTime) {
    days_bounds(timezone, from, to)
}

/// The instants a clinic's local day starts and ends: `[start, end)` in UTC.
#[must_use]
pub fn day_bounds(timezone: &str, day: Date) -> (OffsetDateTime, OffsetDateTime) {
    let start = PrimitiveDateTime::new(day, Time::MIDNIGHT)
        .assume_offset(clinic_offset(timezone))
        .to_offset(UtcOffset::UTC);
    (start, start + Duration::DAY)
}

/// The first instant of `from` to the last instant of `to`, both local days: `[start, end)`.
#[must_use]
pub fn days_bounds(timezone: &str, from: Date, to: Date) -> (OffsetDateTime, OffsetDateTime) {
    let (start, _) = day_bounds(timezone, from);
    let (_, end) = day_bounds(timezone, to);
    (start, end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime};

    #[test]
    fn india_rolls_over_at_local_midnight() {
        let before = datetime!(2027-03-31 18:29 UTC);
        let after = datetime!(2027-03-31 18:31 UTC);
        assert_eq!(clinic_today("Asia/Kolkata", before), date!(2027 - 03 - 31));
        assert_eq!(clinic_today("Asia/Kolkata", after), date!(2027 - 04 - 01));
        assert_eq!(clinic_today("Europe/London", after), date!(2027 - 03 - 31));
        let (start, end) = day_range("Asia/Kolkata", date!(2027 - 03 - 31), date!(2027 - 03 - 31));
        assert_eq!(start, datetime!(2027-03-30 18:30 UTC));
        assert_eq!(end, datetime!(2027-03-31 18:30 UTC));
    }

    #[test]
    fn a_clinic_day_starts_at_local_midnight() {
        let (start, end) = day_bounds("Asia/Kolkata", date!(2026 - 10 - 04));
        assert_eq!(start, datetime!(2026-10-03 18:30 UTC));
        assert_eq!(end, datetime!(2026-10-04 18:30 UTC));
        let (start, end) =
            days_bounds("Asia/Kolkata", date!(2026 - 10 - 04), date!(2026 - 10 - 10));
        assert_eq!(end - start, Duration::days(7));
    }
}
