//! "Send consent to sign": staff send a patient a link; the patient reads the clinic's notice
//! and signs on the clinic's host with no sign-in. The token in the link is the proof.

use aarogyam_app::consent_requests::{self as app, NewConsentRequest, Requested, SignOutcome};
use aarogyam_domain::consent::Purpose;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::require::PatientsWrite;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_id, rfc3339};
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::ApiFailure;

/// What to ask the patient.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct RequestConsent {
    /// The purposes to ask about, each once: `care`, `reminders`, `promotional`, `sharing` or
    /// `research`. `["care"]` when left out.
    #[serde(default)]
    pub purposes: Vec<String>,
    /// The published notice to show (`GET /consent-notices`); the clinic's current notice when
    /// left out.
    pub notice_id: Option<String>,
}

/// A consent request sent to the patient.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsentRequested {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// How the link was sent: `email`.
    pub channel: String,
    /// The purposes asked about.
    pub purposes: Vec<String>,
    /// The label of the notice the patient will read.
    pub notice_version: String,
    /// When the link stops working (RFC 3339).
    pub expires_at: String,
}

impl From<Requested> for ConsentRequested {
    fn from(done: Requested) -> Self {
        Self {
            id: done.id,
            channel: "email".to_owned(),
            purposes: done
                .purposes
                .iter()
                .map(|p| p.as_str().to_owned())
                .collect(),
            notice_version: done.notice_version,
            expires_at: rfc3339(done.expires_at),
        }
    }
}

/// Sends the patient a link to read the clinic's notice and sign, by email through the message
/// queue (a care message, so it goes even before any consent is on record). The link works once
/// for seven days. Needs `patients.write`. Phone-only patients can't be sent one yet.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/consents/request",
    operation_id = "requestPatientConsent",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = RequestConsent,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ConsentRequested),
        (status = 400, description = "An unknown or repeated purpose, or an unknown notice"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic, or out of the role's reach"),
        (status = 409, description = "The patient has no email address, or the clinic has no portal address yet")
    )
)]
pub(crate) async fn request(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RequestConsent>,
) -> Result<(StatusCode, Json<ConsentRequested>), ApiFailure> {
    let purposes = parse_purposes(&body.purposes)?;
    let done = app::request(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        NewConsentRequest {
            purposes,
            notice_id: body
                .notice_id
                .as_deref()
                .map(|text| parse_id("notice_id", text))
                .transpose()?,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ConsentRequested.as_str(), patient_id = %id, "consent requested");
    Ok((StatusCode::CREATED, Json(done.into())))
}

fn parse_purposes(names: &[String]) -> Result<Vec<Purpose>, ApiFailure> {
    names
        .iter()
        .map(|name| Purpose::parse(name).map_err(|_| bad("purposes", "unknown value").into()))
        .collect()
}

/// The notice a link shows.
#[derive(Debug, Serialize, ToSchema)]
pub struct LinkNotice {
    /// The clinic's label for it, such as `v2 2026-11`.
    pub version: String,
    /// The notice text; null when the clinic hasn't published one (show its standard privacy
    /// page).
    pub body: Option<String>,
}

/// What anyone holding a consent link may read: no patient data.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConsentLink {
    /// The clinic's name.
    pub clinic_name: String,
    /// `pending`, `signed` or `expired`.
    pub state: String,
    /// The purposes the clinic asks about.
    pub purposes: Vec<String>,
    /// The notice to read.
    pub notice: LinkNotice,
    /// When the link stops working (RFC 3339).
    pub expires_at: String,
}

/// Reads a consent link on the clinic's host, with no sign-in: the clinic, what it asks and the
/// notice.
#[utoipa::path(
    get,
    path = "/api/v1/public/consents/{token}",
    operation_id = "getConsentLink",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    responses(
        (status = 200, body = ConsentLink),
        (status = 404, description = "No such link")
    )
)]
pub(crate) async fn preview(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath(token): ApiPath<String>,
) -> Result<Json<ConsentLink>, ApiFailure> {
    let link = app::preview(
        state.db(),
        public.clinic_id,
        public.request_id,
        &token,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(ConsentLink {
        clinic_name: link.clinic_name,
        state: link.state.as_str().to_owned(),
        purposes: link
            .purposes
            .iter()
            .map(|p| p.as_str().to_owned())
            .collect(),
        notice: LinkNotice {
            version: link.notice_version,
            body: link.notice_body,
        },
        expires_at: rfc3339(link.expires_at),
    }))
}

/// The patient's answer.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SignConsent {
    /// Must be `true`: the patient has read the notice and agrees.
    pub agree: bool,
    /// Which of the asked purposes they agree to; all of them when left out.
    pub purposes: Option<Vec<String>>,
}

/// What signing recorded.
#[derive(Debug, Serialize, ToSchema)]
pub struct Signed {
    /// The purposes consent was recorded for now (ones already in force are left as they are).
    pub recorded: Vec<String>,
}

/// The patient signs, on the clinic's host with no sign-in: records consent (method `app`)
/// against the notice the link showed and closes the link. Works once.
#[utoipa::path(
    post,
    path = "/api/v1/public/consents/{token}",
    operation_id = "signConsentLink",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    request_body = SignConsent,
    responses(
        (status = 200, body = Signed),
        (status = 400, description = "`agree` is not true, or a purpose the clinic didn't ask about"),
        (status = 404, description = "No such link"),
        (status = 409, description = "Already signed"),
        (status = 410, description = "Expired")
    )
)]
pub(crate) async fn sign(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath(token): ApiPath<String>,
    ApiJson(body): ApiJson<SignConsent>,
) -> Result<Response, ApiFailure> {
    if !body.agree {
        return Err(bad("agree", "must be true to sign").into());
    }
    let chosen = body.purposes.as_deref().map(parse_purposes).transpose()?;
    let outcome = app::sign(
        state.db(),
        public.clinic_id,
        public.request_id,
        &token,
        chosen,
        OffsetDateTime::now_utc(),
    )
    .await?;
    let refuse = |status: StatusCode, code: &str, message: &str| {
        (
            status,
            Json(serde_json::json!({ "error": { "code": code, "message": message } })),
        )
            .into_response()
    };
    Ok(match outcome {
        SignOutcome::Signed(recorded) => {
            tracing::info!(event = Event::ConsentSigned.as_str(), "consent signed");
            Json(Signed {
                recorded: recorded.iter().map(|p| p.as_str().to_owned()).collect(),
            })
            .into_response()
        }
        SignOutcome::AlreadySigned => refuse(
            StatusCode::CONFLICT,
            "already_signed",
            "This consent was already signed.",
        ),
        SignOutcome::Expired => refuse(
            StatusCode::GONE,
            "expired",
            "This link has expired. Ask the clinic for a new one.",
        ),
    })
}
