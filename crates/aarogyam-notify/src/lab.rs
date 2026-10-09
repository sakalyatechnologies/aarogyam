//! Lab reminders in the outbox job, and the email a lab gets.
//!
//! A lab contact is not a patient, so the email goes through the outbox addressed to the
//! contact. It names the clinic, the order number, the work, teeth, shade and due date: there is
//! no patient field in the payload to leak (`app.lab_reminder_payload`, migration 0363).

use aarogyam_dal::labs as dal;
use aarogyam_domain::event::Event;
use sakalya_db::{Db, DbError};
use serde_json::Value;
use time::OffsetDateTime;

use crate::Failure;
use crate::templates::{Email, escape, field};

/// Most orders one run looks at.
const BATCH: i32 = 200;

/// What one lab reminder run did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LabReminderReport {
    /// Reminders queued to labs.
    pub reminded: usize,
    /// Reminders due to labs with no email address.
    pub skipped: usize,
    /// Orders newly flagged overdue.
    pub overdue: usize,
}

/// Emails labs about work due in two days and today, and flags overdue work, across clinics
/// while each clinic's clock is between 09:00 and 20:00. Each step runs once per due date, also
/// when runs overlap: the database takes each step with a conditional update.
///
/// # Errors
/// [`DbError`] when the database fails; steps already taken stay taken.
pub async fn remind_labs(db: &Db, now: OffsetDateTime) -> Result<LabReminderReport, DbError> {
    let steps = dal::run_reminders(db.pool(), now, BATCH).await?;
    let mut report = LabReminderReport::default();
    for step in &steps {
        match (step.step.as_str(), step.message_id) {
            ("overdue", _) => report.overdue += 1,
            (_, Some(_)) => report.reminded += 1,
            (_, None) => report.skipped += 1,
        }
        tracing::info!(
            event = Event::LabOrderReminded.as_str(),
            org_id = %step.org_id,
            lab_order_id = %step.lab_order_id,
            step = %step.step,
            queued = step.message_id.is_some(),
            "lab order reminder step"
        );
    }
    Ok(report)
}

/// One line per item: `Crown, teeth 36, shade A2`.
fn item_line(item: &Value) -> Option<String> {
    let work = item.get("work_type")?.as_str()?;
    let mut line = work.to_owned();
    let teeth: Vec<String> = item
        .get("teeth")
        .and_then(Value::as_array)
        .map(|t| {
            t.iter()
                .filter_map(Value::as_i64)
                .map(|n| n.to_string())
                .collect()
        })
        .unwrap_or_default();
    if !teeth.is_empty() {
        let label = if teeth.len() == 1 { "tooth" } else { "teeth" };
        line.push_str(", ");
        line.push_str(label);
        line.push(' ');
        line.push_str(&teeth.join(" "));
    }
    if let Some(shade) = item.get("shade").and_then(Value::as_str) {
        line.push_str(", shade ");
        line.push_str(shade);
    }
    Some(line)
}

/// The reminder a lab gets.
pub(crate) fn render_reminder(to: String, payload: &Value) -> Result<Email, Failure> {
    let clinic = field(payload, "clinic_name")?;
    let number = field(payload, "order_number")?;
    let due = field(payload, "due_on")?;
    let when = match payload.get("reminder").and_then(Value::as_str) {
        Some("due_today") => "is due today",
        Some("due_soon") => "is due soon",
        _ => "is due",
    };
    let items: Vec<String> = payload
        .get("items")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(item_line).collect())
        .unwrap_or_default();
    let subject = format!("{clinic}: lab order {number} {when} ({due})");
    let intro = format!("Lab order {number} from {clinic} {when}, on {due}.");
    let text = format!(
        "{intro}\n\n{}\n\nPlease reply to the clinic if the date will change.",
        items.join("\n")
    );
    let list: String = items
        .iter()
        .flat_map(|i| ["<li>".to_owned(), escape(i), "</li>".to_owned()])
        .collect();
    let html = format!(
        "<p>{}</p><ul>{list}</ul><p>Please reply to the clinic if the date will change.</p>",
        escape(&intro)
    );
    Ok(Email {
        to,
        subject,
        text,
        html,
        list_unsubscribe: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reminders_name_the_work_and_never_a_patient() {
        let payload = json!({
            "clinic_name": "Sunrise <Dental>", "order_number": "LAB-7", "due_on": "2026-10-11",
            "reminder": "due_today", "patient_name": "Ravi Kumar",
            "items": [{ "work_type": "Crown", "teeth": [36], "shade": "A2" },
                      { "work_type": "Bridge", "teeth": [44, 45, 46], "shade": null }],
        });
        let email = render_reminder("lab@example.in".into(), &payload).unwrap();
        assert_eq!(
            email.subject,
            "Sunrise <Dental>: lab order LAB-7 is due today (2026-10-11)"
        );
        assert!(email.text.contains("Crown, tooth 36, shade A2"));
        assert!(email.text.contains("Bridge, teeth 44 45 46"));
        assert!(email.html.contains("Sunrise &lt;Dental&gt;"));
        for body in [&email.subject, &email.text, &email.html] {
            assert!(!body.contains("Ravi"));
        }
        assert!(render_reminder("x@y.in".into(), &json!({})).is_err());
    }
}
