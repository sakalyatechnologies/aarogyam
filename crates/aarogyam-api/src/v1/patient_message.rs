//! The visit summary for the doctor's own `WhatsApp` (docs/plans/visit-story-design.md, C2): the
//! server builds the text and mints the link and PIN; the phone opens `WhatsApp` with it. Nothing
//! is sent from here, and the answer is never logged or cached. The Done screen's ticks, live
//! preview, per-doctor defaults and hand-off count are in docs/plans/visit-story-v2-offers-design.md
//! §1.6.

use aarogyam_app::patient_message as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::require::{ClinicalRead, PatientsContact};
use aarogyam_domain::visit_message::SectionSet;
use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath, Edge};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::{Require, RequireBoth};
use crate::failure::ApiFailure;

/// A visit summary prepared for the doctor to send from their own `WhatsApp`. Keep it in memory
/// only: never store, log or queue it. Prepared is not sent: the doctor presses Send. (Named
/// apart from `PatientMessage`, the prescription's emailed-copy outcome.)
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitPatientMessage {
    /// The number to open `WhatsApp` with, in E.164.
    pub phone_e164: String,
    /// The full message, with `WhatsApp` formatting (about 1,600 characters at most): for
    /// phones and for copying.
    pub text: String,
    /// Greeting, link, PIN and the don't-forward line only, with no clinical words: for
    /// hand-offs that travel in a web URL (`wa.me`).
    pub short_text: String,
    /// The message for desktop `whatsapp://send` links: the full message without emoji, cut so
    /// the URL-encoded link stays within 2,000 characters. Null when it can't fit (copy `text`
    /// instead). Older servers don't send it.
    pub desktop_text: Option<String>,
    /// The visit page: `/shared/{token}` on the clinic's portal.
    pub url: String,
    /// The link's six-digit PIN.
    pub pin: String,
    /// When the link stops working.
    pub expires_at: String,
    /// When the automatic summary was sent (or queued) for this visit, if it was: the button
    /// then reads "Send again".
    pub auto_sent_at: Option<String>,
    /// Who it goes to: `patient`, or `guardian` (a minor's guardian or parent, or an adult's
    /// primary contact).
    pub recipient: String,
}

/// The doctor's ticks for a visit summary. Section names: `done`, `detail`, `found`, `plan`,
/// `medicines`, `care`, `offer`, `video`; more may come, and an unknown name is a 400.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct NewPatientMessage {
    /// The ticked sections. Absent means every section.
    #[serde(default)]
    pub sections: Option<Vec<String>>,
}

impl NewPatientMessage {
    fn sections(&self) -> Result<Option<SectionSet>, ApiFailure> {
        Ok(self
            .sections
            .as_deref()
            .map(app::parse_sections)
            .transpose()?)
    }
}

/// The summary as Send would build it, with a stand-in link (`/shared/` and 43 × `x`) and PIN
/// `XXXXXX` as long as real ones. Nothing was minted or saved.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessagePreview {
    /// The full message with the stand-ins; grey them out in the preview.
    pub text: String,
}

/// A summary was handed to `WhatsApp` (not "sent": the doctor presses Send there).
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct HandOff {
    /// The message template's version the client used, 1 to 40 characters.
    #[serde(default)]
    pub template_version: Option<String>,
}

/// The caller's message defaults in this clinic and their hand-off count. No auto-send fields
/// yet.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessagePrefs {
    /// The sections ticked by default (every one until saved).
    pub sections: Vec<String>,
    /// Summaries handed to `WhatsApp`.
    pub handoffs: u32,
    /// Clinic days with at least one hand-off.
    pub handoff_days: u32,
    /// The clinic day of the last hand-off (`YYYY-MM-DD`).
    pub last_handoff_on: Option<String>,
}

impl From<app::MessagePrefs> for MessagePrefs {
    fn from(prefs: app::MessagePrefs) -> Self {
        Self {
            sections: prefs
                .sections
                .names()
                .into_iter()
                .map(str::to_owned)
                .collect(),
            handoffs: prefs.handoffs,
            handoff_days: prefs.handoff_days,
            last_handoff_on: prefs.last_handoff_on.map(|day| day.to_string()),
        }
    }
}

/// New default ticks.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewMessagePrefs {
    /// The sections to tick by default; an unknown name is a 400.
    pub sections: Vec<String>,
}

/// Send's optional body: none (empty, or no `Content-Type`) keeps the old behaviour, every
/// section.
fn optional_body(headers: &HeaderMap, body: &Bytes) -> Result<NewPatientMessage, ApiFailure> {
    if body.iter().all(u8::is_ascii_whitespace) || !headers.contains_key(header::CONTENT_TYPE) {
        return Ok(NewPatientMessage::default());
    }
    serde_json::from_slice(body).map_err(|_| {
        ApiFailure::Error(ApiError::bad_request(
            "invalid_request",
            "the body must be JSON with an optional sections list",
        ))
    })
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// Prepares the visit's summary for the doctor's `WhatsApp`: the message, a new visit link (7
/// days; at most three live per visit, the oldest revoked) and its PIN. Nothing is sent. The
/// optional body's `sections` limit the text to the ticked ones and become the caller's
/// defaults; with no body (or no `Content-Type`) the text has every section.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/patient-message",
    operation_id = "prepareVisitPatientMessage",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body(content = Option<NewPatientMessage>, description = "Optional: the ticked sections"),
    security(("bearer" = [])),
    responses(
        (status = 200, body = VisitPatientMessage, description = "Prepared; `Cache-Control: no-store`"),
        (status = 400, description = "Not JSON, or an unknown section"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read or patients.contact"),
        (status = 404, description = "No such visit in this clinic, or the patient was erased"),
        (status = 409, description = "`visit_open`, `no_phone`, `no_consent` or `opted_out`")
    )
)]
pub(crate) async fn prepare(
    State(state): State<AppState>,
    RequireBoth { request, .. }: RequireBoth<ClinicalRead, PatientsContact>,
    edge: Edge,
    ApiPath(id): ApiPath<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, ApiFailure> {
    let sections = optional_body(&headers, &body)?.sections()?;
    let links = state.notifier().links();
    let url = |host: &str, token: &str| links.shared(host, token);
    let prepared = app::prepare(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        edge.host().as_str(),
        &url,
        sections,
        OffsetDateTime::now_utc(),
    )
    .await?;
    // IDs only: never the text, the PIN or the number.
    tracing::info!(
        event = Event::VisitSummaryPrepared.as_str(),
        visit_id = %id,
        share_link_id = %prepared.link_id.uuid(),
        "visit summary prepared"
    );
    Ok(no_store(
        Json(VisitPatientMessage {
            phone_e164: prepared.phone.as_e164().to_owned(),
            text: prepared.text,
            short_text: prepared.short_text,
            desktop_text: prepared.desktop_text,
            url: prepared.url,
            pin: prepared.pin,
            expires_at: rfc3339(prepared.expires_at),
            auto_sent_at: prepared.auto_sent_at.map(rfc3339),
            recipient: prepared.recipient.as_str().to_owned(),
        })
        .into_response(),
    ))
}

/// The summary as Send would build it with these ticks, for the Done screen's live preview. It
/// mints, revokes and saves nothing; the link and PIN are stand-ins of the same length.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/patient-message/preview",
    operation_id = "previewVisitPatientMessage",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = NewPatientMessage,
    security(("bearer" = [])),
    responses(
        (status = 200, body = MessagePreview, description = "The text; `Cache-Control: no-store`"),
        (status = 400, description = "An unknown section"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read or patients.contact"),
        (status = 404, description = "No such visit in this clinic, or the patient was erased"),
        (status = 409, description = "`visit_open`, `no_phone`, `no_consent` or `opted_out`")
    )
)]
pub(crate) async fn preview(
    State(state): State<AppState>,
    RequireBoth { request, .. }: RequireBoth<ClinicalRead, PatientsContact>,
    edge: Edge,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewPatientMessage>,
) -> Result<Response, ApiFailure> {
    let sections = body.sections()?.unwrap_or_default();
    let links = state.notifier().links();
    let url = |host: &str, token: &str| links.shared(host, token);
    let text = app::preview(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        edge.host().as_str(),
        &url,
        sections,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(no_store(Json(MessagePreview { text }).into_response()))
}

/// Counts that the caller handed the visit's summary to `WhatsApp`. It means "handed off",
/// never "sent".
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/patient-message/handed-off",
    operation_id = "handOffVisitPatientMessage",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = HandOff,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Counted"),
        (status = 400, description = "`template_version` is blank or longer than 40 characters"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read or patients.contact"),
        (status = 404, description = "No such visit in this clinic")
    )
)]
pub(crate) async fn handed_off(
    State(state): State<AppState>,
    RequireBoth { request, .. }: RequireBoth<ClinicalRead, PatientsContact>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<HandOff>,
) -> Result<StatusCode, ApiFailure> {
    app::handed_off(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        body.template_version.as_deref(),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The caller's message defaults in this clinic and their hand-off count.
#[utoipa::path(
    get,
    path = "/api/v1/me/message-prefs",
    operation_id = "getMessagePrefs",
    tag = "clinical",
    security(("bearer" = [])),
    responses(
        (status = 200, body = MessagePrefs, description = "Every section until saved"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read")
    )
)]
pub(crate) async fn prefs(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
) -> Result<Json<MessagePrefs>, ApiFailure> {
    let prefs = app::prefs(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(prefs.into()))
}

/// Saves the caller's default ticks in this clinic.
#[utoipa::path(
    put,
    path = "/api/v1/me/message-prefs",
    operation_id = "saveMessagePrefs",
    tag = "clinical",
    request_body = NewMessagePrefs,
    security(("bearer" = [])),
    responses(
        (status = 200, body = MessagePrefs, description = "Saved"),
        (status = 400, description = "An unknown section"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read, or Sakalya support")
    )
)]
pub(crate) async fn save_prefs(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiJson(body): ApiJson<NewMessagePrefs>,
) -> Result<Json<MessagePrefs>, ApiFailure> {
    let sections = app::parse_sections(&body.sections)?;
    let prefs = app::save_prefs(state.db(), &request.actor, request.request_id, sections).await?;
    Ok(Json(prefs.into()))
}
