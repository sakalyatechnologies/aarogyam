//! Lab work: outside labs, the work sent to them, where an order is, and what a reminder to a
//! lab may say. Reminders name the clinic, the order number and the work, never the patient.

use std::fmt::Write as _;

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

    /// Whether the order still needs something done: sending, the lab's work, or fitting.
    #[must_use]
    pub const fn is_open(self) -> bool {
        matches!(
            self,
            Self::Draft | Self::Sent | Self::InProgress | Self::Received
        )
    }

    /// The stage the front desk sees.
    #[must_use]
    pub const fn pipeline(self) -> LabPipeline {
        match self {
            Self::Draft => LabPipeline::ToSend,
            Self::Sent => LabPipeline::Sent,
            Self::InProgress => LabPipeline::InProgress,
            Self::Received => LabPipeline::ReadyToFit,
            Self::Fitted => LabPipeline::Fitted,
            Self::ReturnedForRework => LabPipeline::Rework,
            Self::Cancelled => LabPipeline::Cancelled,
        }
    }

    /// Whether the work is still at the lab after its due day (`today` is the clinic's date).
    #[must_use]
    pub fn is_late(self, due_on: Option<time::Date>, today: time::Date) -> bool {
        self.at_lab() && due_on.is_some_and(|due| due < today)
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
    /// Where an order stands for the front desk, derived from its status.
    LabPipeline("pipeline_stage") {
        /// Written but not yet handed to the lab.
        ToSend => "to_send",
        /// Handed to the lab; work not started as far as the clinic knows.
        Sent => "sent",
        /// The lab is making it.
        InProgress => "in_progress",
        /// Back from the lab, waiting to be fitted.
        ReadyToFit => "ready_to_fit",
        /// Fitted: done.
        Fitted => "fitted",
        /// Sent back to be made again.
        Rework => "rework",
        /// Called off.
        Cancelled => "cancelled",
    }
);
text_value!(
    /// The five steps the portal's tracker shows for a dental order. Derived from the order's
    /// status and its free-text stage by [`tracker_stage`]; never stored.
    TrackerStage("tracker_stage") {
        /// The impression is being taken or the order is still a draft.
        Impression => "impression",
        /// The lab is making the work (also work sent back for a remake).
        Production => "production",
        /// A trial: wax try-in, framework trial or bisque, at the lab or in the chair.
        Trial => "trial",
        /// The finished work is ready to be fitted.
        Final => "final",
        /// Fitted in the patient's mouth.
        Delivered => "delivered",
    }
);

/// Words in a free-text stage that mean a trial.
const TRIAL_WORDS: &[&str] = &["try", "trial", "bisque", "framework", "wax"];
/// Words in a free-text stage that mean the finished work.
const FINAL_WORDS: &[&str] = &["final", "finish", "glaz", "polish", "cement"];

fn mentions(stage: Option<&str>, words: &[&str]) -> bool {
    stage.is_some_and(|text| {
        let text = text.to_lowercase();
        words.iter().any(|word| text.contains(word))
    })
}

/// Where an order is on the five-step tracker, from its status and free-text stage; `None` for
/// a cancelled order, which is on no step.
///
/// - `draft`: impression.
/// - `sent`, `in_progress`: production, unless the stage names a trial (try, trial, bisque,
///   framework, wax: trial) or the finished work (final, finish, glaze or glazing, polish, cement: final).
/// - `received`: trial when the stage names one, else final (back from the lab, to be fitted).
/// - `fitted`: delivered.
/// - `returned_for_rework`: production (the remake is a new order, which starts at its own step).
#[must_use]
pub fn tracker_stage(status: LabOrderStatus, stage: Option<&str>) -> Option<TrackerStage> {
    match status {
        LabOrderStatus::Cancelled => None,
        LabOrderStatus::Draft => Some(TrackerStage::Impression),
        LabOrderStatus::Sent | LabOrderStatus::InProgress => {
            Some(if mentions(stage, TRIAL_WORDS) {
                TrackerStage::Trial
            } else if mentions(stage, FINAL_WORDS) {
                TrackerStage::Final
            } else {
                TrackerStage::Production
            })
        }
        LabOrderStatus::Received => Some(if mentions(stage, TRIAL_WORDS) {
            TrackerStage::Trial
        } else {
            TrackerStage::Final
        }),
        LabOrderStatus::Fitted => Some(TrackerStage::Delivered),
        LabOrderStatus::ReturnedForRework => Some(TrackerStage::Production),
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
        /// A member called, messaged, emailed or visited the lab.
        Contacted => "contacted",
        /// An item was added after the order was recorded.
        ItemAdded => "item_added",
        /// An item was changed.
        ItemChanged => "item_changed",
        /// An item was removed.
        ItemRemoved => "item_removed",
    }
);

text_value!(
    /// How a member got in touch with a lab, for the contact log.
    ContactLogChannel("channel") {
        /// A phone call.
        Call => "call",
        /// A `WhatsApp` message.
        Whatsapp => "whatsapp",
        /// An email.
        Email => "email",
        /// In person.
        Visit => "visit",
    }
);

text_value!(
    /// What came of contacting a lab.
    ContactOutcome("outcome") {
        /// Spoke to someone.
        Reached => "reached",
        /// Nobody answered.
        NoAnswer => "no_answer",
        /// The lab promised a date (`promised_on`).
        PromisedDate => "promised_date",
        /// Anything else; see the note.
        Other => "other",
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

text_value!(
    /// How a batch reminder reaches the labs.
    ReminderChannel("channel") {
        /// An email through the outbox, one per lab.
        Email => "email",
        /// A `wa.me` link per lab for staff to open in `WhatsApp`; nothing is sent by us.
        Whatsapp => "whatsapp",
    }
);

/// Most orders one batch reminder names.
pub const MAX_REMINDER_ORDERS: usize = 50;

/// One item of work in a reminder: what the lab makes, never who for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderItem {
    /// What to make.
    pub work_type: String,
    /// FDI tooth numbers.
    pub teeth: Vec<i16>,
    /// Shade.
    pub shade: Option<String>,
}

/// One order in a reminder. There is deliberately no patient field here: a reminder to a lab
/// is built only from this, so it cannot name the patient.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderOrder {
    /// `LAB-<n>`.
    pub number: String,
    /// When it is due back.
    pub due_on: Option<time::Date>,
    /// The work.
    pub items: Vec<ReminderItem>,
}

impl ReminderItem {
    /// `Crown, tooth 36, shade A2`.
    #[must_use]
    pub fn line(&self) -> String {
        let mut line = self.work_type.clone();
        if !self.teeth.is_empty() {
            let teeth: Vec<String> = self.teeth.iter().map(ToString::to_string).collect();
            line.push_str(if teeth.len() == 1 {
                ", tooth "
            } else {
                ", teeth "
            });
            line.push_str(&teeth.join(" "));
        }
        if let Some(shade) = &self.shade {
            line.push_str(", shade ");
            line.push_str(shade);
        }
        line
    }
}

/// The outbox payload of an email reminder about `orders` of one lab: the clinic and, for each
/// order, its number, due date and work. The renderer (`aarogyam-notify`) reads `orders`.
#[must_use]
pub fn reminder_payload(clinic_name: &str, orders: &[ReminderOrder]) -> serde_json::Value {
    serde_json::json!({
        "clinic_name": clinic_name,
        "reminder": "manual",
        "orders": orders.iter().map(|order| serde_json::json!({
            "order_number": order.number,
            "due_on": order.due_on.map(|d| d.to_string()),
            "items": order.items.iter().map(|item| serde_json::json!({
                "work_type": item.work_type,
                "teeth": item.teeth,
                "shade": item.shade,
            })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    })
}

/// The `WhatsApp` message for a batch reminder to one lab: the clinic, then each order's number,
/// due date and work. Plain text with line breaks.
#[must_use]
pub fn reminder_text(clinic_name: &str, orders: &[ReminderOrder]) -> String {
    let mut text = format!("Hello, this is {clinic_name}. A reminder about our lab work:");
    for order in orders {
        text.push_str("\n\n");
        text.push_str(&order.number);
        if let Some(due) = order.due_on {
            let _ = write!(text, " (due {due})");
        }
        for item in &order.items {
            text.push_str("\n- ");
            text.push_str(&item.line());
        }
    }
    text.push_str("\n\nPlease reply if the date will change.");
    text
}

/// Most work types one lab lists.
pub const MAX_WORK_TYPES: usize = 20;
/// Longest work type, in characters.
pub const MAX_WORK_TYPE_CHARS: usize = 40;
/// Longest turnaround a lab may state, in days.
pub const MAX_TURNAROUND_DAYS: i32 = 90;

/// Checks the work types a lab does: trimmed, 1 to 40 characters each on one line, no repeats
/// (ignoring case), at most 20. Kept in the order given.
///
/// # Errors
/// [`LabError::WorkTypes`] for an empty, long or repeated one, or too many.
pub fn check_work_types(types: &[String]) -> Result<Vec<String>, LabError> {
    let mut checked: Vec<String> = Vec::with_capacity(types.len());
    for text in types {
        let text = text.trim();
        let chars = text.chars().count();
        if chars == 0 || chars > MAX_WORK_TYPE_CHARS || text.chars().any(char::is_control) {
            return Err(LabError::WorkTypes);
        }
        if checked
            .iter()
            .any(|t| t.to_lowercase() == text.to_lowercase())
        {
            return Err(LabError::WorkTypes);
        }
        checked.push(text.to_owned());
    }
    if checked.len() > MAX_WORK_TYPES {
        return Err(LabError::WorkTypes);
    }
    Ok(checked)
}

/// Checks a lab's usual turnaround, in days.
///
/// # Errors
/// [`LabError::Turnaround`] outside 1 to [`MAX_TURNAROUND_DAYS`].
pub const fn check_turnaround_days(days: i32) -> Result<i16, LabError> {
    if days >= 1 && days <= MAX_TURNAROUND_DAYS {
        #[expect(clippy::cast_possible_truncation, reason = "checked to 1..=90")]
        Ok(days as i16)
    } else {
        Err(LabError::Turnaround)
    }
}

/// A `https://wa.me/<digits>?text=<encoded>` link that opens a `WhatsApp` chat with the number,
/// the message typed in. `phone_e164` is `+` and digits; the text is percent-encoded. `None`
/// for anything that isn't a phone number.
#[must_use]
pub fn whatsapp_link(phone_e164: &str, text: &str) -> Option<String> {
    let digits = phone_e164.strip_prefix('+')?;
    if digits.len() < 7 || digits.len() > 15 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut link = format!("https://wa.me/{digits}?text=");
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            link.push(char::from(byte));
        } else {
            let _ = write!(link, "%{byte:02X}");
        }
    }
    Some(link)
}

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
    /// A work type that is empty, long, repeated, or too many of them.
    #[error("must be up to 20 different work types of 1 to 40 characters")]
    WorkTypes,
    /// Turnaround out of range.
    #[error("must be 1 to 90 days")]
    Turnaround,
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
    fn the_pipeline_stage_and_late_flag_follow_the_status() {
        use LabOrderStatus::*;
        use time::macros::date;
        let today = date!(2026 - 10 - 10);
        let open: Vec<_> = LabOrderStatus::ALL
            .iter()
            .filter(|s| s.is_open())
            .copied()
            .collect();
        assert_eq!(open, [Draft, Sent, InProgress, Received]);
        assert_eq!(Draft.pipeline(), LabPipeline::ToSend);
        assert_eq!(Received.pipeline(), LabPipeline::ReadyToFit);
        assert_eq!(ReturnedForRework.pipeline().as_str(), "rework");
        // Late only while at the lab and due before today.
        assert!(Sent.is_late(Some(date!(2026 - 10 - 09)), today));
        assert!(InProgress.is_late(Some(date!(2026 - 10 - 09)), today));
        assert!(!Sent.is_late(Some(today), today));
        assert!(!Sent.is_late(None, today));
        assert!(!Received.is_late(Some(date!(2026 - 10 - 01)), today));
        assert!(!Draft.is_late(Some(date!(2026 - 10 - 01)), today));
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

    #[test]
    fn the_tracker_follows_status_and_stage() {
        use LabOrderStatus::*;
        use TrackerStage::*;
        assert_eq!(tracker_stage(Draft, None), Some(Impression));
        assert_eq!(tracker_stage(Sent, None), Some(Production));
        assert_eq!(tracker_stage(InProgress, Some("Wax try-in")), Some(Trial));
        assert_eq!(
            tracker_stage(InProgress, Some("framework trial")),
            Some(Trial)
        );
        assert_eq!(tracker_stage(Sent, Some("Glazing")), Some(Final));
        assert_eq!(tracker_stage(Received, None), Some(Final));
        assert_eq!(tracker_stage(Received, Some("Bisque")), Some(Trial));
        assert_eq!(tracker_stage(Fitted, Some("wax")), Some(Delivered));
        assert_eq!(tracker_stage(ReturnedForRework, None), Some(Production));
        assert_eq!(tracker_stage(Cancelled, None), None);
        for stage in TrackerStage::ALL {
            assert_eq!(TrackerStage::parse(stage.as_str()), Ok(*stage));
        }
    }

    #[test]
    fn work_types_and_turnaround_are_bounded() {
        let ok =
            |v: &[&str]| check_work_types(&v.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>());
        assert_eq!(
            ok(&[" Crown ", "Bridge"]),
            Ok(vec!["Crown".into(), "Bridge".into()])
        );
        assert_eq!(ok(&[]), Ok(vec![]));
        assert_eq!(ok(&["Crown", "crown"]), Err(LabError::WorkTypes));
        assert_eq!(ok(&[" "]), Err(LabError::WorkTypes));
        assert_eq!(ok(&[&"x".repeat(41)]), Err(LabError::WorkTypes));
        let many: Vec<String> = (0..21).map(|n| format!("type {n}")).collect();
        assert_eq!(check_work_types(&many), Err(LabError::WorkTypes));
        assert_eq!(check_turnaround_days(1), Ok(1));
        assert_eq!(check_turnaround_days(0), Err(LabError::Turnaround));
        assert_eq!(check_turnaround_days(91), Err(LabError::Turnaround));
    }

    #[test]
    fn whatsapp_links_carry_an_encoded_message() {
        assert_eq!(
            whatsapp_link("+919812345678", "LAB-7: Crown, tooth 36\nThanks").as_deref(),
            Some("https://wa.me/919812345678?text=LAB-7%3A%20Crown%2C%20tooth%2036%0AThanks")
        );
        assert_eq!(whatsapp_link("9812345678", "x"), None);
        assert_eq!(whatsapp_link("+98a", "x"), None);
    }

    #[test]
    fn reminders_list_the_work_and_carry_no_patient() {
        let orders = [
            ReminderOrder {
                number: "LAB-7".into(),
                due_on: time::Date::from_calendar_date(2026, time::Month::October, 12).ok(),
                items: vec![
                    ReminderItem {
                        work_type: "Crown".into(),
                        teeth: vec![36],
                        shade: Some("A2".into()),
                    },
                    ReminderItem {
                        work_type: "Bridge".into(),
                        teeth: vec![44, 45, 46],
                        shade: None,
                    },
                ],
            },
            ReminderOrder {
                number: "LAB-9".into(),
                due_on: None,
                items: vec![],
            },
        ];
        let text = reminder_text("Sunrise Dental", &orders);
        assert!(text.contains(
            "LAB-7 (due 2026-10-12)\n- Crown, tooth 36, shade A2\n- Bridge, teeth 44 45 46"
        ));
        assert!(text.contains("LAB-9\n\nPlease reply"));
        let payload = reminder_payload("Sunrise Dental", &orders);
        assert_eq!(payload["orders"][0]["order_number"], "LAB-7");
        assert_eq!(payload["orders"][1]["due_on"], serde_json::Value::Null);
        assert!(!payload.to_string().contains("patient"));
        assert_eq!(
            ReminderChannel::parse("whatsapp"),
            Ok(ReminderChannel::Whatsapp)
        );
        assert!(ReminderChannel::parse("sms").is_err());
    }
}
