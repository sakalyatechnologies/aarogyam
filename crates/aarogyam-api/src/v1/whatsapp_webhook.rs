//! Meta's `WhatsApp` webhook (docs/whatsapp.md), with no sign-in. `GET` answers the
//! subscription handshake with the verify token; `POST` is checked with `X-Hub-Signature-256`
//! over the raw body and answers 200 at once for every authentic request. It records message
//! statuses, template reviews, and STOP replies. **An inbound message's text is checked for a
//! STOP keyword and dropped: it is never stored, logged or passed on.**

use aarogyam_app::messaging as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::whatsapp::{TemplateStatus, is_stop};
use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use sakalya_http::ApiError;
use serde::Deserialize;
use time::OffsetDateTime;

use crate::AppState;
use crate::failure::ApiFailure;

/// Largest webhook body.
pub(crate) const MAX_BODY: usize = aarogyam_notify::hub_signature::MAX_BODY;

/// The subscription handshake's query.
#[derive(Debug, Deserialize)]
pub(crate) struct Handshake {
    #[serde(rename = "hub.mode")]
    mode: Option<String>,
    #[serde(rename = "hub.verify_token")]
    verify_token: Option<String>,
    #[serde(rename = "hub.challenge")]
    challenge: Option<String>,
}

/// Meta's subscription check: echoes `hub.challenge` when `hub.mode` is `subscribe` and
/// `hub.verify_token` is the configured one.
#[utoipa::path(
    get,
    path = "/api/v1/webhooks/whatsapp",
    operation_id = "whatsappWebhookHandshake",
    tag = "messages",
    params(
        ("hub.mode" = String, Query, description = "`subscribe`"),
        ("hub.verify_token" = String, Query, description = "The configured verify token"),
        ("hub.challenge" = String, Query, description = "Echoed back")
    ),
    responses(
        (status = 200, description = "The challenge, as plain text", body = String),
        (status = 403, description = "Wrong mode or token, or none configured")
    )
)]
pub(crate) async fn handshake(
    State(state): State<AppState>,
    Query(query): Query<Handshake>,
) -> Result<String, ApiFailure> {
    let token = query.verify_token.as_deref().unwrap_or_default();
    match (query.mode.as_deref(), query.challenge) {
        (Some("subscribe"), Some(challenge))
            if challenge.len() <= 200 && state.notifier().whatsapp_verify_token_matches(token) =>
        {
            Ok(challenge)
        }
        _ => Err(ApiError::forbidden("forbidden", "not subscribed").into()),
    }
}

#[derive(Deserialize)]
struct Payload {
    #[serde(default)]
    entry: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(default)]
    changes: Vec<Change>,
}

#[derive(Deserialize)]
struct Change {
    field: String,
    value: serde_json::Value,
}

#[derive(Deserialize, Default)]
struct MessagesValue {
    #[serde(default)]
    statuses: Vec<Status>,
    #[serde(default)]
    messages: Vec<Inbound>,
}

#[derive(Deserialize)]
struct Status {
    id: String,
    #[serde(rename = "status")]
    state: String,
    timestamp: Option<String>,
}

/// An inbound message: only what a STOP check needs. No `Debug`, so it can't be logged.
#[derive(Deserialize)]
struct Inbound {
    from: String,
    context: Option<Context>,
    text: Option<Text>,
    button: Option<Button>,
    interactive: Option<Interactive>,
}

#[derive(Deserialize)]
struct Context {
    id: Option<String>,
}

#[derive(Deserialize)]
struct Text {
    body: String,
}

#[derive(Deserialize)]
struct Button {
    text: Option<String>,
    payload: Option<String>,
}

#[derive(Deserialize)]
struct Interactive {
    button_reply: Option<Reply>,
}

#[derive(Deserialize)]
struct Reply {
    title: Option<String>,
}

#[derive(Deserialize)]
struct TemplateReview {
    event: String,
    message_template_name: String,
    message_template_language: String,
}

impl Inbound {
    /// Whether any text the patient sent or tapped is a STOP keyword.
    fn asks_to_stop(&self) -> bool {
        let texts = [
            self.text.as_ref().map(|text| text.body.as_str()),
            self.button
                .as_ref()
                .and_then(|button| button.text.as_deref()),
            self.button
                .as_ref()
                .and_then(|button| button.payload.as_deref()),
            self.interactive
                .as_ref()
                .and_then(|interactive| interactive.button_reply.as_ref())
                .and_then(|reply| reply.title.as_deref()),
        ];
        texts.into_iter().flatten().any(is_stop)
    }
}

fn review_status(event: &str) -> Option<TemplateStatus> {
    match event {
        "APPROVED" => Some(TemplateStatus::Approved),
        "REJECTED" | "DISABLED" => Some(TemplateStatus::Rejected),
        "PAUSED" | "FLAGGED" => Some(TemplateStatus::Paused),
        _ => None,
    }
}

/// Meta's `WhatsApp` events, signed with the app secret (`X-Hub-Signature-256: sha256=<hex>`
/// over the raw body; 1 MB cap). Records statuses (sent, delivered, read, failed; each once, in
/// any order), template reviews, and STOP replies (the sender opts out of `WhatsApp`); every
/// other inbound message is dropped unread. Answers 200 for every authentic request.
#[utoipa::path(
    post,
    path = "/api/v1/webhooks/whatsapp",
    operation_id = "whatsappWebhook",
    tag = "messages",
    responses(
        (status = 200, description = "Accepted"),
        (status = 400, description = "Authentic but not a WhatsApp event"),
        (status = 401, description = "The signature is missing or wrong, or no app secret is configured"),
        (status = 413, description = "The body is too large")
    )
)]
pub(crate) async fn receive(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiFailure> {
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    state
        .notifier()
        .verify_whatsapp_webhook(signature, &body)
        .map_err(|_| ApiError::unauthenticated())?;
    let payload: Payload = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("invalid_request", "not a WhatsApp event"))?;
    let now = OffsetDateTime::now_utc();
    let (mut statuses, mut stops, mut reviews) = (0_usize, 0_i32, 0_i32);
    for change in payload.entry.into_iter().flat_map(|entry| entry.changes) {
        match change.field.as_str() {
            "messages" => {
                let value: MessagesValue = serde_json::from_value(change.value).unwrap_or_default();
                for status in value.statuses {
                    let at = status
                        .timestamp
                        .as_deref()
                        .and_then(|text| text.parse::<i64>().ok())
                        .and_then(|seconds| OffsetDateTime::from_unix_timestamp(seconds).ok())
                        .unwrap_or(now);
                    app::whatsapp_status(state.db(), &status.id, &status.state, at).await?;
                    statuses += 1;
                }
                for inbound in value.messages {
                    if inbound.asks_to_stop() {
                        let context = inbound.context.as_ref().and_then(|c| c.id.as_deref());
                        stops += app::whatsapp_stop(state.db(), &inbound.from, context).await?;
                    }
                    // Dropped here: the text goes nowhere.
                }
            }
            "message_template_status_update" => {
                let Ok(review) = serde_json::from_value::<TemplateReview>(change.value) else {
                    continue;
                };
                if let Some(status) = review_status(&review.event) {
                    reviews += app::whatsapp_template_reviewed(
                        state.db(),
                        &review.message_template_name,
                        &review.message_template_language,
                        status,
                    )
                    .await?;
                }
            }
            _ => {}
        }
    }
    if stops > 0 {
        tracing::info!(
            event = Event::ContactOptedOut.as_str(),
            source = "stop_keyword",
            clinics = stops,
            "contact opted out"
        );
    }
    tracing::info!(
        event = Event::MessageEventReceived.as_str(),
        provider = "meta",
        statuses,
        reviews,
        "provider event received"
    );
    Ok(StatusCode::OK)
}
