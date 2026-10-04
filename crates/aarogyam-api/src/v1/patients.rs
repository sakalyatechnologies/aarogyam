//! Patients: register, search, open.

use aarogyam_app::patients::{self as app, PatientView, RegisterPatient};
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::permission::require::{PatientsRead, PatientsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A patient. Phone and email are masked (`+91******3210`) unless the role has `patients.contact`.
#[derive(Debug, Serialize, ToSchema)]
pub struct Patient {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Readable number, such as `SD-1042`.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Date of birth (`YYYY-MM-DD`), exact or estimated.
    pub date_of_birth: Option<String>,
    /// Whether the date of birth was estimated from an age.
    pub birth_date_estimated: bool,
    /// Age in whole years today.
    pub age_years: Option<u16>,
    /// Phone, masked without `patients.contact`.
    pub phone: Option<String>,
    /// Email, masked without `patients.contact`.
    pub email: Option<String>,
    /// Language tag, such as `hi-IN`.
    pub preferred_language: String,
    /// `active`, `inactive`, `deceased` or `merged`.
    pub status: String,
    /// When the record was created (RFC 3339).
    pub created_at: String,
    /// The last visit (RFC 3339), once visits exist.
    pub last_visit_at: Option<String>,
}

impl From<PatientView> for Patient {
    fn from(view: PatientView) -> Self {
        Self {
            id: view.id.uuid(),
            number: view.number,
            full_name: view.full_name,
            sex: view.sex,
            date_of_birth: view.date_of_birth.map(|date| date.to_string()),
            birth_date_estimated: view.birth_date_estimated,
            age_years: view.age_years,
            phone: view.phone,
            email: view.email,
            preferred_language: view.preferred_language,
            status: view.status,
            created_at: rfc3339(view.created_at),
            last_visit_at: view.last_visit_at.map(rfc3339),
        }
    }
}

/// Search results.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientList {
    /// Matching patients, best first.
    pub items: Vec<Patient>,
}

/// What to search for.
#[derive(Debug, Deserialize)]
pub struct SearchParams {
    /// A number (`SD-1042` or `1042`), a phone number, or the start of a name. Empty lists
    /// the most recently registered patients.
    #[serde(default)]
    pub q: String,
    /// Most results, 1 to 50 (default 20).
    pub limit: Option<i64>,
}

/// Finds patients by number, phone or name.
#[utoipa::path(
    get,
    path = "/api/v1/patients",
    tag = "patients",
    params(
        ("q" = Option<String>, Query, description = "A number (SD-1042 or 1042), a phone number, or the start of a name; empty lists recent patients"),
        ("limit" = Option<i64>, Query, description = "Most results, 1 to 50 (default 20)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn search(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiQuery(params): ApiQuery<SearchParams>,
) -> Result<Json<PatientList>, ApiFailure> {
    let rows = app::search(
        state.db(),
        &request.actor,
        request.request_id,
        &params.q,
        params.limit.unwrap_or(20),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(PatientList {
        items: rows.into_iter().map(Patient::from).collect(),
    }))
}

/// A patient to register.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewPatient {
    /// Full name, 1 to 200 characters.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown` (default).
    pub sex: Option<String>,
    /// Date of birth (`YYYY-MM-DD`); give this or `age_years`.
    pub date_of_birth: Option<String>,
    /// Age in years when the date of birth is unknown.
    pub age_years: Option<u16>,
    /// Phone; +91 is assumed without a country code.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Language tag such as `mr-IN` (default `en-IN`).
    pub preferred_language: Option<String>,
}

fn parse_date(text: &str) -> Result<Date, ApiError> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    Date::parse(text.trim(), &format)
        .map_err(|_| ApiError::bad_request("invalid_request", "date_of_birth: must be YYYY-MM-DD"))
}

/// Registers a patient and issues the clinic's next number.
#[utoipa::path(
    post,
    path = "/api/v1/patients",
    tag = "patients",
    request_body = NewPatient,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Patient),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.write")
    )
)]
pub(crate) async fn register(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsWrite>,
    ApiJson(body): ApiJson<NewPatient>,
) -> Result<(StatusCode, Json<Patient>), ApiFailure> {
    let date_of_birth = body.date_of_birth.as_deref().map(parse_date).transpose()?;
    let input = RegisterPatient {
        full_name: body.full_name,
        sex: body.sex,
        date_of_birth,
        age_years: body.age_years,
        phone: body.phone,
        email: body.email,
        preferred_language: body.preferred_language,
    };
    let view = app::register(
        state.db(),
        &request.actor,
        request.request_id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Opens a patient's record. Every open is written to the access record.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}",
    tag = "patients",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Patient),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn open(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Patient>, ApiFailure> {
    let view = app::open(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(view.into()))
}
