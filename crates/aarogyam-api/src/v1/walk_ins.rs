//! A walk-in in one step: register or pick the patient, record reported allergies and desk
//! consents, and issue a queue token.

use aarogyam_app::intake::{DeskConsent, Intake};
use aarogyam_app::patients::RegisterPatient;
use aarogyam_app::walk_ins::{self as app, NewWalkIn, WalkInPatient, WalkInView};
use aarogyam_domain::consent::{Method, Purpose};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{BranchId, PatientId, PractitionerId};
use aarogyam_domain::permission::require::IntakeWrite;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use super::patients::{NewPatient, Patient, parse_date};
use super::queue::QueueToken;
use super::{bad, parse_id};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A consent the patient gives at the desk, recorded against the clinic's current notice.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DeskConsentFields {
    /// `care`, `reminders`, `promotional`, `sharing` or `research`.
    pub purpose: String,
    /// `verbal` (the usual at the desk), `paper` or `app`.
    pub method: String,
}

/// A walk-in: a new patient (`patient`) or a registered one (`patient_id`), exactly one of the
/// two.
#[derive(Debug, Deserialize, ToSchema)]
pub struct WalkInRequest {
    /// Details of a patient to register now.
    pub patient: Option<NewPatient>,
    /// A registered patient, such as one picked from the phone lookup.
    pub patient_id: Option<String>,
    /// The doctor, if known. A member who sees only their own patients must name themselves.
    pub practitioner_id: Option<String>,
    /// Branch; the default branch when left out.
    pub branch_id: Option<String>,
    /// Substances the patient says they are allergic to, each 1 to 200 characters (at most
    /// 20). Recorded as patient-reported until a clinician confirms them; ones already on record
    /// are not repeated.
    #[serde(default)]
    pub allergies: Vec<String>,
    /// The patient knows of no allergies. Not together with `allergies`.
    #[serde(default)]
    pub no_known_allergies: bool,
    /// Consents given at the desk, each purpose once. Purposes already in force are left as
    /// they are.
    #[serde(default)]
    pub consents: Vec<DeskConsentFields>,
    /// The notice version shown; the clinic's current notice (`v1 2026-10`) when left out.
    pub notice_version: Option<String>,
}

/// What a walk-in did.
#[derive(Debug, Serialize, ToSchema)]
pub struct WalkIn {
    /// The patient.
    pub patient: Patient,
    /// Whether the patient was registered by this request.
    pub registered: bool,
    /// The queue token issued.
    pub token: QueueToken,
    /// How many allergies were recorded.
    pub allergies_recorded: u64,
    /// The purposes whose consent was recorded.
    pub consents_recorded: Vec<String>,
}

impl From<WalkInView> for WalkIn {
    fn from(view: WalkInView) -> Self {
        Self {
            patient: view.patient.into(),
            registered: view.registered,
            token: view.token.into(),
            allergies_recorded: view.allergies_recorded,
            consents_recorded: view
                .consents_recorded
                .iter()
                .map(|p| p.as_str().to_owned())
                .collect(),
        }
    }
}

fn input(body: WalkInRequest) -> Result<NewWalkIn, ApiFailure> {
    let patient = match (body.patient, body.patient_id) {
        (Some(details), None) => WalkInPatient::New(RegisterPatient {
            full_name: details.full_name,
            sex: details.sex,
            date_of_birth: details
                .date_of_birth
                .as_deref()
                .map(parse_date)
                .transpose()?,
            age_years: details.age_years,
            phone: details.phone,
            email: details.email,
            preferred_language: details.preferred_language,
        }),
        (None, Some(id)) => {
            WalkInPatient::Existing(PatientId::from_uuid(parse_id("patient_id", &id)?))
        }
        _ => return Err(bad("patient", "give either patient or patient_id").into()),
    };
    let consents = desk_consents(&body.consents)?;
    Ok(NewWalkIn {
        patient,
        practitioner_id: body
            .practitioner_id
            .as_deref()
            .map(|text| parse_id("practitioner_id", text).map(PractitionerId::from_uuid))
            .transpose()?,
        branch_id: body
            .branch_id
            .as_deref()
            .map(|text| parse_id("branch_id", text).map(BranchId::from_uuid))
            .transpose()?,
        intake: Intake {
            allergies: body.allergies,
            no_known_allergies: body.no_known_allergies,
            consents,
            notice_version: body.notice_version,
        },
    })
}

/// Parses consents given at the desk.
pub(crate) fn desk_consents(fields: &[DeskConsentFields]) -> Result<Vec<DeskConsent>, ApiFailure> {
    fields
        .iter()
        .map(|c| {
            Ok(DeskConsent {
                purpose: Purpose::parse(&c.purpose).map_err(|_| bad("purpose", "unknown value"))?,
                method: Method::parse(&c.method).map_err(|_| bad("method", "unknown value"))?,
            })
        })
        .collect()
}

/// Registers a walk-in in one step, in one transaction: the patient (new, or registered and
/// picked from the phone lookup), the allergies they report or "No known allergies", the
/// consents they give at the desk, and a queue token.
#[utoipa::path(
    post,
    path = "/api/v1/walk-ins",
    operation_id = "registerWalkIn",
    tag = "queue",
    request_body = WalkInRequest,
    security(("bearer" = [])),
    responses(
        (status = 201, body = WalkIn),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks intake.write, patients.write or appointments.write"),
        (status = 404, description = "No such patient in this clinic"),
        (status = 409, description = "\"No known allergies\" for a patient with an allergy on record")
    )
)]
pub(crate) async fn register(
    State(state): State<AppState>,
    Require { request, .. }: Require<IntakeWrite>,
    ApiJson(body): ApiJson<WalkInRequest>,
) -> Result<(StatusCode, Json<WalkIn>), ApiFailure> {
    let view = app::register(
        state.db(),
        &request.actor,
        request.request_id,
        input(body)?,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::WalkInRegistered.as_str(),
        patient_id = %view.patient.id.uuid(),
        queue_token_id = %view.token.row.id,
        registered = view.registered,
        "walk-in registered"
    );
    Ok((StatusCode::CREATED, Json(view.into())))
}
