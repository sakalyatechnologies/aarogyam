//! Message templates: what each kind of message says.

use std::fmt;

use aarogyam_dal::outbox::Claimed;
use aarogyam_domain::outbox::MessageKind;
use serde_json::Value;

use crate::{Failure, NotifyError};

/// Where links in messages point: the clinic portal at `https://<host>` in deployed
/// environments, or a pattern such as `http://{host}:5173` for the local portal.
#[derive(Debug, Clone)]
pub struct PortalLinks {
    pattern: String,
}

impl PortalLinks {
    /// Links from a pattern containing `{host}`, such as `https://{host}`.
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] unless the pattern is an http(s) origin with `{host}`.
    pub fn new(pattern: &str) -> Result<Self, NotifyError> {
        let pattern = pattern.trim().trim_end_matches('/');
        let scheme_ok = pattern.starts_with("https://") || pattern.starts_with("http://");
        if !scheme_ok || !pattern.contains("{host}") {
            return Err(NotifyError::Configuration(
                "the portal link pattern must look like https://{host}",
            ));
        }
        Ok(Self {
            pattern: pattern.to_owned(),
        })
    }

    /// The link that accepts an invitation. The token rides in the fragment, which browsers
    /// never send to servers or keep in referrers.
    #[must_use]
    pub fn invite(&self, host: &str, token: &str) -> String {
        format!("{}/invite#{token}", self.pattern.replace("{host}", host))
    }

    /// The clinic's public booking page.
    #[must_use]
    pub fn book(&self, host: &str) -> String {
        format!("{}/book", self.pattern.replace("{host}", host))
    }

    /// The page where a patient opens a shared prescription with its PIN.
    #[must_use]
    pub fn shared(&self, host: &str, token: &str) -> String {
        format!("{}/shared/{token}", self.pattern.replace("{host}", host))
    }

    /// The one-click unsubscribe address for a reminder or promotional email: the API's public
    /// route on the clinic's host. The token is opaque and names no patient.
    #[must_use]
    pub fn unsubscribe(&self, host: &str, token: &str) -> String {
        format!(
            "{}/api/v1/public/unsubscribe/{token}",
            self.pattern.replace("{host}", host)
        )
    }

    /// The public page that verifies an issued prescription (its QR code points here).
    #[must_use]
    pub fn verify(&self, host: &str, token: &str) -> String {
        format!(
            "{}/verify/prescriptions/{token}",
            self.pattern.replace("{host}", host)
        )
    }
}

impl Default for PortalLinks {
    fn default() -> Self {
        Self {
            pattern: "https://{host}".to_owned(),
        }
    }
}

/// A rendered email. Its `Debug` shows no content: bodies carry links with secrets.
#[derive(Clone, PartialEq, Eq)]
pub struct Email {
    /// The recipient.
    pub to: String,
    /// Subject line.
    pub subject: String,
    /// Plain-text body.
    pub text: String,
    /// HTML body.
    pub html: String,
    /// The one-click unsubscribe link for the `List-Unsubscribe` header (RFC 8058), on
    /// reminders and promotional email.
    pub list_unsubscribe: Option<String>,
}

impl fmt::Debug for Email {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Email").finish_non_exhaustive()
    }
}

pub(crate) fn field<'a>(payload: &'a Value, key: &'static str) -> Result<&'a str, Failure> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| Failure::permanent(format!("payload lacks {key}")))
}

/// Escapes text for HTML.
pub(crate) fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(c),
        }
    }
    escaped
}

/// The email about a booking made on the clinic's public page: the clinic, doctor and time,
/// never the reason for the visit.
fn render_booking(
    kind: MessageKind,
    to: String,
    payload: &Value,
    links: &PortalLinks,
) -> Result<Email, Failure> {
    let clinic = field(payload, "clinic_name")?;
    let doctor = field(payload, "doctor_name")?;
    let when = field(payload, "when")?;
    let host = field(payload, "portal_host")?;
    let doctor = if doctor.starts_with("Dr") {
        doctor.to_owned()
    } else {
        format!("Dr {doctor}")
    };
    let (subject, line) = match kind {
        MessageKind::BookingRequested => (
            format!("Your appointment request at {clinic}"),
            format!(
                "We have your request for {when} with {doctor}. \
                     The clinic will confirm it soon; we will email you again."
            ),
        ),
        MessageKind::BookingConfirmed => (
            format!("Your appointment at {clinic} is confirmed"),
            format!("Your appointment on {when} with {doctor} is confirmed."),
        ),
        _ => (
            format!("Your appointment request at {clinic}"),
            format!(
                "The clinic could not take your request for {when} with {doctor}. \
                     You can choose another time at {}.",
                links.book(host)
            ),
        ),
    };
    let text = format!("{clinic}\n\n{line}");
    let html = format!(
        "<p><strong>{clinic}</strong></p><p>{line}</p>",
        clinic = escape(clinic),
        line = escape(&line),
    );
    Ok(Email {
        to,
        subject,
        text,
        html,
        list_unsubscribe: None,
    })
}

/// The invitation to the patient app: the clinic, the link code and its expiry. No patient name
/// or clinical data; the code links only the record the clinic chose.
fn render_app_invitation(
    to: String,
    payload: &Value,
    code: Option<&str>,
) -> Result<Email, Failure> {
    let clinic = field(payload, "clinic_name")?;
    let expires = field(payload, "expires_on")?;
    let code = code.ok_or_else(|| Failure::permanent("no link code"))?;
    let subject = format!("See your {clinic} records in the Aarogyam app");
    let text = format!(
        "{clinic} has invited you to the Aarogyam patient app, where you can see your \
         appointments, prescriptions and bills, and book your next visit.\n\n\
         1. Install the Aarogyam app and sign in with this email address.\n\
         2. Choose \"Add a clinic\" and enter this code: {code}\n\n\
         The code works once and expires on {expires}. \
         If you weren't expecting this, you can ignore this email."
    );
    let html = format!(
        "<p><strong>{clinic}</strong> has invited you to the Aarogyam patient app, where you can \
         see your appointments, prescriptions and bills, and book your next visit.</p>\
         <ol><li>Install the Aarogyam app and sign in with this email address.</li>\
         <li>Choose \"Add a clinic\" and enter this code: <strong>{code}</strong></li></ol>\
         <p>The code works once and expires on {expires}. \
         If you weren't expecting this, you can ignore this email.</p>",
        clinic = escape(clinic),
        code = escape(code),
        expires = escape(expires),
    );
    Ok(Email {
        to,
        subject,
        text,
        html,
        list_unsubscribe: None,
    })
}

/// Renders a claimed email message.
pub(crate) fn render(message: &Claimed, links: &PortalLinks) -> Result<Email, Failure> {
    let to = message
        .recipient
        .clone()
        .ok_or_else(|| Failure::permanent("no recipient"))?;
    match MessageKind::parse(&message.event_key) {
        Some(MessageKind::StaffInvited) => {
            let clinic = field(&message.payload, "clinic_name")?;
            let role = field(&message.payload, "role_name")?;
            let host = field(&message.payload, "portal_host")?;
            let expires = field(&message.payload, "expires_on")?;
            let token = message
                .secret
                .as_deref()
                .ok_or_else(|| Failure::permanent("no invitation token"))?;
            let link = links.invite(host, token);
            let subject = format!("Join {clinic} on Aarogyam");
            let text = format!(
                "You have been invited to join {clinic} on Aarogyam as {role}.\n\n\
                 Accept the invitation: {link}\n\n\
                 Sign in with this email address. The link works once and expires on {expires}.\n\
                 If you weren't expecting this, you can ignore this email."
            );
            let html = format!(
                "<p>You have been invited to join <strong>{clinic}</strong> on Aarogyam as {role}.</p>\
                 <p><a href=\"{link}\">Accept the invitation</a></p>\
                 <p>Sign in with this email address. The link works once and expires on {expires}.</p>\
                 <p>If you weren't expecting this, you can ignore this email.</p>",
                clinic = escape(clinic),
                role = escape(role),
                link = escape(&link),
                expires = escape(expires),
            );
            Ok(Email {
                to,
                subject,
                text,
                html,
                list_unsubscribe: None,
            })
        }
        Some(MessageKind::PrescriptionShared) => {
            let clinic = field(&message.payload, "clinic_name")?;
            let doctor = field(&message.payload, "doctor_name")?;
            let host = field(&message.payload, "portal_host")?;
            let expires = field(&message.payload, "expires_on")?;
            let token = message
                .secret
                .as_deref()
                .ok_or_else(|| Failure::permanent("no share token"))?;
            let link = links.shared(host, token);
            let doctor = if doctor.starts_with("Dr") {
                doctor.to_owned()
            } else {
                format!("Dr {doctor}")
            };
            let subject = format!("Your prescription from {doctor} is ready");
            let text = format!(
                "{clinic}\n\n\
                 Your prescription from {doctor} is ready.\n\n\
                 Open it: {link}\n\n\
                 Enter the PIN printed on your prescription, or given at the clinic. \
                 The link expires on {expires}."
            );
            let html = format!(
                "<p><strong>{clinic}</strong></p>\
                 <p>Your prescription from {doctor} is ready.</p>\
                 <p><a href=\"{link}\">Open your prescription</a></p>\
                 <p>Enter the PIN printed on your prescription, or given at the clinic. \
                 The link expires on {expires}.</p>",
                clinic = escape(clinic),
                doctor = escape(&doctor),
                link = escape(&link),
                expires = escape(expires),
            );
            Ok(Email {
                to,
                subject,
                text,
                html,
                list_unsubscribe: None,
            })
        }
        Some(MessageKind::PatientAppInvited) => {
            render_app_invitation(to, &message.payload, message.secret.as_deref())
        }
        Some(
            kind @ (MessageKind::BookingRequested
            | MessageKind::BookingConfirmed
            | MessageKind::BookingDeclined),
        ) => render_booking(kind, to, &message.payload, links),
        Some(MessageKind::LabOrderReminder) => crate::lab::render_reminder(to, &message.payload),
        Some(MessageKind::CampaignTest) => render_campaign_test(to, &message.payload),
        // Rendered by the patient message step (`patient_templates`), never from the outbox.
        Some(
            MessageKind::AppointmentReminder
            | MessageKind::ClinicMessage
            | MessageKind::PaymentReceipt,
        )
        | None => Err(Failure::permanent("unknown message kind")),
    }
}

/// A campaign as its recipients will read it, sent to the staff member who asked for a test.
fn render_campaign_test(to: String, payload: &Value) -> Result<Email, Failure> {
    let name = field(payload, "campaign_name")?;
    let offer = field(payload, "offer_text")?;
    let note = "This is a test of your campaign. No patient was sent anything.";
    Ok(Email {
        to,
        subject: format!("[Test] {name}"),
        text: format!("{offer}\n\n{note}"),
        html: format!("<p>{}</p><p><small>{note}</small></p>", escape(offer)),
        list_unsubscribe: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn invitation(payload: Value) -> Claimed {
        Claimed {
            org_id: Uuid::nil(),
            id: Uuid::nil(),
            event_key: "staff.invited".into(),
            channel: "email".into(),
            recipient: Some("ravi@example.in".into()),
            payload,
            secret: Some("tok3n".into()),
            attempts: 1,
        }
    }

    #[test]
    fn invitations_link_to_the_clinic_portal() {
        let message = invitation(json!({
            "clinic_name": "Sunrise <Dental>",
            "role_name": "Doctor",
            "portal_host": "sunrise.localtest.me",
            "expires_on": "10 October 2026",
        }));
        let links = PortalLinks::new("http://{host}:5173/").unwrap();
        let email = render(&message, &links).unwrap();
        assert_eq!(email.to, "ravi@example.in");
        assert_eq!(email.subject, "Join Sunrise <Dental> on Aarogyam");
        assert!(
            email
                .text
                .contains("http://sunrise.localtest.me:5173/invite#tok3n")
        );
        assert!(email.html.contains("Sunrise &lt;Dental&gt;"));
        assert_eq!(format!("{email:?}"), "Email { .. }");
        let deployed = render(&message, &PortalLinks::default()).unwrap();
        assert!(
            deployed
                .text
                .contains("https://sunrise.localtest.me/invite#tok3n")
        );
    }

    #[test]
    fn shared_prescriptions_link_to_the_portal_without_a_pin() {
        let mut message = invitation(json!({
            "clinic_name": "Sunrise",
            "doctor_name": "Ravi Rao",
            "portal_host": "sunrise.localtest.me",
            "expires_on": "10 October 2026",
        }));
        message.event_key = "prescription.shared".into();
        let email = render(&message, &PortalLinks::default()).unwrap();
        assert_eq!(email.subject, "Your prescription from Dr Ravi Rao is ready");
        assert!(
            email
                .text
                .contains("https://sunrise.localtest.me/shared/tok3n")
        );
        assert!(email.text.contains("PIN printed on your prescription"));
        assert!(email.html.contains("10 October 2026"));
    }

    #[test]
    fn booking_emails_carry_no_reason_and_no_links_with_secrets() {
        let mut message = invitation(json!({
            "clinic_name": "Sunrise",
            "doctor_name": "Ravi Rao",
            "portal_host": "sunrise.localtest.me",
            "when": "5 October 2026, 10:30",
        }));
        message.secret = None;
        message.event_key = "booking.requested".into();
        let email = render(&message, &PortalLinks::default()).unwrap();
        assert_eq!(email.subject, "Your appointment request at Sunrise");
        assert!(
            email
                .text
                .contains("5 October 2026, 10:30 with Dr Ravi Rao")
        );
        message.event_key = "booking.confirmed".into();
        let email = render(&message, &PortalLinks::default()).unwrap();
        assert!(email.subject.ends_with("is confirmed"));
        message.event_key = "booking.declined".into();
        let email = render(&message, &PortalLinks::default()).unwrap();
        assert!(email.text.contains("https://sunrise.localtest.me/book"));
    }

    #[test]
    fn app_invitations_carry_the_code_and_no_patient_details() {
        let message = Claimed {
            event_key: "patient_app.invited".into(),
            secret: Some("7KQ2M-X9D4T".into()),
            payload: json!({
                "clinic_name": "Alpha Dental",
                "portal_host": "alpha.localtest.me",
                "expires_on": "2026-10-14",
            }),
            ..invitation(json!({}))
        };
        let email = render(&message, &PortalLinks::default()).unwrap();
        assert_eq!(
            email.subject,
            "See your Alpha Dental records in the Aarogyam app"
        );
        assert!(email.text.contains("7KQ2M-X9D4T"));
        assert!(email.html.contains("<strong>7KQ2M-X9D4T</strong>"));
        assert!(email.text.contains("2026-10-14"));
        let without_code = Claimed {
            secret: None,
            ..message
        };
        assert!(render(&without_code, &PortalLinks::default()).is_err());
    }

    #[test]
    fn broken_messages_are_not_retried() {
        let missing = render(
            &invitation(json!({ "clinic_name": "Sunrise" })),
            &PortalLinks::default(),
        );
        assert!(matches!(
            missing,
            Err(Failure {
                retryable: false,
                ..
            })
        ));
        let mut unknown = invitation(json!({}));
        unknown.event_key = "patient.poked".into();
        assert_eq!(
            render(&unknown, &PortalLinks::default()),
            Err(Failure::permanent("unknown message kind"))
        );
        assert!(PortalLinks::new("ftp://{host}").is_err());
        assert!(PortalLinks::new("https://portal.example").is_err());
    }

    #[test]
    fn a_campaign_test_names_itself_and_escapes_the_offer() {
        let payload = json!({ "campaign_name": "Diwali", "offer_text": "20% off <today>" });
        let email = render_campaign_test("asha@alpha.test".into(), &payload).unwrap();
        assert_eq!(email.subject, "[Test] Diwali");
        assert!(email.text.contains("20% off <today>") && email.text.contains("No patient"));
        assert!(email.html.contains("&lt;today&gt;"));
        assert!(email.list_unsubscribe.is_none());
        assert!(render_campaign_test("a@b.in".into(), &json!({})).is_err());
    }
}
