//! Messages to patients: staff sending one to up to 50 patients, a patient's message list
//! (metadata only) and their contact preferences. Sending queues; the outbox job sends, checking
//! consent, opt-outs and quiet hours when each message is due.

use aarogyam_app::messaging::{self as app, Preference, Send};
use aarogyam_dal::messages::{MessageRow, PreferenceRow};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::messaging::{Category, Channel, Template};
use aarogyam_domain::permission::require::{MessagesSend, PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_id, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A message to send to patients.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SendMessages {
    /// 1 to 50 patients; repeats count once.
    pub patient_ids: Vec<String>,
    /// `email` (`WhatsApp` and SMS come later).
    pub channel: String,
    /// `care.note` (care; needs `body` and `subject`), `reminder.follow_up` (reminders; optional
    /// `due_on`) or `promo.offer` (promotional; needs `body` and `subject`).
    pub template_key: String,
    /// The template's variables, by name; anything else is refused. Values are one line of up
    /// to 120 characters.
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    /// Free text, email only, up to 5000 characters; blank lines separate paragraphs.
    pub body: Option<String>,
    /// Send the same batch id again after a lost answer: nothing is queued twice.
    pub batch_id: Option<String>,
}

/// What sending queued.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessagesQueued {
    /// The batch; send it again to retry safely.
    #[schema(value_type = String)]
    pub batch_id: Uuid,
    /// Patients asked for, without repeats.
    pub requested: usize,
    /// Messages queued now.
    pub queued: i64,
    /// Messages an earlier try of the same batch already queued.
    pub already_queued: i64,
}

/// Queues a message to each patient. Messages go out when the outbox job next runs, after the
/// send-time checks: consent for the template's purpose, opt-outs, quiet hours for reminders and
/// promotional messages, and the provider's daily budget.
#[utoipa::path(
    post,
    path = "/api/v1/messages",
    operation_id = "sendMessages",
    tag = "messages",
    request_body = SendMessages,
    security(("bearer" = [])),
    responses(
        (status = 202, body = MessagesQueued),
        (status = 400, description = "Bad patients, channel, template, variables or body"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks messages.send"),
        (status = 404, description = "A patient isn't in this clinic or out of the role's reach; nothing was queued")
    )
)]
pub(crate) async fn send(
    State(state): State<AppState>,
    Require { request, .. }: Require<MessagesSend>,
    ApiJson(body): ApiJson<SendMessages>,
) -> Result<(StatusCode, Json<MessagesQueued>), ApiFailure> {
    if body.patient_ids.len() > 200 {
        return Err(bad("patient_ids", "give 1 to 50 patients").into());
    }
    let patient_ids = body
        .patient_ids
        .iter()
        .map(|text| parse_id("patient_ids", text).map(PatientId::from_uuid))
        .collect::<Result<Vec<_>, _>>()?;
    let input = Send {
        patient_ids,
        channel: Channel::parse(&body.channel).map_err(|_| bad("channel", "unknown value"))?,
        template: Template::parse(&body.template_key)
            .map_err(|_| bad("template_key", "unknown value"))?,
        variables: body.variables.into_iter().collect(),
        body: body.body,
        batch_id: body
            .batch_id
            .as_deref()
            .map(|text| parse_id("batch_id", text))
            .transpose()?,
    };
    let template = input.template;
    let sent = app::send(state.db(), &request.actor, request.request_id, input).await?;
    tracing::info!(
        event = Event::MessagesQueued.as_str(),
        batch_id = %sent.batch_id,
        template = template.as_str(),
        requested = sent.requested,
        queued = sent.queued,
        "messages queued"
    );
    Ok((
        StatusCode::ACCEPTED,
        Json(MessagesQueued {
            batch_id: sent.batch_id,
            requested: sent.requested,
            queued: sent.queued,
            already_queued: sent.already_queued,
        }),
    ))
}

/// A message as a patient's list shows it: never its text, address or link secret.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessageSummary {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `email`, `whatsapp` or `sms`.
    pub channel: String,
    /// `prescription.shared`, `booking.confirmed`, `appointment.reminder`, `clinic.message`...
    pub kind: String,
    /// The consent purpose it needs: `care`, `reminders` or `promotional`.
    pub purpose: String,
    /// Its template.
    pub template_key: String,
    /// `queued`, `sending`, `sent`, `failed` or `skipped`.
    pub status: String,
    /// Why it was skipped: `no_consent`, `consent_withdrawn`, `opted_out`, `no_address`...
    pub skip_reason: Option<String>,
    /// When it is or was due (RFC 3339).
    pub scheduled_for: String,
    /// When it was handed to the provider (RFC 3339).
    pub sent_at: Option<String>,
    /// What the provider last reported: `delivered`, `bounced`, `complained`...
    pub delivery: Option<String>,
    /// Delivery attempts.
    pub attempts: i32,
    /// When it was queued (RFC 3339).
    pub created_at: String,
}

impl From<MessageRow> for MessageSummary {
    fn from(row: MessageRow) -> Self {
        Self {
            id: row.id,
            channel: row.channel,
            kind: row.kind,
            purpose: row.purpose,
            template_key: row.template_key,
            status: row.status,
            skip_reason: row.skip_reason,
            scheduled_for: rfc3339(row.scheduled_for),
            sent_at: row.sent_at.map(rfc3339),
            delivery: row.delivery,
            attempts: row.attempts,
            created_at: rfc3339(row.created_at),
        }
    }
}

/// A patient's messages, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessageList {
    /// Up to 100 messages.
    pub items: Vec<MessageSummary>,
}

/// The patient's newest messages and what became of them: metadata only.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/messages",
    operation_id = "listPatientMessages",
    tag = "messages",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = MessageList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<MessageList>, ApiFailure> {
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(MessageList {
        items: rows.into_iter().map(MessageSummary::from).collect(),
    }))
}

/// A contact preference to record, on the patient's word.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetContactPreference {
    /// `email`, `whatsapp` or `sms`.
    pub channel: String,
    /// `all`, `care`, `reminders` or `promotional`.
    pub category: String,
    /// True to opt out; false to opt back in.
    pub opted_out: bool,
    /// `WhatsApp` only: whether the patient opted in to `WhatsApp` messages.
    pub whatsapp_opt_in: Option<bool>,
}

/// One of a patient's contact preferences.
#[derive(Debug, Serialize, ToSchema)]
pub struct ContactPreference {
    /// `email`, `whatsapp` or `sms`.
    pub channel: String,
    /// `all`, `care`, `reminders` or `promotional`.
    pub category: String,
    /// Whether the patient opted out.
    pub opted_out: bool,
    /// Since when (RFC 3339).
    pub opted_out_at: Option<String>,
    /// When they opted in to `WhatsApp` (RFC 3339).
    pub whatsapp_opt_in_at: Option<String>,
    /// `staff`, `patient`, `unsubscribe_link`, `bounce`, `complaint` or `stop_keyword`.
    pub source: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
}

impl From<PreferenceRow> for ContactPreference {
    fn from(row: PreferenceRow) -> Self {
        Self {
            channel: row.channel,
            category: row.category,
            opted_out: row.opted_out,
            opted_out_at: row.opted_out_at.map(rfc3339),
            whatsapp_opt_in_at: row.whatsapp_opt_in_at.map(rfc3339),
            source: row.source,
            updated_at: rfc3339(row.updated_at),
        }
    }
}

/// The patient's contact preferences.
#[derive(Debug, Serialize, ToSchema)]
pub struct ContactPreferences {
    /// One per channel and category recorded.
    pub items: Vec<ContactPreference>,
}

/// Records a contact preference: an opt-out of a channel for some or all messages (queued ones
/// it covers are skipped), opting back in, or a `WhatsApp` opt-in. Consent for a purpose is
/// separate (`POST /patients/{id}/consents`).
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/contact-preferences",
    operation_id = "setPatientContactPreference",
    tag = "messages",
    params(("id" = String, Path, description = "The patient")),
    request_body = SetContactPreference,
    security(("bearer" = [])),
    responses(
        (status = 200, body = ContactPreferences),
        (status = 400, description = "An unknown channel or category, or a WhatsApp opt-in on another channel"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach")
    )
)]
pub(crate) async fn set_preference(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SetContactPreference>,
) -> Result<Json<ContactPreferences>, ApiFailure> {
    let preference = Preference {
        channel: Channel::parse(&body.channel).map_err(|_| bad("channel", "unknown value"))?,
        category: Category::parse(&body.category).map_err(|_| bad("category", "unknown value"))?,
        opted_out: body.opted_out,
        whatsapp_opt_in: body.whatsapp_opt_in,
    };
    let rows = app::set_preference(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        preference,
    )
    .await?;
    if preference.opted_out {
        tracing::info!(
            event = Event::ContactOptedOut.as_str(),
            patient_id = %id,
            channel = preference.channel.as_str(),
            category = preference.category.as_str(),
            source = "staff",
            "contact opted out"
        );
    }
    Ok(Json(ContactPreferences {
        items: rows.into_iter().map(ContactPreference::from).collect(),
    }))
}
