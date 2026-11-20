//! The visit summary for the doctor's own `WhatsApp` (docs/plans/visit-story-design.md, C2): the
//! server builds the text and mints the link and PIN; the phone opens `WhatsApp` with it. Nothing
//! is sent from here, and the answer is never logged or cached.

use aarogyam_app::patient_message as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::require::{ClinicalRead, PatientsContact};
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiPath, Edge};
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::RequireBoth;
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

/// Prepares the visit's summary for the doctor's `WhatsApp`: the message, a new visit link (7
/// days; at most three live per visit, the oldest revoked) and its PIN. Nothing is sent.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/patient-message",
    operation_id = "prepareVisitPatientMessage",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = VisitPatientMessage, description = "Prepared; `Cache-Control: no-store`"),
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
) -> Result<Response, ApiFailure> {
    let links = state.notifier().links();
    let url = |host: &str, token: &str| links.shared(host, token);
    let prepared = app::prepare(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        edge.host().as_str(),
        &url,
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
    let mut response = Json(VisitPatientMessage {
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
    .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
