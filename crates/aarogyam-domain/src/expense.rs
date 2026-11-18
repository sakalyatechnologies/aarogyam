//! Clinic expenses: what money went out on, how an entry is checked, and its state.

use sakalya_types::Paise;

text_value!(
    /// A system expense category, seeded for every clinic. Stock deliveries count as
    /// [`ExpenseCategoryKey::Material`] in reports.
    ExpenseCategoryKey("category") {
        /// Staff salaries.
        Salary => "salary",
        /// Consumables and materials bought outside stock.
        Material => "material",
        /// Electricity bills.
        Electricity => "electricity",
        /// Outside lab work.
        Lab => "lab",
        /// Rent.
        Rent => "rent",
        /// Anything else.
        Other => "other",
    }
);

text_value!(
    /// An expense entry's state.
    ExpenseStatus("status") {
        /// Counts in reports.
        Recorded => "recorded",
        /// Voided with a reason; no longer counts.
        Void => "void",
    }
);

text_value!(
    /// How often a recurring expense is recorded.
    Cadence("cadence") {
        /// On a day of every month; a shorter month uses its last day.
        Monthly => "monthly",
        /// On a weekday of every week.
        Weekly => "weekly",
    }
);

text_value!(
    /// Where a recurring expense stands.
    RecurringStatus("status") {
        /// Records an expense on each due day.
        Active => "active",
        /// Records nothing until resumed; the days it was paused are skipped.
        Paused => "paused",
        /// Stopped for good.
        Stopped => "stopped",
        /// Past its end date.
        Ended => "ended",
    }
);

/// The day a recurring expense falls on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DueDay {
    /// Day 1 to 31 of every month.
    Monthly(u8),
    /// ISO weekday 1 (Monday) to 7 (Sunday) of every week.
    Weekly(u8),
}

/// Why a recurring day was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DueDayError {
    /// A monthly rule needs `day_of_month` 1 to 31 and no weekday.
    #[error("a monthly expense needs a day of the month from 1 to 31")]
    DayOfMonth,
    /// A weekly rule needs `weekday` 1 to 7 and no day of the month.
    #[error("a weekly expense needs a weekday from 1 (Monday) to 7 (Sunday)")]
    Weekday,
}

impl DueDay {
    /// Checks the day for the cadence: exactly the matching one of the two is set.
    ///
    /// # Errors
    /// [`DueDayError`] for a missing, extra or out-of-range day.
    pub fn new(
        cadence: Cadence,
        day_of_month: Option<i16>,
        weekday: Option<i16>,
    ) -> Result<Self, DueDayError> {
        match (cadence, day_of_month, weekday) {
            (Cadence::Monthly, Some(day @ 1..=31), None) => Ok(Self::Monthly(
                u8::try_from(day).map_err(|_| DueDayError::DayOfMonth)?,
            )),
            (Cadence::Monthly, _, _) => Err(DueDayError::DayOfMonth),
            (Cadence::Weekly, None, Some(day @ 1..=7)) => Ok(Self::Weekly(
                u8::try_from(day).map_err(|_| DueDayError::Weekday)?,
            )),
            (Cadence::Weekly, _, _) => Err(DueDayError::Weekday),
        }
    }

    /// The cadence.
    #[must_use]
    pub const fn cadence(self) -> Cadence {
        match self {
            Self::Monthly(_) => Cadence::Monthly,
            Self::Weekly(_) => Cadence::Weekly,
        }
    }

    /// The day of the month, for a monthly rule.
    #[must_use]
    pub fn day_of_month(self) -> Option<i16> {
        match self {
            Self::Monthly(day) => Some(i16::from(day)),
            Self::Weekly(_) => None,
        }
    }

    /// The weekday, for a weekly rule.
    #[must_use]
    pub fn weekday(self) -> Option<i16> {
        match self {
            Self::Weekly(day) => Some(i16::from(day)),
            Self::Monthly(_) => None,
        }
    }
}

/// The largest single expense accepted: ₹1 crore. Stops a slipped digit from swamping reports.
pub const MAX_EXPENSE: Paise = Paise::new(1_000_000_000);

/// Why an expense entry was refused. Messages never echo the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ExpenseError {
    /// The amount is zero, negative or above [`MAX_EXPENSE`].
    #[error("must be more than zero and at most 1,00,00,000 rupees")]
    Amount,
    /// The note is longer than 300 characters.
    #[error("must be at most 300 characters")]
    NoteTooLong,
}

/// Checks an expense amount.
///
/// # Errors
/// [`ExpenseError::Amount`] unless it is above zero and at most [`MAX_EXPENSE`].
pub fn check_amount(amount: Paise) -> Result<Paise, ExpenseError> {
    if amount.get() > 0 && amount <= MAX_EXPENSE {
        Ok(amount)
    } else {
        Err(ExpenseError::Amount)
    }
}

/// Trims a note; blank becomes none.
///
/// # Errors
/// [`ExpenseError::NoteTooLong`] past 300 characters.
pub fn check_note(note: Option<&str>) -> Result<Option<String>, ExpenseError> {
    match note.map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) if text.chars().count() > 300 => Err(ExpenseError::NoteTooLong),
        Some(text) => Ok(Some(text.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_due_day_matches_its_cadence() {
        assert_eq!(
            DueDay::new(Cadence::Monthly, Some(31), None),
            Ok(DueDay::Monthly(31))
        );
        assert_eq!(
            DueDay::new(Cadence::Weekly, None, Some(1)),
            Ok(DueDay::Weekly(1))
        );
        for (cadence, day, weekday) in [
            (Cadence::Monthly, Some(0), None),
            (Cadence::Monthly, Some(32), None),
            (Cadence::Monthly, None, Some(1)),
            (Cadence::Monthly, Some(1), Some(1)),
            (Cadence::Weekly, None, Some(8)),
            (Cadence::Weekly, None, Some(0)),
            (Cadence::Weekly, Some(3), None),
        ] {
            assert!(
                DueDay::new(cadence, day, weekday).is_err(),
                "{day:?} {weekday:?}"
            );
        }
        let day = DueDay::Weekly(3);
        assert_eq!(
            (day.cadence(), day.day_of_month(), day.weekday()),
            (Cadence::Weekly, None, Some(3))
        );
    }

    #[test]
    fn amounts_must_be_positive_and_bounded() {
        assert_eq!(check_amount(Paise::new(1)), Ok(Paise::new(1)));
        assert_eq!(check_amount(MAX_EXPENSE), Ok(MAX_EXPENSE));
        assert_eq!(check_amount(Paise::ZERO), Err(ExpenseError::Amount));
        assert_eq!(check_amount(Paise::new(-5)), Err(ExpenseError::Amount));
        assert_eq!(
            check_amount(Paise::new(MAX_EXPENSE.get() + 1)),
            Err(ExpenseError::Amount)
        );
    }

    #[test]
    fn notes_are_trimmed_and_bounded() {
        assert_eq!(check_note(None), Ok(None));
        assert_eq!(check_note(Some("  ")), Ok(None));
        assert_eq!(check_note(Some(" Rent ")), Ok(Some("Rent".into())));
        assert_eq!(
            check_note(Some(&"x".repeat(301))),
            Err(ExpenseError::NoteTooLong)
        );
    }

    #[test]
    fn category_keys_round_trip() {
        for key in ExpenseCategoryKey::ALL {
            assert_eq!(ExpenseCategoryKey::parse(key.as_str()), Ok(*key));
        }
        assert!(ExpenseCategoryKey::parse("travel").is_err());
    }
}
