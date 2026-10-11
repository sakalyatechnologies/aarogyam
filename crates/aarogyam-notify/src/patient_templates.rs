//! What patient messages say. Booking answers, prescription links and app invitations keep the
//! wording they had in the outbox (`templates.rs`); appointment reminders and the messages staff
//! send are rendered here. Reminders and promotional email carry an unsubscribe link in the
//! `List-Unsubscribe` header.

use std::fmt::Write as _;

use aarogyam_dal::outbox::Claimed;
use aarogyam_domain::messaging::{Template, placeholders};
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
    /// The clinic's template text for the message, in the patient's language (the automatic
    /// messages are written from it).
    pub(crate) template_body: Option<&'a str>,
}

/// The values the automatic messages' `{{variables}}` take: links built from the clinic's portal
/// address and the one-time secret (a visit link's token, or its PIN), and the payload's few
/// values. Never anything about the patient.
pub(crate) struct AutoValues<'a> {
    pub(crate) clinic_name: &'a str,
    pub(crate) portal_host: Option<&'a str>,
    pub(crate) variables: &'a Value,
    pub(crate) secret: Option<&'a str>,
    pub(crate) links: &'a PortalLinks,
}

impl AutoValues<'_> {
    /// The value of one variable, if it has one.
    pub(crate) fn get(&self, name: &str) -> Option<String> {
        let host = self.portal_host;
        match name {
            "clinic_name" => Some(self.clinic_name.to_owned()),
            "app_link" => host.map(|host| self.links.home(host)),
            "website_link" => self
                .variables
                .get("website_link")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| host.map(|host| self.links.home(host))),
            "booking_link" => host.map(|host| self.links.book(host)),
            "share_link" => match (host, self.secret) {
                (Some(host), Some(token)) => Some(self.links.shared(host, token)),
                _ => None,
            },
            "pin" => self.secret.map(str::to_owned),
            other => self
                .variables
                .get(other)
                .and_then(Value::as_str)
                .map(str::to_owned),
        }
        .filter(|text| !text.trim().is_empty())
    }
}

/// A template body with each `{{variable}}` replaced; a permanent failure for a variable that
/// isn't allowed for the key or has no value.
pub(crate) fn fill(key: &str, body: &str, values: &AutoValues<'_>) -> Result<String, Failure> {
    let names = placeholders(key, body)
        .map_err(|_| Failure::permanent("template names a variable it may not"))?;
    let mut text = body.to_owned();
    for name in names {
        let value = values
            .get(&name)
            .ok_or_else(|| Failure::permanent("a template variable has no value"))?;
        // Every occurrence at once; a later pass finds none.
        text = text.replace(&format!("{{{{{name}}}}}"), &value);
    }
    Ok(text)
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
        MessageKind::ClinicMessage => staff_message(mail, portal)?,
        MessageKind::Welcome
        | MessageKind::VisitSummary
        | MessageKind::VisitSummaryPin
        | MessageKind::FollowUpBooking => automatic_message(mail, portal)?,
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

/// An automatic message (welcome, visit summary and its PIN, follow-up booking): the clinic's
/// template text for the patient's language, filled with links and a date.
fn automatic_message(
    mail: &PatientMail<'_>,
    portal: &PortalLinks,
) -> Result<(String, Vec<String>), Failure> {
    let body = mail
        .template_body
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| Failure::permanent("the clinic has no template for this message"))?;
    let text = fill(
        mail.kind.as_str(),
        body,
        &AutoValues {
            clinic_name: mail.clinic_name,
            portal_host: mail.portal_host,
            variables: mail.variables,
            secret: mail.secret,
            links: portal,
        },
    )?;
    let subject = match mail.kind {
        MessageKind::Welcome => format!("Welcome to {}", mail.clinic_name),
        MessageKind::VisitSummary => format!("Your visit summary from {}", mail.clinic_name),
        MessageKind::VisitSummaryPin => "Your PIN for the visit summary".to_owned(),
        _ => format!("Time to book your follow-up at {}", mail.clinic_name),
    };
    Ok((subject, vec![text]))
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
            template_body: None,
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

    #[test]
    fn automatic_messages_carry_links_a_date_and_a_pin_only() {
        let links = PortalLinks::default();
        let none = json!({});
        let summary = PatientMail {
            template_body: Some("Thanks {{clinic_name}}! {{share_link}} ."),
            secret: Some("t0ken"),
            ..mail(MessageKind::VisitSummary, "visit.summary", &none)
        };
        let email = render(&summary, &links).unwrap();
        assert!(
            email
                .text
                .contains("https://alpha.localtest.me/shared/t0ken")
        );
        assert!(!email.subject.contains("t0ken"));
        let pin = PatientMail {
            template_body: Some("PIN {{pin}} 🔒"),
            secret: Some("482913"),
            ..mail(MessageKind::VisitSummaryPin, "visit.summary_pin", &none)
        };
        assert!(render(&pin, &links).unwrap().text.contains("PIN 482913"));
        let due = json!({ "due_on": "12 November 2026" });
        let follow_up = PatientMail {
            template_body: Some("Due {{due_on}}: {{booking_link}} ."),
            ..mail(
                MessageKind::FollowUpBooking,
                "visit.follow_up_booking",
                &due,
            )
        };
        let text = render(&follow_up, &links).unwrap().text;
        assert!(text.contains("Due 12 November 2026: https://alpha.localtest.me/book"));
        // The welcome's website falls back to the portal home.
        let welcome = PatientMail {
            template_body: Some("{{app_link}} {{website_link}}"),
            ..mail(MessageKind::Welcome, "patient.welcome", &none)
        };
        let text = render(&welcome, &links).unwrap().text;
        assert!(text.contains("https://alpha.localtest.me/ https://alpha.localtest.me/"));
    }

    #[test]
    fn automatic_messages_refuse_what_a_template_may_not_name_or_cannot_fill() {
        let links = PortalLinks::default();
        let none = json!({});
        let name = PatientMail {
            template_body: Some("Hello {{patient_name}}"),
            ..mail(MessageKind::Welcome, "patient.welcome", &none)
        };
        assert!(render(&name, &links).is_err());
        let no_secret = PatientMail {
            template_body: Some("{{share_link}}"),
            ..mail(MessageKind::VisitSummary, "visit.summary", &none)
        };
        assert!(render(&no_secret, &links).is_err());
        let no_template = mail(MessageKind::Welcome, "patient.welcome", &none);
        assert!(render(&no_template, &links).is_err());
    }
}
