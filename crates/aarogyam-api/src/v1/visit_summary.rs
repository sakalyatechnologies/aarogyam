//! A visit summary the patient opens with a link: the clinic makes one for a visit; the patient
//! opens it on the clinic's host with the PIN. It shows why they came, the treatments done, the
//! plan, the medicines, care at home, the follow-up date, the clinic's phone and where to book;
//! never notes, images or other staff.

use aarogyam_app::error::AppError;
use aarogyam_app::share::ShareOptions;
use aarogyam_app::visit_summary::{self as app, OpenOutcome, Refused, Summary};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::require::ClinicalWrite;
use aarogyam_domain::visit_message::PlanChoice;
use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::prescriptions::{OpenRequest, ShareRequest, optional_body};
use super::rfc3339;
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::ApiFailure;

/// A new link to a visit summary. The token and PIN are shown once.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitLink {
    /// The link's id.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Token for the link: `/shared/{token}` on the clinic's host; the page opens it with
    /// `POST /shared/{token}/visit`.
    pub token: String,
    /// Six-digit PIN to tell the patient.
    pub pin: String,
    /// When it stops working.
    pub expires_at: String,
    /// How it was marked as handed over: `whatsapp`, `sms`, `qr` or `link`. No message is queued.
    pub channel: String,
}

/// Makes a link to a visit's summary. The body is optional: the lifetime (24 to 720 hours, seven
/// days by default) and how it is handed over. Nothing is sent: hand the link over yourself.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/share",
    operation_id = "createVisitShare",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = Option<ShareRequest>,
    security(("bearer" = [])),
    responses(
        (status = 201, body = VisitLink),
        (status = 400, description = "Hours outside 24 to 720, or an unknown channel"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such visit in this clinic")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    body: Bytes,
) -> Result<(StatusCode, Json<VisitLink>), ApiFailure> {
    let body: ShareRequest = optional_body(&body)?;
    let made = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        ShareOptions::parse(body.channel.as_deref(), body.expires_in_hours)?,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ShareLinkCreated.as_str(), share_link_id = %made.link.id.uuid(), "share link created");
    Ok((
        StatusCode::CREATED,
        Json(VisitLink {
            id: made.link.id.uuid(),
            token: made.link.token,
            pin: made.link.pin,
            expires_at: rfc3339(made.link.expires_at),
            channel: made.channel.as_str().to_owned(),
        }),
    ))
}

/// A treatment done in the visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct SummaryTreatment {
    /// What was done, such as "Root canal treatment".
    pub name: String,
    /// The tooth (FDI number), when it concerns one.
    pub tooth: Option<u8>,
}

/// Something still to be done for the patient.
#[derive(Debug, Serialize, ToSchema)]
pub struct SummaryPlanItem {
    /// The procedure's or plan item's id.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `procedure` (planned in this visit) or `plan_item` (an accepted treatment plan).
    pub source: String,
    /// What is to be done.
    pub name: String,
    /// The tooth (FDI number), when it concerns one.
    pub tooth: Option<u8>,
    /// The estimate in paise; absent when unknown or the clinic hides estimates. Show it as an
    /// estimate: the final cost follows the examination.
    pub estimate_paise: Option<i64>,
}

/// A medicine of the visit's issued prescriptions.
#[derive(Debug, Serialize, ToSchema)]
pub struct SummaryMedicine {
    /// Generic name.
    pub generic: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// How often, such as `1-0-1` (morning, afternoon, night).
    pub frequency: String,
    /// When to take it, such as `after_food`.
    pub timing: Option<String>,
    /// For how many days.
    pub duration_days: Option<u16>,
}

/// Care at home after one of today's treatments.
#[derive(Debug, Serialize, ToSchema)]
pub struct SummaryAftercare {
    /// The aftercare key, such as `extraction` or `root_canal_between_sittings`.
    pub key: String,
    /// Heading, such as "After a tooth removal".
    pub title: String,
    /// What to do, most important first.
    pub steps: Vec<String>,
    /// When to call the clinic.
    pub call_if: String,
}

/// What a visit summary shows.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitSummary {
    /// The clinic's name.
    pub clinic_name: String,
    /// The patient's name.
    pub patient_name: String,
    /// The visit's readable number, such as `V-318`.
    pub visit_number: String,
    /// The clinic day of the visit (`YYYY-MM-DD`).
    pub visited_on: String,
    /// The doctor's name.
    pub doctor_name: Option<String>,
    /// The treatments done.
    pub treatments: Vec<SummaryTreatment>,
    /// When the next follow-up falls due (`YYYY-MM-DD`), if one is planned.
    pub follow_up_on: Option<String>,
    /// Where to book the next visit: the clinic's public booking page, when it has a portal.
    pub booking_path: Option<String>,
    /// The clinic's verified portal host; the booking page is `https://{host}/book`.
    pub booking_host: Option<String>,
    /// When the link stops working.
    pub expires_at: String,
    /// Why the patient came.
    pub chief_complaint: Option<String>,
    /// What is still to be done: planned procedures, then accepted plan items.
    pub plan: Option<Vec<SummaryPlanItem>>,
    /// The visit's medicines.
    pub medicines: Option<Vec<SummaryMedicine>>,
    /// Care at home after today's treatments, most important first.
    pub aftercare: Option<Vec<SummaryAftercare>>,
    /// The clinic's phone in E.164, for "Call us".
    pub clinic_phone: Option<String>,
    /// The visit doctor's practitioner id, to preselect on the booking page.
    #[schema(value_type = Option<String>)]
    pub practitioner_id: Option<Uuid>,
}

fn day(date: time::Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

impl From<Summary> for VisitSummary {
    fn from(summary: Summary) -> Self {
        Self {
            clinic_name: summary.clinic_name,
            patient_name: summary.patient_name,
            visit_number: summary.visit_number,
            visited_on: day(summary.visited_on),
            doctor_name: summary.doctor_name,
            treatments: summary
                .treatments
                .into_iter()
                .map(|t| SummaryTreatment {
                    name: t.name,
                    tooth: t.tooth.map(aarogyam_domain::dental::Tooth::number),
                })
                .collect(),
            follow_up_on: summary.follow_up_on.map(day),
            booking_path: summary.booking_host.as_ref().map(|_| "/book".to_owned()),
            booking_host: summary.booking_host,
            expires_at: rfc3339(summary.expires_at),
            chief_complaint: summary.chief_complaint,
            plan: Some(
                summary
                    .plan
                    .into_iter()
                    .map(|item| SummaryPlanItem {
                        id: item.id,
                        source: item.source.as_str().to_owned(),
                        name: item.name,
                        tooth: item.tooth.map(aarogyam_domain::dental::Tooth::number),
                        estimate_paise: item.estimate.map(sakalya_types::Paise::get),
                    })
                    .collect(),
            ),
            medicines: Some(
                summary
                    .medicines
                    .into_iter()
                    .map(|line| SummaryMedicine {
                        generic: line.generic,
                        strength: line.strength,
                        frequency: line.frequency,
                        timing: line.timing,
                        duration_days: line.days,
                    })
                    .collect(),
            ),
            aftercare: Some(
                summary
                    .aftercare
                    .into_iter()
                    .map(|care| SummaryAftercare {
                        key: care.key.to_owned(),
                        title: care.care.title.clone(),
                        steps: care.care.steps.clone(),
                        call_if: care.care.call_if.clone(),
                    })
                    .collect(),
            ),
            clinic_phone: summary.clinic_phone,
            practitioner_id: summary.practitioner_id,
        }
    }
}

/// Public, no sign-in: opens a link to a visit summary with the PIN. Five wrong PINs lock the
/// link. Every open is written to the access record.
#[utoipa::path(
    post,
    path = "/api/v1/shared/{token}/visit",
    operation_id = "openSharedVisit",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    request_body = OpenRequest,
    responses(
        (status = 200, body = VisitSummary),
        (status = 403, description = "Wrong PIN; the message says how many tries are left"),
        (status = 404, description = "No such link, or not a link to a visit"),
        (status = 410, description = "Expired"),
        (status = 423, description = "Locked after too many wrong PINs")
    )
)]
pub(crate) async fn open(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath(token): ApiPath<String>,
    ApiJson(body): ApiJson<OpenRequest>,
) -> Result<Response, ApiFailure> {
    let outcome = app::open(
        state.db(),
        public.clinic_id,
        public.request_id,
        &token,
        &body.pin,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(match outcome {
        OpenOutcome::Opened(summary) => {
            tracing::info!(event = Event::ShareLinkOpened.as_str(), "share link opened");
            Json(VisitSummary::from(*summary)).into_response()
        }
        OpenOutcome::WrongPin(left) => refusal(Refused::WrongPin(left)),
        OpenOutcome::Locked => refusal(Refused::Locked),
        OpenOutcome::Expired => refusal(Refused::Expired),
    })
}

/// The answer to a link that did not unlock: 403 wrong PIN, 423 locked, 410 expired.
fn refusal(refused: Refused) -> Response {
    let (status, code, message) = match refused {
        Refused::WrongPin(left) => (
            StatusCode::FORBIDDEN,
            "wrong_pin",
            format!("The PIN is wrong. {left} tries left."),
        ),
        Refused::Locked => {
            tracing::info!(event = Event::ShareLinkLocked.as_str(), "share link locked");
            (
                StatusCode::LOCKED,
                "locked",
                "Too many wrong PINs. Ask the clinic for a new link.".to_owned(),
            )
        }
        Refused::Expired => (
            StatusCode::GONE,
            "expired",
            "This link has expired. Ask the clinic for a new one.".to_owned(),
        ),
    };
    (
        status,
        Json(serde_json::json!({ "error": { "code": code, "message": message } })),
    )
        .into_response()
}

/// The patient's answer to their plan, with the PIN again.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PlanResponseRequest {
    /// The six digits the clinic gave.
    pub pin: String,
    /// `go_ahead` ("Yes, I want to go ahead") or `question` ("I have a question").
    pub choice: String,
}

/// The answer as saved.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlanResponse {
    /// `go_ahead` or `question`.
    pub choice: String,
    /// When it was saved (RFC 3339).
    pub responded_at: String,
}

/// Public, no sign-in: the patient answers their plan from the visit page. The PIN is checked
/// every time, with the same wrong-PIN count and lock as opening the link; it does not count as
/// an open. One answer per link: the latest wins. A new or different answer tells the visit's
/// doctor and the desk.
#[utoipa::path(
    post,
    path = "/api/v1/shared/{token}/plan-response",
    operation_id = "answerSharedVisitPlan",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    request_body = PlanResponseRequest,
    responses(
        (status = 200, body = PlanResponse),
        (status = 400, description = "The choice is not `go_ahead` or `question`"),
        (status = 403, description = "Wrong PIN; the message says how many tries are left"),
        (status = 404, description = "No such link, or not a link to a visit"),
        (status = 410, description = "Expired or revoked"),
        (status = 423, description = "Locked after too many wrong PINs")
    )
)]
pub(crate) async fn answer(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath(token): ApiPath<String>,
    ApiJson(body): ApiJson<PlanResponseRequest>,
) -> Result<Response, ApiFailure> {
    let choice = PlanChoice::parse(&body.choice).ok_or_else(|| AppError::Invalid {
        field: "choice",
        message: "must be go_ahead or question".into(),
    })?;
    let outcome = app::answer(
        state.db(),
        public.clinic_id,
        public.request_id,
        &token,
        &body.pin,
        choice,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(match outcome {
        Ok(answer) => {
            tracing::info!(
                event = Event::VisitPlanAnswered.as_str(),
                encounter_id = %answer.encounter_id.uuid(),
                share_link_id = %answer.share_link_id.uuid(),
                choice = answer.choice.as_str(),
                changed = answer.changed,
                "plan answered"
            );
            Json(PlanResponse {
                choice: answer.choice.as_str().to_owned(),
                responded_at: rfc3339(answer.responded_at),
            })
            .into_response()
        }
        Err(refused) => refusal(refused),
    })
}
