//! Dates as a clinic sees them. "Today", ages and financial years follow the clinic's time
//! zone: 00:30 in Mumbai on 1 April is still 31 March in UTC.

use time::{OffsetDateTime, UtcOffset};

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
pub fn clinic_today(timezone: &str, now: OffsetDateTime) -> time::Date {
    now.to_offset(clinic_offset(timezone)).date()
}

/// The instant a clinic's day begins (local midnight).
#[must_use]
pub fn day_start(timezone: &str, date: time::Date) -> OffsetDateTime {
    time::PrimitiveDateTime::new(date, time::Time::MIDNIGHT).assume_offset(clinic_offset(timezone))
}

/// The instants covering clinic days `from` to `to`, both included: `[start of from, start of
/// the day after to)`.
#[must_use]
pub fn day_range(
    timezone: &str,
    from: time::Date,
    to: time::Date,
) -> (OffsetDateTime, OffsetDateTime) {
    let end = to.next_day().unwrap_or(to);
    (day_start(timezone, from), day_start(timezone, end))
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
}
