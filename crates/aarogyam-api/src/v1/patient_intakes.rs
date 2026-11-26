//! The case-paper fields clinics collect at registration, and the lists the forms offer.

use aarogyam_app::patient_intakes as app;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::patient_intake::{BloodGroup, CallTime, HeardVia, RawIntake};
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use aarogyam_domain::self_check_in::catalogue;
use axum::Json;
use axum::extract::State;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::self_check_in::CheckInChoice;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The case-paper fields: every one optional. Phones are normalised to E.164 (+91 is assumed
/// without a country code).
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct PatientIntake {
    /// `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+` or `O-`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub blood_group: Option<String>,
    /// A second phone ("Mobile 2", `WhatsApp`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub alt_phone: Option<String>,
    /// Emergency contact's name, at most 120 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub emergency_contact_name: Option<String>,
    /// Emergency contact's phone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub emergency_contact_phone: Option<String>,
    /// Who referred the patient, at most 120 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub referred_by: Option<String>,
    /// Best time to call: `morning`, `afternoon`, `evening` or `any`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub call_time: Option<String>,
    /// Occupation, at most 80 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub occupation: Option<String>,
    /// How the patient heard of the clinic: a code from `heard_via` in the intake options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub heard_via: Option<String>,
    /// The words for "Other", at most 120 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub heard_via_text: Option<String>,
    /// Family doctor's name, at most 120 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub family_doctor_name: Option<String>,
    /// Family doctor's phone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub family_doctor_phone: Option<String>,
    /// Family doctor's address, at most 300 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub family_doctor_address: Option<String>,
    /// The "Other ____" line of the health checklist, at most 300 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub health_other: Option<String>,
    /// Pregnant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub pregnant: Option<bool>,
    /// Due date, `YYYY-MM-DD`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub due_date: Option<String>,
    /// Nursing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(required = false)]
    pub nursing: Option<bool>,
}

impl From<RawIntake> for PatientIntake {
    fn from(raw: RawIntake) -> Self {
        Self {
            blood_group: raw.blood_group,
            alt_phone: raw.alt_phone,
            emergency_contact_name: raw.emergency_contact_name,
            emergency_contact_phone: raw.emergency_contact_phone,
            referred_by: raw.referred_by,
            call_time: raw.call_time,
            occupation: raw.occupation,
            heard_via: raw.heard_via,
            heard_via_text: raw.heard_via_text,
            family_doctor_name: raw.family_doctor_name,
            family_doctor_phone: raw.family_doctor_phone,
            family_doctor_address: raw.family_doctor_address,
            health_other: raw.health_other,
            pregnant: raw.pregnant,
            due_date: raw.due_date,
            nursing: raw.nursing,
        }
    }
}

impl From<PatientIntake> for RawIntake {
    fn from(body: PatientIntake) -> Self {
        Self {
            blood_group: body.blood_group,
            alt_phone: body.alt_phone,
            emergency_contact_name: body.emergency_contact_name,
            emergency_contact_phone: body.emergency_contact_phone,
            referred_by: body.referred_by,
            call_time: body.call_time,
            occupation: body.occupation,
            heard_via: body.heard_via,
            heard_via_text: body.heard_via_text,
            family_doctor_name: body.family_doctor_name,
            family_doctor_phone: body.family_doctor_phone,
            family_doctor_address: body.family_doctor_address,
            health_other: body.health_other,
            pregnant: body.pregnant,
            due_date: body.due_date,
            nursing: body.nursing,
        }
    }
}

fn choices(all: &[(&str, &str)]) -> Vec<CheckInChoice> {
    all.iter()
        .map(|(code, label)| CheckInChoice {
            code: (*code).to_owned(),
            label: (*label).to_owned(),
        })
        .collect()
}

pub(super) fn blood_groups() -> Vec<CheckInChoice> {
    choices(BloodGroup::ALL)
}

pub(super) fn call_times() -> Vec<CheckInChoice> {
    choices(CallTime::ALL)
}

pub(super) fn heard_via() -> Vec<CheckInChoice> {
    choices(HeardVia::ALL)
}

/// The lists the registration forms offer.
#[derive(Debug, Serialize, ToSchema)]
pub struct IntakeOptions {
    /// The health checklist, in case-paper order; `none` stands alone.
    pub health_flags: Vec<CheckInChoice>,
    /// Blood groups.
    pub blood_groups: Vec<CheckInChoice>,
    /// Best times to call.
    pub call_times: Vec<CheckInChoice>,
    /// How patients heard of the clinic.
    pub heard_via: Vec<CheckInChoice>,
}

/// The choices the staff registration form and the phones offer, so they use the same lists as
/// the QR check-in page.
#[utoipa::path(
    get,
    path = "/api/v1/patients/intake-options",
    operation_id = "getIntakeOptions",
    tag = "patients",
    security(("bearer" = [])),
    responses(
        (status = 200, body = IntakeOptions),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write")
    )
)]
pub(crate) async fn options(
    Require { .. }: Require<PatientsWrite>,
) -> Result<Json<IntakeOptions>, ApiFailure> {
    Ok(Json(IntakeOptions {
        health_flags: catalogue().health_flags.iter().map(Into::into).collect(),
        blood_groups: blood_groups(),
        call_times: call_times(),
        heard_via: heard_via(),
    }))
}

/// The patient's case-paper fields; an empty object when none were saved.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/intake",
    operation_id = "getPatientIntake",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientIntake),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientIntake>, ApiFailure> {
    let raw = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(raw.into()))
}

/// Replaces the patient's case-paper fields (a field left out is cleared) and returns them.
#[utoipa::path(
    put,
    path = "/api/v1/patients/{id}/intake",
    operation_id = "setPatientIntake",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    request_body = PatientIntake,
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientIntake),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn put(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PatientIntake>,
) -> Result<Json<PatientIntake>, ApiFailure> {
    let saved = app::put(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        &body.into(),
    )
    .await?;
    Ok(Json(saved.into()))
}
