//! What patient messages say. Booking answers, prescription links and app invitations keep the
//! wording they had in the outbox (`templates.rs`); appointment reminders and the messages staff
//! send are rendered here. Reminders and promotional email carry an unsubscribe link in the
//! `List-Unsubscribe` header.

use std::fmt::Write as _;

use aarogyam_dal::outbox::Claimed;
use aarogyam_domain::messaging::Template;
use aarogyam_domain::outbox::MessageKind;
use serde_json::Value;
use time::{OffsetDateTime, UtcOffset};
use uuid::Uuid;

use crate::Failure;
use crate::templates::{self, Email, PortalLinks, escape, field};

/// One patient email to render, as `app.message_dispatch` reported it.
pub(crate) struct PatientMail<'a> {
    pub(crate) kind: MessageKind,
    pub(crate) template_key: &'a str,
    pub(crate) to: &'a str,
    pub(crate) variables: &'a Value,
    pub(crate) body: Option<&'a str>,
    pub(crate) secret: Option<&'a str>,
    pub(crate) clinic_name: &'a str,
    pub(crate) timezone: &'a str,
    pub(crate) portal_host: Option<&'a str>,
    /// For a reminder: when the appointment starts and with whom.
    pub(crate) appointment: Option<(OffsetDateTime, &'a str)>,
    /// The one-click unsubscribe address, for reminders and promotional email.
    pub(crate) unsubscribe: Option<String>,
}

/// The clinic's offset: India's (no daylight saving); other zones are shown in UTC until a
/// time-zone database is added, as elsewhere (`aarogyam_app::clock::clinic_offset`).
pub(crate) fn clinic_offset(timezone: &str) -> UtcOffset {
    match timezone {
        "Asia/Kolkata" | "Asia/Calcutta" => UtcOffset::from_hms(5, 30, 0).unwrap_or(UtcOffset::UTC),
        _ => UtcOffset::UTC,
    }
}

pub(crate) fn when_text(at: OffsetDateTime) -> String {
    format!(
        "{} {} {}, {:02}:{:02}",
        at.day(),
        at.month(),
        at.year(),
        at.hour(),
        at.minute()
    )
}

/// An amount in paise as rupees and paise, such as `₹1500.50`.
fn rupees(paise: i64) -> String {
    format!("₹{}.{:02}", paise / 100, paise % 100)
}

const UNSUBSCRIBE_LINE: &str =
    "To stop these emails, use the Unsubscribe option in your email app.";

/// Plain text and simple HTML from paragraphs separated by blank lines.
fn paragraphs(clinic: &str, paras: &[String], footer: Option<&str>) -> (String, String) {
    let mut text = format!("{clinic}\n\n{}", paras.join("\n\n"));
    let mut html = format!("<p><strong>{}</strong></p>", escape(clinic));
    for para in paras {
        // Writing to a String can't fail.
        let _ = write!(html, "<p>{}</p>", escape(para).replace('\n', "<br>"));
    }
    if let Some(footer) = footer {
        let _ = write!(text, "\n\n{footer}");
        let _ = write!(html, "<p><small>{}</small></p>", escape(footer));
    }
    (text, html)
}

/// Renders a patient email.
pub(crate) fn render(mail: &PatientMail<'_>, portal: &PortalLinks) -> Result<Email, Failure> {
    let footer = mail.unsubscribe.as_ref().map(|_| UNSUBSCRIBE_LINE);
    let (subject, paras) = match mail.kind {
        MessageKind::AppointmentReminder => {
            let (starts_at, doctor) = mail
                .appointment
                .ok_or_else(|| Failure::permanent("no appointment"))?;
            let doctor = if doctor.starts_with("Dr") {
                doctor.to_owned()
            } else {
                format!("Dr {doctor}")
            };
            let when = when_text(starts_at.to_offset(clinic_offset(mail.timezone)));
            (
                format!("Reminder: your appointment at {}", mail.clinic_name),
                vec![
                    format!("This is a reminder of your appointment on {when} with {doctor}."),
                    "If you can't come, please let the clinic know.".to_owned(),
                ],
            )
        }
        MessageKind::PaymentReceipt => {
            let number = field(mail.variables, "receipt_number")?;
            let paise = mail
                .variables
                .get("amount_paise")
                .and_then(Value::as_i64)
                .filter(|paise| *paise > 0)
                .ok_or_else(|| Failure::permanent("no amount"))?;
            (
                format!("Receipt {number} from {}", mail.clinic_name),
                vec![
                    format!(
                        "Thank you. We received your payment of {}. Your receipt number is {number}.",
                        rupees(paise)
                    ),
                    "Keep this email for your records. The clinic can print a copy on request."
                        .to_owned(),
                ],
            )
        }
        MessageKind::ClinicMessage => staff_message(mail, portal)?,
        _ => {
            // The wording from the outbox days: rendered from the stored payload.
            let claimed = Claimed {
                org_id: Uuid::nil(),
                id: Uuid::nil(),
                event_key: mail.kind.as_str().to_owned(),
                channel: "email".to_owned(),
                recipient: Some(mail.to.to_owned()),
                payload: mail.variables.clone(),
                secret: mail.secret.map(str::to_owned),
                attempts: 0,
            };
            let mut email = templates::render(&claimed, portal)?;
            email.list_unsubscribe.clone_from(&mail.unsubscribe);
            return Ok(email);
        }
    };
    let (text, html) = paragraphs(mail.clinic_name, &paras, footer);
    Ok(Email {
        to: mail.to.to_owned(),
        subject,
        text,
        html,
        list_unsubscribe: mail.unsubscribe.clone(),
    })
}

/// A message staff sent (`clinic.message`): its template's subject and the staff member's text.
fn staff_message(
    mail: &PatientMail<'_>,
    portal: &PortalLinks,
) -> Result<(String, Vec<String>), Failure> {
    let template =
        Template::parse(mail.template_key).map_err(|_| Failure::permanent("unknown template"))?;
    match template {
        Template::CareNote | Template::Offer => {
            let subject = field(mail.variables, "subject")?.to_owned();
            let body = mail
                .body
                .filter(|text| !text.trim().is_empty())
                .ok_or_else(|| Failure::permanent("no body"))?;
            let paras = body
                .split("\n\n")
                .map(|part| part.trim().to_owned())
                .filter(|part| !part.is_empty())
                .collect();
            Ok((subject, paras))
        }
        Template::FollowUpReminder => {
            let due = mail
                .variables
                .get("due_on")
                .and_then(Value::as_str)
                .map_or_else(String::new, |day| format!(" on {day}"));
            let mut paras = vec![format!("Your follow-up visit is due{due}.")];
            paras.push(match mail.portal_host {
                Some(host) => format!("Book a time at {} or call the clinic.", portal.book(host)),
                None => "Please call the clinic to book a time.".to_owned(),
            });
            Ok((
                format!("Time for your follow-up at {}", mail.clinic_name),
                paras,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use time::macros::datetime;

    fn mail<'a>(kind: MessageKind, template: &'a str, variables: &'a Value) -> PatientMail<'a> {
        PatientMail {
            kind,
            template_key: template,
            to: "leela@example.in",
            variables,
            body: None,
            secret: None,
            clinic_name: "Alpha <Dental>",
            timezone: "Asia/Kolkata",
            portal_host: Some("alpha.localtest.me"),
            appointment: None,
            unsubscribe: None,
        }
    }

    #[test]
    fn reminders_show_the_clinic_time_and_carry_the_unsubscribe_header() {
        let none = json!({});
        let reminder = PatientMail {
            appointment: Some((datetime!(2026-10-10 04:30 UTC), "Ravi Rao")),
            unsubscribe: Some("https://alpha.localtest.me/api/v1/public/unsubscribe/t0k".into()),
            ..mail(
                MessageKind::AppointmentReminder,
                "appointment.reminder",
                &none,
            )
        };
        let email = render(&reminder, &PortalLinks::default()).unwrap();
        assert!(
            email
                .text
                .contains("10 October 2026, 10:00 with Dr Ravi Rao")
        );
        assert!(email.text.contains("Unsubscribe option"));
        assert!(email.html.contains("Alpha &lt;Dental&gt;"));
        assert!(
            email
                .list_unsubscribe
                .unwrap()
                .ends_with("/unsubscribe/t0k")
        );
    }

    #[test]
    fn staff_messages_use_their_template_and_text() {
        let subject = json!({ "subject": "Closed on Monday" });
        let note = PatientMail {
            body: Some("Dear patient,\n\nWe are closed <Monday>."),
            ..mail(MessageKind::ClinicMessage, "care.note", &subject)
        };
        let email = render(&note, &PortalLinks::default()).unwrap();
        assert_eq!(email.subject, "Closed on Monday");
        assert!(email.html.contains("closed &lt;Monday&gt;"));
        assert!(email.list_unsubscribe.is_none());
        let due = json!({ "due_on": "2026-11-01" });
        let follow_up = mail(MessageKind::ClinicMessage, "reminder.follow_up", &due);
        let email = render(&follow_up, &PortalLinks::default()).unwrap();
        assert!(email.text.contains("due on 2026-11-01"));
        assert!(email.text.contains("https://alpha.localtest.me/book"));
        let unknown = mail(MessageKind::ClinicMessage, "promo.spam", &due);
        assert!(render(&unknown, &PortalLinks::default()).is_err());
    }
}
