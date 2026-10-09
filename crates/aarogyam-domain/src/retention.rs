//! The retention schedule: how long each class of record is kept before it is reported as
//! past retention. The schedule is documented in `docs/decisions.md`; this is the same table in
//! code, so the report and the document cannot drift apart without a test noticing.
//!
//! Nothing here deletes. A class past retention is only listed; erasure and anonymisation are
//! designed in `docs/decisions.md` and not built.

use time::{Date, Duration, Month, OffsetDateTime};

text_value! {
    /// A kind of record with its own retention period.
    Class ("class") {
        /// A patient and everything recorded under them, counted from their last activity
        /// (a visit, appointment or bill). Children are kept until they are 21.
        PatientRecord => "patient_record",
        /// Bills and payments, kept for tax and company law.
        Invoices => "invoices",
        /// Queued and sent messages, which name recipients.
        Outbox => "outbox",
        /// Links given to patients to open a document, after they expire.
        ShareLinks => "share_links",
        /// Spreadsheets uploaded to import patients, kept as cell contents.
        ImportSessions => "import_sessions",
        /// Who viewed a patient's record.
        AccessLog => "access_log",
        /// Who changed a record.
        AuditEvents => "audit_events",
        /// Requests for access from clinics that were never approved.
        ClinicApplications => "clinic_applications",
        /// Lab orders with their items, history and payments: work on a patient and money
        /// paid, kept like bills.
        LabWork => "lab_work",
        /// People at labs the clinic removed, who are named with their phone and email.
        LabContacts => "lab_contacts",
    }
}

/// How long a class is kept, counted from its anchor date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    /// A number of days.
    Days(u16),
    /// A number of calendar years.
    Years(u8),
}

impl Period {
    /// The period as the schedule's table words it: `7 years`, `90 days`.
    #[must_use]
    pub fn describe(self) -> String {
        match self {
            Self::Days(days) => format!("{days} days"),
            Self::Years(years) => format!("{years} years"),
        }
    }
}

/// Age at which a patient who was a child is no longer protected by the minor rule: 18, plus
/// three years for limitation (the Limitation Act, 1963, runs from majority).
pub const MINOR_RULE_AGE_YEARS: u8 = 21;

impl Class {
    /// The period after the class's anchor date at which a record is reported.
    #[must_use]
    pub const fn period(self) -> Period {
        match self {
            Self::PatientRecord | Self::AuditEvents => Period::Years(7),
            Self::Invoices | Self::LabWork => Period::Years(8),
            Self::Outbox => Period::Days(90),
            Self::ShareLinks | Self::ImportSessions => Period::Days(30),
            Self::AccessLog => Period::Years(3),
            Self::ClinicApplications | Self::LabContacts => Period::Days(365),
        }
    }

    /// What the period is counted from, in plain words.
    #[must_use]
    pub const fn anchor(self) -> &'static str {
        match self {
            Self::PatientRecord => {
                "the patient's last visit, appointment or bill (or registration, if none)"
            }
            Self::Invoices => "the date the bill was issued",
            Self::Outbox => "when the message was sent or abandoned",
            Self::ShareLinks => "when the link expired",
            Self::ImportSessions => "when the upload was made",
            Self::AccessLog | Self::AuditEvents => "when the entry was written",
            Self::ClinicApplications => "when the request was decided (or made, if undecided)",
            Self::LabWork => "when the order was recorded",
            Self::LabContacts => "when the contact was removed",
        }
    }

    /// The instant before which an anchor date is past retention at `now`.
    #[must_use]
    pub fn cutoff(self, now: OffsetDateTime) -> OffsetDateTime {
        match self.period() {
            Period::Days(days) => now - Duration::days(i64::from(days)),
            Period::Years(years) => years_before(now, i32::from(years)),
        }
    }
}

/// `at`, some whole calendar years earlier. 29 February moves to 28 February.
#[must_use]
pub fn years_before(at: OffsetDateTime, years: i32) -> OffsetDateTime {
    let date = at.date();
    let year = date.year() - years;
    let day =
        if date.month() == Month::February && date.day() == 29 && !time::util::is_leap_year(year) {
            28
        } else {
            date.day()
        };
    // The month and a day no later than the source's are valid in any year.
    let moved = Date::from_calendar_date(year, date.month(), day).unwrap_or(date);
    at.replace_date(moved)
}

/// Patients born on or before this date are adults for the minor rule: they were 21 or older
/// at `now`. A patient with no birth date is treated as an adult.
#[must_use]
pub fn adult_born_on_or_before(now: OffsetDateTime) -> Date {
    years_before(now, i32::from(MINOR_RULE_AGE_YEARS)).date()
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    #[test]
    fn every_class_has_a_period_and_anchor() {
        for class in Class::ALL {
            assert!(class.period() != Period::Days(0) && class.period() != Period::Years(0));
            assert_ne!(class.anchor(), "");
            assert_eq!(Class::parse(class.as_str()), Ok(*class));
        }
    }

    #[test]
    fn cutoffs_count_back_from_now() {
        let now = datetime!(2026-10-07 12:00 UTC);
        assert_eq!(Class::Outbox.cutoff(now), datetime!(2026-07-09 12:00 UTC));
        assert_eq!(
            Class::PatientRecord.cutoff(now),
            datetime!(2019-10-07 12:00 UTC)
        );
        assert_eq!(Class::Invoices.cutoff(now), datetime!(2018-10-07 12:00 UTC));
    }

    /// The schedule in `docs/decisions.md` and the one in code agree: a row for every class, with
    /// its period, so changing one without the other fails here.
    #[test]
    fn the_documented_schedule_matches_the_code() {
        let decisions = include_str!("../../../docs/decisions.md");
        for class in Class::ALL {
            let key = format!("| `{}` |", class.as_str());
            let row = decisions
                .lines()
                .find(|line| line.starts_with(&key))
                .unwrap_or_else(|| panic!("no row for {class} in docs/decisions.md"));
            assert!(
                row.contains(&format!("| {}", class.period().describe())),
                "the row for {class} does not say {}: {row}",
                class.period().describe()
            );
        }
    }

    #[test]
    fn leap_day_moves_to_the_28th() {
        let leap = datetime!(2028-02-29 00:00 UTC);
        assert_eq!(years_before(leap, 7), datetime!(2021-02-28 00:00 UTC));
        assert_eq!(years_before(leap, 4), datetime!(2024-02-29 00:00 UTC));
    }

    #[test]
    fn adults_for_the_minor_rule_were_born_21_years_ago() {
        let now = datetime!(2026-10-07 12:00 UTC);
        assert_eq!(
            adult_born_on_or_before(now),
            time::macros::date!(2005 - 10 - 07)
        );
    }
}
