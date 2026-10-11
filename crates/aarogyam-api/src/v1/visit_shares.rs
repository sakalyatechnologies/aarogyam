//! What the patient sees after a visit: the clinic makes a link to one visit (opened with a PIN
//! on the clinic's host) and the patient app lists the same summary. The summary has the
//! treatments done (no fees), the advice (the Plan of signed notes only: S, O and A never leave),
//! the prescription, the next follow-up and five earlier visits by date and title.

use aarogyam_app::visit_share::{self as app, OpenOutcome, VisitSummary as Summary};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::permission::require::ClinicalRead;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::{ClinicHost, PatientRequest, Require};
use crate::failure::{ApiFailure, not_found};

/// A new link to a visit. The token and PIN are shown once.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitShare {
    /// The link's id.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Token for the link.
    pub token: String,
    /// Path on the clinic's host that the patient opens: `/shared/{token}`. Send the PIN apart
    /// from the link.
    pub path: String,
    /// Six-digit PIN.
    pub pin: String,
    /// When it stops working (seven days).
    pub expires_at: String,
}

/// Makes a seven-day link for the patient to open the visit summary with a PIN. Writes the
/// access record.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/share",
    operation_id = "createVisitShare",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 201, body = VisitShare),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such visit in this clinic")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<(StatusCode, Json<VisitShare>), ApiFailure> {
    let link = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ShareLinkCreated.as_str(), share_link_id = %link.id.uuid(), "share link created");
    Ok((
        StatusCode::CREATED,
        Json(VisitShare {
            id: link.id.uuid(),
            path: format!("/shared/{}", link.token),
            token: link.token,
            pin: link.pin,
            expires_at: rfc3339(link.expires_at),
        }),
    ))
}

/// A treatment done in the visit. No fee.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitTreatment {
    /// What was done.
    pub name: String,
    /// FDI tooth number.
    pub tooth: Option<i16>,
    /// Surfaces, such as `O`.
    pub surfaces: Vec<String>,
}

/// A medicine of the visit's prescription.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitRxItem {
    /// As printed.
    pub drug_name: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// Form, such as `tablet`.
    pub form: Option<String>,
    /// How much per dose.
    pub dose: String,
    /// `1-0-1`.
    pub frequency: String,
    /// `after_food`, and so on.
    pub timing: Option<String>,
    /// For how many days.
    pub duration_days: Option<i16>,
    /// In the prescription's language.
    pub instructions: Option<String>,
}

/// The prescription issued in the visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitPrescription {
    /// `RX-…`.
    pub number: String,
    /// The clinic day it was issued (`YYYY-MM-DD`).
    pub issued_on: String,
    /// The medicines in order.
    pub items: Vec<VisitRxItem>,
}

/// The next follow-up.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitFollowUp {
    /// The day it is due (`YYYY-MM-DD`).
    pub due_on: String,
    /// `follow_up`, `cleaning`, and so on.
    pub kind: String,
}

/// An earlier visit: the date and a title, nothing clinical.
#[derive(Debug, Serialize, ToSchema)]
pub struct EarlierVisit {
    /// The clinic day (`YYYY-MM-DD`).
    pub visited_on: String,
    /// The treatments done, or `Consultation`.
    pub title: String,
}

/// What a patient sees of one visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitSummary {
    /// The visit.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic the visit was at; absent on a public link, which is on the clinic's host.
    #[schema(value_type = Option<String>)]
    pub clinic_id: Option<Uuid>,
    /// Readable number, such as `V-318`.
    pub number: String,
    /// The clinic's name.
    pub clinic_name: String,
    /// The clinic day (`YYYY-MM-DD`).
    pub visited_on: String,
    /// The doctor's name.
    pub doctor_name: Option<String>,
    /// What was done.
    pub treatments: Vec<VisitTreatment>,
    /// The Plan section of the visit's signed notes.
    pub advice: Option<String>,
    /// The issued prescription.
    pub prescription: Option<VisitPrescription>,
    /// The next follow-up.
    pub next_follow_up: Option<VisitFollowUp>,
    /// The last five visits before this one, newest first.
    pub earlier_visits: Vec<EarlierVisit>,
    /// Where a patient books again, on the clinic's host.
    pub booking_path: String,
}

fn summary(clinic_id: Option<Uuid>, value: Summary) -> VisitSummary {
    VisitSummary {
        id: value.id,
        clinic_id,
        number: value.number,
        clinic_name: value.clinic_name,
        visited_on: value.visited_on.to_string(),
        doctor_name: value.doctor_name,
        treatments: value
            .treatments
            .into_iter()
            .map(|row| VisitTreatment {
                name: row.name,
                tooth: row.tooth,
                surfaces: row.surfaces,
            })
            .collect(),
        advice: value.advice,
        prescription: value.prescription.map(|rx| VisitPrescription {
            number: rx.number,
            issued_on: rx.issued_on.to_string(),
            items: rx
                .items
                .into_iter()
                .map(|line| VisitRxItem {
                    drug_name: line.drug_name,
                    strength: line.strength,
                    form: line.form,
                    dose: line.dose,
                    frequency: line.frequency,
                    timing: line.timing,
                    duration_days: line.duration_days,
                    instructions: line.instructions,
                })
                .collect(),
        }),
        next_follow_up: value.next_follow_up.map(|row| VisitFollowUp {
            due_on: row.due_on.to_string(),
            kind: row.kind,
        }),
        earlier_visits: value
            .earlier_visits
            .into_iter()
            .map(|row| EarlierVisit {
                visited_on: row.visited_on.to_string(),
                title: row.title,
            })
            .collect(),
        booking_path: "/public/booking".to_owned(),
    }
}

/// The PIN.
#[derive(Debug, Deserialize, ToSchema)]
pub struct OpenVisit {
    /// The six digits the clinic gave.
    pub pin: String,
}

/// Public, no sign-in: opens a link to a visit with the PIN. Five wrong PINs lock the link.
/// Every open is written to the access record.
#[utoipa::path(
    post,
    path = "/api/v1/shared/{token}/visit",
    operation_id = "openSharedVisit",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    request_body = OpenVisit,
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
    ApiJson(body): ApiJson<OpenVisit>,
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
    let refuse = |status: StatusCode, code: &str, message: String| {
        (
            status,
            Json(serde_json::json!({ "error": { "code": code, "message": message } })),
        )
            .into_response()
    };
    Ok(match outcome {
        OpenOutcome::Opened(value) => {
            tracing::info!(event = Event::ShareLinkOpened.as_str(), "share link opened");
            Json(summary(None, *value)).into_response()
        }
        OpenOutcome::WrongPin(left) => refuse(
            StatusCode::FORBIDDEN,
            "wrong_pin",
            format!("The PIN is wrong. {left} tries left."),
        ),
        OpenOutcome::Locked => {
            tracing::info!(event = Event::ShareLinkLocked.as_str(), "share link locked");
            refuse(
                StatusCode::LOCKED,
                "locked",
                "Too many wrong PINs. Ask the clinic for a new link.".into(),
            )
        }
        OpenOutcome::Expired => refuse(
            StatusCode::GONE,
            "expired",
            "This link has expired. Ask the clinic for a new one.".into(),
        ),
    })
}

/// The patient's visits.
#[derive(Debug, Serialize, ToSchema)]
pub struct MyVisits {
    /// Newest first within each clinic, at most 25 per clinic.
    pub items: Vec<VisitSummary>,
}

/// The patient's visits at every linked clinic, with the same summary as a link.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/visits",
    operation_id = "listMyVisits",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = MyVisits),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn mine(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<MyVisits>, ApiFailure> {
    let access = &request.access;
    let found = app::list(
        state.db(),
        access,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(MyVisits {
        items: found
            .into_iter()
            .map(|(index, value)| summary(Some(access.clinics[index].place.id.uuid()), value))
            .collect(),
    }))
}

/// One of the patient's visits.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/visits/{id}",
    operation_id = "getMyVisit",
    tag = "patient",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = VisitSummary),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "No such visit of this patient")
    )
)]
pub(crate) async fn mine_one(
    State(state): State<AppState>,
    request: PatientRequest,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<VisitSummary>, ApiFailure> {
    let access = &request.access;
    let now = OffsetDateTime::now_utc();
    for clinic in &access.clinics {
        let found = app::get(
            state.db(),
            access,
            clinic,
            request.request_id,
            EncounterId::from_uuid(id),
            now,
        )
        .await?;
        if let Some(value) = found {
            return Ok(Json(summary(Some(clinic.place.id.uuid()), value)));
        }
    }
    Err(ApiFailure::Error(not_found()))
}
