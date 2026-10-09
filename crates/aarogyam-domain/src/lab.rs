//! Lab work: outside labs, the work sent to them, where an order is, and what a reminder to a
//! lab may say. Reminders name the clinic, the order number and the work, never the patient.

use crate::dental::Tooth;

text_value!(
    /// What kind of lab.
    LabKind("kind") {
        /// Crowns, bridges, dentures, aligners.
        DentalLab => "dental_lab",
        /// Blood and tissue tests.
        Pathology => "pathology",
        /// Scans and X-rays.
        Radiology => "radiology",
        /// Anything else.
        Other => "other",
    }
);

text_value!(
    /// How a lab contact likes to be reached. Only email is sent today; `WhatsApp` comes with the
    /// messaging service.
    ContactChannel("preferred_channel") {
        /// Email.
        Email => "email",
        /// `WhatsApp`.
        Whatsapp => "whatsapp",
        /// A phone call.
        Phone => "phone",
    }
);

text_value!(
    /// Where a lab order is.
    LabOrderStatus("status") {
        /// Being written; not at the lab yet.
        Draft => "draft",
        /// Handed to the lab.
        Sent => "sent",
        /// The lab is working on it.
        InProgress => "in_progress",
        /// Back from the lab.
        Received => "received",
        /// Fitted in the patient's mouth.
        Fitted => "fitted",
        /// Sent back to be made again; the remake is a new order (`rework_of_id`).
        ReturnedForRework => "returned_for_rework",
        /// Called off.
        Cancelled => "cancelled",
    }
);

impl LabOrderStatus {
    /// Whether an order may move from this status to `next`.
    #[must_use]
    pub const fn can_move_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Draft, Self::Sent | Self::Cancelled)
                | (
                    Self::Sent,
                    Self::InProgress | Self::Received | Self::Cancelled
                )
                | (Self::InProgress, Self::Received | Self::Cancelled)
                | (Self::Received, Self::Fitted | Self::ReturnedForRework)
        )
    }

    /// Whether the work is at the lab, so reminders and the overdue list apply.
    #[must_use]
    pub const fn at_lab(self) -> bool {
        matches!(self, Self::Sent | Self::InProgress)
    }

    /// Whether nothing more happens to the order.
    #[must_use]
    pub const fn is_final(self) -> bool {
        matches!(
            self,
            Self::Fitted | Self::ReturnedForRework | Self::Cancelled
        )
    }
}

text_value!(
    /// Why a reminder went to a lab.
    LabReminder("reminder") {
        /// Due within two days.
        DueSoon => "due_soon",
        /// Due today.
        DueToday => "due_today",
        /// A member asked for it.
        Manual => "manual",
    }
);

text_value!(
    /// What happened to an order.
    LabEventKind("kind") {
        /// The order was recorded.
        Created => "created",
        /// It moved to another status.
        StatusChanged => "status_changed",
        /// Its stage changed.
        StageChanged => "stage_changed",
        /// Its due date changed.
        DueChanged => "due_changed",
        /// The lab was emailed a reminder.
        Reminded => "reminded",
        /// A reminder was due but the lab has no email address.
        ReminderSkipped => "reminder_skipped",
        /// The due date passed with the work still at the lab.
        Overdue => "overdue",
    }
);

text_value!(
    /// A lab payment's state.
    LabPaymentStatus("status") {
        /// Counts against the lab's balance; its expense counts in reports.
        Recorded => "recorded",
        /// Voided with a reason, with its expense.
        Void => "void",
    }
);

/// Most items on one order.
pub const MAX_ITEMS: usize = 50;
/// Most teeth on one item.
pub const MAX_TEETH: usize = 32;
/// Most of one item.
pub const MAX_QTY: i32 = 100;
/// The most a lab may charge for one item: ₹10 lakh.
pub const MAX_UNIT_COST_PAISE: i64 = 100_000_000;

/// Why a lab value was refused. Messages never echo the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LabError {
    /// Not FDI tooth numbers, repeated, or too many.
    #[error("must be up to 32 different FDI tooth numbers: 11-48, or 51-85 for primary teeth")]
    Teeth,
    /// Quantity out of range.
    #[error("must be 1 to 100")]
    Qty,
    /// Unit cost out of range.
    #[error("must be 0 to 10,00,000 rupees")]
    UnitCost,
    /// No items, or too many.
    #[error("must have 1 to 50 items")]
    Items,
}

/// Checks the teeth of an item: FDI numbers, each once, sorted.
///
/// # Errors
/// [`LabError::Teeth`] for a non-FDI number, a repeat, or more than [`MAX_TEETH`].
pub fn check_teeth(teeth: &[i64]) -> Result<Vec<i16>, LabError> {
    let mut checked = teeth
        .iter()
        .map(|&n| Tooth::new(n).map(|t| i16::from(t.number())))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| LabError::Teeth)?;
    checked.sort_unstable();
    let before = checked.len();
    checked.dedup();
    if checked.len() != before || checked.len() > MAX_TEETH {
        return Err(LabError::Teeth);
    }
    Ok(checked)
}

/// Checks a quantity.
///
/// # Errors
/// [`LabError::Qty`] outside 1 to [`MAX_QTY`].
pub const fn check_qty(qty: i32) -> Result<i32, LabError> {
    if qty >= 1 && qty <= MAX_QTY {
        Ok(qty)
    } else {
        Err(LabError::Qty)
    }
}

/// Checks a unit cost in paise.
///
/// # Errors
/// [`LabError::UnitCost`] outside 0 to [`MAX_UNIT_COST_PAISE`].
pub const fn check_unit_cost(paise: i64) -> Result<i64, LabError> {
    if paise >= 0 && paise <= MAX_UNIT_COST_PAISE {
        Ok(paise)
    } else {
        Err(LabError::UnitCost)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_move_forward_only() {
        use LabOrderStatus::*;
        assert!(Draft.can_move_to(Sent));
        assert!(Sent.can_move_to(InProgress));
        assert!(InProgress.can_move_to(Received));
        assert!(Received.can_move_to(Fitted));
        assert!(Received.can_move_to(ReturnedForRework));
        assert!(!Draft.can_move_to(Received));
        assert!(!Fitted.can_move_to(Sent));
        assert!(!Cancelled.can_move_to(Draft));
        assert!(!Received.can_move_to(Cancelled));
        for status in LabOrderStatus::ALL {
            assert!(!status.can_move_to(*status));
            assert_eq!(LabOrderStatus::parse(status.as_str()), Ok(*status));
        }
        assert!(Sent.at_lab() && InProgress.at_lab() && !Received.at_lab());
        assert!(Fitted.is_final() && !Sent.is_final());
    }

    #[test]
    fn teeth_are_fdi_unique_and_sorted() {
        assert_eq!(check_teeth(&[36, 11]), Ok(vec![11, 36]));
        assert_eq!(check_teeth(&[]), Ok(vec![]));
        assert_eq!(check_teeth(&[19]), Err(LabError::Teeth));
        assert_eq!(check_teeth(&[11, 11]), Err(LabError::Teeth));
        assert_eq!(check_teeth(&[86]), Err(LabError::Teeth));
    }

    #[test]
    fn quantities_and_costs_are_bounded() {
        assert_eq!(check_qty(1), Ok(1));
        assert_eq!(check_qty(0), Err(LabError::Qty));
        assert_eq!(check_qty(101), Err(LabError::Qty));
        assert_eq!(check_unit_cost(0), Ok(0));
        assert_eq!(check_unit_cost(-1), Err(LabError::UnitCost));
        assert_eq!(
            check_unit_cost(MAX_UNIT_COST_PAISE + 1),
            Err(LabError::UnitCost)
        );
    }
}
