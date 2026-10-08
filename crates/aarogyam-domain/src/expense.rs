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
