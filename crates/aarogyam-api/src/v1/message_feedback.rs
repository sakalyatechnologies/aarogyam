//! What comes back about patient messages, with no sign-in: the one-click unsubscribe link in
//! reminders and promotional email, and Resend's delivery webhook. Neither reveals anything
//! about a patient: the unsubscribe token is opaque and random (stored hashed), and the webhook
//! answers only whether it was accepted.

use aarogyam_app::messaging::{self as app, ProviderEvent};
use aarogyam_domain::event::Event;
use aarogyam_notify::svix::SvixHeaders;
use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use sakalya_http::{ApiError, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use utoipa::ToSchema;

use crate::AppState;
use crate::failure::ApiFailure;

/// Largest unsubscribe request body (mail apps send `List-Unsubscribe=One-Click`).
pub(crate) const MAX_UNSUBSCRIBE_BODY: usize = 1024;
/// Largest webhook body.
pub(crate) const MAX_WEBHOOK_BODY: usize = aarogyam_notify::svix::MAX_BODY;

/// The answer to an unsubscribe: nothing about who was unsubscribed.
#[derive(Debug, Serialize, ToSchema)]
pub struct Unsubscribed {
    /// Always true.
    pub unsubscribed: bool,
}

/// One-click unsubscribe (RFC 8058) from a reminder or promotional email: the patient stops
/// getting email of that kind from the clinic. Safe to repeat.
#[utoipa::path(
    post,
    path = "/api/v1/public/unsubscribe/{token}",
    operation_id = "unsubscribe",
    tag = "messages",
    params(("token" = String, Path, description = "The opaque token from the email")),
    responses(
        (status = 200, body = Unsubscribed),
        (status = 404, description = "The link is not valid")
    )
)]
pub(crate) async fn unsubscribe(
    State(state): State<AppState>,
    ApiPath(token): ApiPath<String>,
) -> Result<Json<Unsubscribed>, ApiFailure> {
    if !app::unsubscribe(state.db(), &token).await? {
        return Err(ApiError::not_found("not_found", "this link is not valid").into());
    }
    tracing::info!(
        event = Event::ContactOptedOut.as_str(),
        source = "unsubscribe_link",
        "contact opted out"
    );
    Ok(Json(Unsubscribed { unsubscribed: true }))
}

/// The part of a Resend webhook event that is kept: its type, time and the email's id.
#[derive(Debug, Deserialize)]
struct ResendEvent {
    #[serde(rename = "type")]
    kind: String,
    created_at: Option<String>,
    data: ResendData,
}

#[derive(Debug, Deserialize)]
struct ResendData {
    email_id: Option<String>,
}

/// Our name for a Resend event type; `None` for types that aren't kept.
fn event_kind(resend_type: &str) -> Option<&'static str> {
    Some(match resend_type {
        "email.sent" => "sent",
        "email.delivered" => "delivered",
        "email.delivery_delayed" => "delayed",
        "email.bounced" => "bounced",
        "email.complained" => "complained",
        "email.failed" => "failed",
        "email.opened" => "opened",
        "email.clicked" => "clicked",
        _ => return None,
    })
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> &'a str {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}

/// Resend's delivery events, signed by Svix (`svix-id`, `svix-timestamp`, `svix-signature` over
/// the raw body; five minutes' tolerance). A bounce or complaint opts the patient out of email.
/// Each event counts once, in any order. Answers 200 quickly for every authentic event, including
/// ones about email this table doesn't hold (staff email).
#[utoipa::path(
    post,
    path = "/api/v1/webhooks/resend",
    operation_id = "resendWebhook",
    tag = "messages",
    responses(
        (status = 200, description = "Accepted"),
        (status = 400, description = "Authentic but not a Resend event"),
        (status = 401, description = "The signature is missing, wrong or too old"),
        (status = 413, description = "The body is too large")
    )
)]
pub(crate) async fn resend_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiFailure> {
    let now = OffsetDateTime::now_utc();
    let svix = SvixHeaders {
        id: header(&headers, "svix-id"),
        timestamp: header(&headers, "svix-timestamp"),
        signature: header(&headers, "svix-signature"),
    };
    state
        .notifier()
        .verify_resend_webhook(svix, &body, now)
        .map_err(|_| ApiError::unauthenticated())?;
    let event: ResendEvent = serde_json::from_slice(&body)
        .map_err(|_| ApiError::bad_request("invalid_request", "not a Resend event"))?;
    let (Some(kind), Some(email_id)) = (event_kind(&event.kind), event.data.email_id.as_deref())
    else {
        return Ok(StatusCode::OK);
    };
    let occurred_at = event
        .created_at
        .as_deref()
        .and_then(|text| OffsetDateTime::parse(text, &Rfc3339).ok())
        .unwrap_or(now);
    let outcome = app::provider_event(
        state.db(),
        &ProviderEvent {
            provider: "resend",
            provider_message_id: email_id,
            event_id: svix.id,
            kind,
            occurred_at,
        },
    )
    .await?;
    tracing::info!(
        event = Event::MessageEventReceived.as_str(),
        provider = "resend",
        kind,
        outcome = %outcome,
        "provider event received"
    );
    Ok(StatusCode::OK)
}
