//! Rules behind the owner's Analytics page: periods (months or weeks), chair utilization, age
//! bands and referral kinds. See `docs/decisions.md`, "Analytics: chair utilization".

use time::{Date, Duration, Month};

/// Minutes a chair counts as open on each calendar day. Clinic opening hours are not stored
/// yet, so every day counts as nine hours open (for example 10:00 to 19:00).
pub const OPEN_MINUTES_PER_DAY: i64 = 9 * 60;

/// The longest range the report covers, in days (about 24 months).
pub const MAX_DAYS: i64 = 731;

text_value!(
    /// How the report groups days.
    Bucket("bucket") {
        /// Calendar months.
        Month => "month",
        /// Weeks starting on Monday.
        Week => "week",
    }
);

impl Bucket {
    /// The first day of the period holding `day`.
    #[must_use]
    pub fn start_of(self, day: Date) -> Date {
        match self {
            Self::Month => day.replace_day(1).unwrap_or(day),
            Self::Week => day - Duration::days(i64::from(day.weekday().number_days_from_monday())),
        }
    }

    /// The first day of the period after the one starting `start`.
    #[must_use]
    pub fn next(self, start: Date) -> Date {
        match self {
            Self::Week => start + Duration::days(7),
            Self::Month => {
                let (year, month) = match start.month() {
                    Month::December => (start.year() + 1, Month::January),
                    month => (start.year(), month.next()),
                };
                Date::from_calendar_date(year, month, 1).unwrap_or(start + Duration::days(31))
            }
        }
    }

    /// Every period touching `from` to `to`, as `(start, first day counted, last day counted)`:
    /// the first and last periods are cut to the range.
    #[must_use]
    pub fn periods(self, from: Date, to: Date) -> Vec<(Date, Date, Date)> {
        let mut periods = Vec::new();
        let mut start = self.start_of(from);
        while start <= to {
            let next = self.next(start);
            let first = start.max(from);
            let last = (next - Duration::DAY).min(to);
            periods.push((start, first, last));
            if next <= start {
                break;
            }
            start = next;
        }
        periods
    }
}

/// The default first day for a report ending `to`: the first of the month eleven months
/// earlier, so the report covers twelve calendar months.
#[must_use]
pub fn default_from(to: Date) -> Date {
    let mut year = to.year();
    let mut month = u8::from(to.month());
    for _ in 0..11 {
        if month == 1 {
            month = 12;
            year -= 1;
        } else {
            month -= 1;
        }
    }
    Month::try_from(month)
        .ok()
        .and_then(|month| Date::from_calendar_date(year, month, 1).ok())
        .unwrap_or(to)
}

/// Minutes a chair is open from `first` to `last`, both included.
#[must_use]
pub fn open_minutes(first: Date, last: Date) -> i64 {
    ((last - first).whole_days() + 1).max(0) * OPEN_MINUTES_PER_DAY
}

/// Booked minutes as a share of open minutes, in basis points (10,000 is fully booked). Can
/// pass 10,000 when a chair is booked for longer than the assumed nine hours.
#[must_use]
pub fn utilization_bps(booked_minutes: i64, open_minutes: i64) -> i64 {
    if open_minutes <= 0 {
        0
    } else {
        i64::try_from(i128::from(booked_minutes.max(0)) * 10_000 / i128::from(open_minutes))
            .unwrap_or(i64::MAX)
    }
}

text_value!(
    /// A patient's age group on the last day of the report.
    AgeBand("age_band") {
        /// 0 to 12.
        Child => "0_12",
        /// 13 to 17.
        Teen => "13_17",
        /// 18 to 34.
        YoungAdult => "18_34",
        /// 35 to 49.
        Adult => "35_49",
        /// 50 to 64.
        MiddleAged => "50_64",
        /// 65 and over.
        Senior => "65_plus",
        /// No date of birth.
        Unknown => "unknown",
    }
);

impl AgeBand {
    /// The band for an age in whole years; [`AgeBand::Unknown`] without one.
    #[must_use]
    pub const fn of(years: Option<i64>) -> Self {
        match years {
            None => Self::Unknown,
            Some(..=12) => Self::Child,
            Some(13..=17) => Self::Teen,
            Some(18..=34) => Self::YoungAdult,
            Some(35..=49) => Self::Adult,
            Some(50..=64) => Self::MiddleAged,
            Some(_) => Self::Senior,
        }
    }
}

text_value!(
    /// How a patient found the clinic: the kind of their referral source, or none recorded.
    ReferralKind("referral") {
        /// Another patient.
        Patient => "patient",
        /// A doctor.
        Doctor => "doctor",
        /// Online: search, maps, social media.
        Online => "online",
        /// Walked in.
        WalkIn => "walk_in",
        /// A health camp.
        Camp => "camp",
        /// An insurer.
        Insurance => "insurance",
        /// Something else.
        Other => "other",
        /// Not recorded.
        Unknown => "unknown",
    }
);

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn months_are_cut_to_the_range() {
        let periods = Bucket::Month.periods(date!(2026 - 01 - 15), date!(2026 - 03 - 10));
        assert_eq!(
            periods,
            [
                (
                    date!(2026 - 01 - 01),
                    date!(2026 - 01 - 15),
                    date!(2026 - 01 - 31)
                ),
                (
                    date!(2026 - 02 - 01),
                    date!(2026 - 02 - 01),
                    date!(2026 - 02 - 28)
                ),
                (
                    date!(2026 - 03 - 01),
                    date!(2026 - 03 - 01),
                    date!(2026 - 03 - 10)
                ),
            ]
        );
        let across_years = Bucket::Month.periods(date!(2025 - 12 - 01), date!(2026 - 01 - 01));
        assert_eq!(across_years.len(), 2);
        assert_eq!(across_years[1].0, date!(2026 - 01 - 01));
    }

    #[test]
    fn weeks_start_on_monday() {
        // Wednesday 7 October 2026 to Monday 12 October.
        let periods = Bucket::Week.periods(date!(2026 - 10 - 07), date!(2026 - 10 - 12));
        assert_eq!(periods.len(), 2);
        assert_eq!(periods[0].0, date!(2026 - 10 - 05));
        assert_eq!(periods[0].1, date!(2026 - 10 - 07));
        assert_eq!(periods[0].2, date!(2026 - 10 - 11));
        assert_eq!(
            periods[1],
            (
                date!(2026 - 10 - 12),
                date!(2026 - 10 - 12),
                date!(2026 - 10 - 12)
            )
        );
    }

    #[test]
    fn the_default_range_is_twelve_months() {
        assert_eq!(default_from(date!(2026 - 10 - 07)), date!(2025 - 11 - 01));
        assert_eq!(default_from(date!(2026 - 12 - 31)), date!(2026 - 01 - 01));
        assert_eq!(
            Bucket::Month
                .periods(default_from(date!(2026 - 10 - 07)), date!(2026 - 10 - 07))
                .len(),
            12
        );
    }

    #[test]
    fn utilization_is_booked_over_open() {
        assert_eq!(
            open_minutes(date!(2026 - 10 - 01), date!(2026 - 10 - 01)),
            540
        );
        assert_eq!(
            open_minutes(date!(2026 - 10 - 01), date!(2026 - 10 - 10)),
            5_400
        );
        assert_eq!(utilization_bps(270, 540), 5_000);
        assert_eq!(utilization_bps(0, 540), 0);
        assert_eq!(utilization_bps(100, 0), 0);
        assert_eq!(utilization_bps(1_080, 540), 20_000);
    }

    #[test]
    fn age_bands() {
        assert_eq!(AgeBand::of(None), AgeBand::Unknown);
        assert_eq!(AgeBand::of(Some(0)), AgeBand::Child);
        assert_eq!(AgeBand::of(Some(12)), AgeBand::Child);
        assert_eq!(AgeBand::of(Some(13)), AgeBand::Teen);
        assert_eq!(AgeBand::of(Some(34)), AgeBand::YoungAdult);
        assert_eq!(AgeBand::of(Some(35)), AgeBand::Adult);
        assert_eq!(AgeBand::of(Some(64)), AgeBand::MiddleAged);
        assert_eq!(AgeBand::of(Some(65)), AgeBand::Senior);
        assert_eq!(AgeBand::of(Some(101)), AgeBand::Senior);
    }
}
