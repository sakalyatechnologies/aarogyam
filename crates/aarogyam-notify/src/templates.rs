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
}

impl fmt::Debug for Email {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Email").finish_non_exhaustive()
    }
}

fn field<'a>(payload: &'a Value, key: &'static str) -> Result<&'a str, Failure> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| Failure::permanent(format!("payload lacks {key}")))
}

/// Escapes text for HTML.
fn escape(text: &str) -> String {
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
            })
        }
        None => Err(Failure::permanent("unknown message kind")),
    }
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
}
