//! `WhatsApp` through Meta's Cloud API: `POST {graph}/{phone_number_id}/messages` with
//! `type=template`, the approved template's name and language, and its body parameters in order.
//! Free text is never sent. Errors are classified by `aarogyam_domain::whatsapp::classify`.

use std::time::Duration;

use aarogyam_domain::whatsapp::{MetaOutcome, TemplateCategory, classify, meta_language};
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::NotifyError;

/// Meta's Graph API, at the version this was written against.
pub const GRAPH: &str = "https://graph.facebook.com/v21.0";
const TIMEOUT: Duration = Duration::from_secs(10);

/// What a message costs per category, in paise (configured; Meta's rate card changes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Costs {
    /// A marketing template.
    pub marketing: i64,
    /// A utility template.
    pub utility: i64,
    /// An authentication template.
    pub authentication: i64,
}

impl Default for Costs {
    /// India's rates as of mid-2025, rounded up to whole paise.
    fn default() -> Self {
        Self {
            marketing: 88,
            utility: 13,
            authentication: 13,
        }
    }
}

impl Costs {
    /// The cost of one message of `category`.
    #[must_use]
    pub const fn of(self, category: TemplateCategory) -> i64 {
        match category {
            TemplateCategory::Marketing => self.marketing,
            TemplateCategory::Utility => self.utility,
            TemplateCategory::Authentication => self.authentication,
        }
    }
}

/// A Cloud API client for one phone number.
pub struct Meta {
    client: reqwest::Client,
    graph: String,
    access_token: SecretString,
    phone_number_id: String,
}

impl std::fmt::Debug for Meta {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Meta").finish_non_exhaustive()
    }
}

/// One template send.
#[derive(Debug)]
pub(crate) struct TemplateSend<'a> {
    /// The patient's number, E.164.
    pub(crate) to: &'a str,
    /// The template's name at Meta.
    pub(crate) name: &'a str,
    /// Our language (`en-IN`).
    pub(crate) language: &'a str,
    /// The body parameters, in order.
    pub(crate) parameters: Vec<String>,
}

/// Why a send didn't go: Meta's verdict and a short reason (no content, no number).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MetaFailure {
    pub(crate) outcome: MetaOutcome,
    pub(crate) reason: String,
}

#[derive(Deserialize)]
struct Sent {
    messages: Vec<SentMessage>,
}

#[derive(Deserialize)]
struct SentMessage {
    id: String,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: MetaError,
}

#[derive(Deserialize)]
struct MetaError {
    code: Option<i64>,
}

/// The request body Meta expects.
pub(crate) fn request(send: &TemplateSend<'_>) -> Value {
    let parameters: Vec<Value> = send
        .parameters
        .iter()
        .map(|text| json!({ "type": "text", "text": text }))
        .collect();
    let mut template = json!({
        "name": send.name,
        "language": { "code": meta_language(send.language) },
    });
    if !parameters.is_empty() {
        template["components"] = json!([{ "type": "body", "parameters": parameters }]);
    }
    json!({
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": send.to.trim_start_matches('+'),
        "type": "template",
        "template": template,
    })
}

/// Reads Meta's answer: the message id (`wamid...`), or why it failed.
pub(crate) fn read_answer(status: u16, body: &[u8]) -> Result<String, MetaFailure> {
    if (200..300).contains(&status) {
        let sent: Sent = serde_json::from_slice(body).map_err(|_| MetaFailure {
            outcome: MetaOutcome::Fail,
            reason: "meta answered without an id".to_owned(),
        })?;
        return sent
            .messages
            .into_iter()
            .next()
            .map(|m| m.id)
            .ok_or(MetaFailure {
                outcome: MetaOutcome::Fail,
                reason: "meta answered without an id".to_owned(),
            });
    }
    let code = serde_json::from_slice::<ErrorBody>(body)
        .ok()
        .and_then(|error| error.error.code);
    Err(MetaFailure {
        outcome: classify(status, code),
        reason: match code {
            Some(code) => format!("meta answered {status}, error {code}"),
            None => format!("meta answered {status}"),
        },
    })
}

impl Meta {
    /// A client for `phone_number_id`, at `graph` (Meta's, or a fake one in tests).
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] when the number id is empty or the HTTP client can't be
    /// built.
    pub fn new(
        access_token: SecretString,
        phone_number_id: &str,
        graph: &str,
    ) -> Result<Self, NotifyError> {
        let phone_number_id = phone_number_id.trim();
        if phone_number_id.is_empty() || !phone_number_id.chars().all(|c| c.is_ascii_digit()) {
            return Err(NotifyError::Configuration(
                "whatsapp.phone_number_id must be Meta's numeric id",
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .map_err(|_| NotifyError::Configuration("could not build the HTTP client"))?;
        Ok(Self {
            client,
            graph: graph.trim_end_matches('/').to_owned(),
            access_token,
            phone_number_id: phone_number_id.to_owned(),
        })
    }

    /// Sends a template; Meta's message id on success.
    pub(crate) async fn send(&self, send: &TemplateSend<'_>) -> Result<String, MetaFailure> {
        let url = format!("{}/{}/messages", self.graph, self.phone_number_id);
        let response = self
            .client
            .post(url)
            .bearer_auth(self.access_token.expose_secret())
            .json(&request(send))
            .send()
            .await
            .map_err(|_| MetaFailure {
                outcome: MetaOutcome::Retry,
                reason: "meta unreachable".to_owned(),
            })?;
        let status = response.status().as_u16();
        let body = response.bytes().await.unwrap_or_default();
        read_answer(status, &body)
    }
}

#[cfg(test)]
mod tests {
    use aarogyam_domain::messaging::SkipReason;

    use super::*;

    #[test]
    fn requests_carry_the_template_and_its_parameters_only() {
        let body = request(&TemplateSend {
            to: "+919876543210",
            name: "aro_offer_v1",
            language: "hi-IN",
            parameters: vec!["Alpha Dental".into(), "Free check-up".into()],
        });
        assert_eq!(body["to"], "919876543210");
        assert_eq!(body["type"], "template");
        assert_eq!(body["template"]["language"]["code"], "hi");
        assert_eq!(
            body["template"]["components"][0]["parameters"][1]["text"],
            "Free check-up"
        );
        assert!(body.get("text").is_none());
    }

    /// Answers recorded from Meta's documentation.
    #[test]
    fn answers_give_the_id_or_a_verdict() {
        let ok = br#"{"messaging_product":"whatsapp","contacts":[{"input":"919876543210","wa_id":"919876543210"}],"messages":[{"id":"wamid.HBgLOTE5ODc2NTQzMjEwFQIAERgSQ0Q1"}]}"#;
        assert_eq!(
            read_answer(200, ok).unwrap(),
            "wamid.HBgLOTE5ODc2NTQzMjEwFQIAERgSQ0Q1"
        );
        let limit = br#"{"error":{"message":"(#131049) This message was not delivered to maintain healthy ecosystem engagement.","type":"OAuthException","code":131049,"fbtrace_id":"AbC"}}"#;
        assert_eq!(
            read_answer(400, limit).unwrap_err().outcome,
            MetaOutcome::Skip(SkipReason::MarketingLimit)
        );
        let paused = br#"{"error":{"message":"(#132015) Template is paused","code":132015}}"#;
        assert_eq!(
            read_answer(400, paused).unwrap_err().outcome,
            MetaOutcome::Skip(SkipReason::TemplatePaused)
        );
        let busy = read_answer(503, b"<html>").unwrap_err();
        assert_eq!(busy.outcome, MetaOutcome::Retry);
        assert_eq!(busy.reason, "meta answered 503");
        let token = br#"{"error":{"message":"Invalid OAuth access token.","code":190}}"#;
        assert_eq!(
            read_answer(401, token).unwrap_err().outcome,
            MetaOutcome::Fail
        );
        assert_eq!(Costs::default().of(TemplateCategory::Marketing), 88);
    }
}
