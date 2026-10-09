//! Checking in a booked patient: complete the registration, record intake, mark arrived.

use aarogyam_app::check_in::{self as app, CheckIn};
use aarogyam_app::intake::Intake;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::AppointmentId;
use aarogyam_domain::permission::require::IntakeWrite;
use axum::Json;
use axum::extract::State;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::appointments::Appointment;
use super::patients::parse_date;
use super::walk_ins::{DeskConsentFields, desk_consents};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// What the desk records at check-in. Every field is optional; details left out stay as they
/// are.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CheckInRequest {
    /// `female`, `male`, `other` or `unknown`.
    pub sex: Option<String>,
    /// Date of birth, `YYYY-MM-DD`. Not with `age_years`.
    pub date_of_birth: Option<String>,
    /// Age in years, when the date of birth is unknown.
    pub age_years: Option<u16>,
    /// Substances the patient says they are allergic to (at most 20), recorded as
    /// patient-reported until a clinician confirms them.
    #[serde(default)]
    pub allergies: Vec<String>,
    /// The patient knows of no allergies. Not together with `allergies`.
    #[serde(default)]
    pub no_known_allergies: bool,
    /// Consents given at the desk, each purpose once.
    #[serde(default)]
    pub consents: Vec<DeskConsentFields>,
    /// The notice version shown; the clinic's current notice when left out.
    pub notice_version: Option<String>,
}

/// What a check-in did.
#[derive(Debug, Serialize, ToSchema)]
pub struct CheckedIn {
    /// The appointment, arrived; its patient's `registration_incomplete` says whether sex or
    /// age is still missing.
    pub appointment: Appointment,
    /// Its queue token.
    #[schema(value_type = Option<String>)]
    pub queue_token_id: Option<Uuid>,
    /// How many allergies were recorded.
    pub allergies_recorded: u64,
    /// The purposes whose consent was recorded.
    pub consents_recorded: Vec<String>,
}

/// Checks in a booked patient in one step: completes their registration (sex, age or date of
/// birth), records reported allergies or "No known allergies" and desk consents, and marks the
/// appointment arrived, issuing its queue token. For online sign-ups, which arrive with only a
/// name, email and phone. Checking in again records the details without a second token.
#[utoipa::path(
    post,
    path = "/api/v1/appointments/{id}/check-in",
    operation_id = "checkInAppointment",
    tag = "appointments",
    params(("id" = String, Path, description = "The appointment")),
    request_body = CheckInRequest,
    security(("bearer" = [])),
    responses(
        (status = 200, body = CheckedIn),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks intake.write, patients.write or appointments.write"),
        (status = 404, description = "No such appointment in this clinic"),
        (status = 409, description = "The appointment can't arrive from its status, or \"No known allergies\" with an allergy on record")
    )
)]
pub(crate) async fn check_in(
    State(state): State<AppState>,
    Require { request, .. }: Require<IntakeWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<CheckInRequest>,
) -> Result<Json<CheckedIn>, ApiFailure> {
    let input = CheckIn {
        sex: body.sex,
        date_of_birth: body.date_of_birth.as_deref().map(parse_date).transpose()?,
        age_years: body.age_years,
        intake: Intake {
            allergies: body.allergies,
            no_known_allergies: body.no_known_allergies,
            consents: desk_consents(&body.consents)?,
            notice_version: body.notice_version,
        },
    };
    let done = app::check_in(
        state.db(),
        &request.actor,
        request.request_id,
        AppointmentId::from_uuid(id),
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::RegistrationCompleted.as_str(),
        appointment_id = %id,
        allergies = done.allergies_recorded,
        consents = done.consents_recorded.len(),
        "patient checked in"
    );
    Ok(Json(CheckedIn {
        queue_token_id: done.arrived.token_id,
        appointment: done.arrived.appointment.into(),
        allergies_recorded: done.allergies_recorded,
        consents_recorded: done
            .consents_recorded
            .iter()
            .map(|p| p.as_str().to_owned())
            .collect(),
    }))
}
