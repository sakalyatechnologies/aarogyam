//! Conditions, allergies and the clinical flags banner.

use aarogyam_app::facts::{
    self as app, AllergyInput, AllergyView, ClinicalFlags as FlagsView, CodeInput, ConditionInput,
    ConditionView,
};
use aarogyam_domain::clinical::CodeSystem;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AllergyId, ConditionId, EncounterId, MembershipId, PatientId};
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite, PatientsRead};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// An optional clinical code. Free text always works without one.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Code {
    /// `icd10`, `icd11`, `snomed`, `loinc` or `custom`.
    pub system: String,
    /// The code; empty clears it on an edit.
    pub code: String,
}

fn code_out(code: Option<(CodeSystem, String)>) -> Option<Code> {
    code.map(|(system, code)| Code {
        system: system.as_str().to_owned(),
        code,
    })
}

fn code_in(code: Option<Code>) -> Option<CodeInput> {
    code.map(|code| CodeInput {
        system: Some(code.system),
        code: Some(code.code),
    })
}

/// A condition on the problem list.
#[derive(Debug, Serialize, ToSchema)]
pub struct Condition {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The visit it was found in.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// What the doctor wrote.
    pub display_text: String,
    /// Optional code.
    pub code: Option<Code>,
    /// `active`, `resolved` or `entered_in_error`.
    pub status: String,
    /// Shown in the clinical flags banner while active.
    pub flagged: bool,
    /// When it began (`YYYY-MM-DD`).
    pub onset: Option<String>,
    /// A remark.
    pub note: Option<String>,
    /// `clinician`, `assistant`, `patient` or `import`.
    pub source: String,
    /// The member who recorded or last confirmed it.
    #[schema(value_type = Option<String>)]
    pub verified_by: Option<Uuid>,
    /// When it was recorded (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
}

impl From<ConditionView> for Condition {
    fn from(view: ConditionView) -> Self {
        Self {
            id: view.id.uuid(),
            visit_id: view.visit_id.map(EncounterId::uuid),
            display_text: view.display_text,
            code: code_out(view.code),
            status: view.status.as_str().to_owned(),
            flagged: view.flagged,
            onset: view.onset.map(|date| date.to_string()),
            note: view.note,
            source: view.source.as_str().to_owned(),
            verified_by: view.verified_by.map(MembershipId::uuid),
            created_at: rfc3339(view.created_at),
            updated_at: rfc3339(view.updated_at),
        }
    }
}

/// A patient's conditions, active first.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConditionList {
    /// The conditions.
    pub items: Vec<Condition>,
}

/// A condition to record or edit. On an edit, fields left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ConditionFields {
    /// What the doctor wrote, 1 to 300 characters; required for a new condition.
    pub display_text: Option<String>,
    /// Optional code.
    pub code: Option<Code>,
    /// `active` (default), `resolved` or `entered_in_error`.
    pub status: Option<String>,
    /// Show in the clinical flags banner while active (diabetes, a bleeding disorder, pregnancy).
    pub flagged: Option<bool>,
    /// When it began (`YYYY-MM-DD`), or empty to clear it.
    pub onset: Option<String>,
    /// A remark, or empty to clear it.
    pub note: Option<String>,
    /// `clinician` (default), `assistant`, `patient` or `import`.
    pub source: Option<String>,
    /// The visit it was found in; new conditions only.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
}

fn parse_date(field: &'static str, text: &str) -> Result<Date, ApiError> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    Date::parse(text.trim(), &format).map_err(|_| {
        ApiError::bad_request("invalid_request", format!("{field}: must be YYYY-MM-DD"))
    })
}

impl ConditionFields {
    fn into_input(self) -> Result<ConditionInput, ApiError> {
        let onset = match self.onset.as_deref().map(str::trim) {
            None => None,
            Some("") => Some(None),
            Some(text) => Some(Some(parse_date("onset", text)?)),
        };
        Ok(ConditionInput {
            display_text: self.display_text,
            code: code_in(self.code),
            status: self.status,
            flagged: self.flagged,
            onset,
            note: self.note,
            source: self.source,
            visit_id: self.visit_id,
        })
    }
}

/// A patient's conditions, active first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/conditions",
    operation_id = "listConditions",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ConditionList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn conditions(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ConditionList>, ApiFailure> {
    let rows = app::conditions(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(ConditionList {
        items: rows.into_iter().map(Condition::from).collect(),
    }))
}

/// Adds a condition to a patient's problem list.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/conditions",
    operation_id = "addCondition",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    request_body = ConditionFields,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Condition),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn add_condition(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ConditionFields>,
) -> Result<(StatusCode, Json<Condition>), ApiFailure> {
    let view = app::add_condition(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        body.into_input()?,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Edits a condition: resolve it, flag it, correct it, or mark it entered in error.
#[utoipa::path(
    patch,
    path = "/api/v1/patients/{id}/conditions/{condition_id}",
    operation_id = "updateCondition",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("condition_id" = String, Path, description = "The condition")
    ),
    request_body = ConditionFields,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Condition),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such condition for this patient in this clinic")
    )
)]
pub(crate) async fn edit_condition(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath((id, condition_id)): ApiPath<(Uuid, Uuid)>,
    ApiJson(body): ApiJson<ConditionFields>,
) -> Result<Json<Condition>, ApiFailure> {
    let view = app::edit_condition(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        ConditionId::from_uuid(condition_id),
        body.into_input()?,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// An allergy.
#[derive(Debug, Serialize, ToSchema)]
pub struct Allergy {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The substance, such as penicillin or latex.
    pub substance: String,
    /// Optional code.
    pub code: Option<Code>,
    /// What happens.
    pub reaction: Option<String>,
    /// `mild`, `moderate` or `severe`.
    pub severity: String,
    /// `active`, `resolved` or `entered_in_error`.
    pub status: String,
    /// `clinician`, `assistant`, `patient` or `import`.
    pub source: String,
    /// The member who recorded or last confirmed it; null while a patient-reported allergy
    /// waits for a clinician to confirm it.
    #[schema(value_type = Option<String>)]
    pub verified_by: Option<Uuid>,
    /// Whether a clinician recorded or confirmed it. False for an allergy the patient reported
    /// at the desk until a clinician confirms it.
    pub confirmed: bool,
    /// When it was recorded (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
}

impl From<AllergyView> for Allergy {
    fn from(view: AllergyView) -> Self {
        Self {
            id: view.id.uuid(),
            substance: view.substance,
            code: code_out(view.code),
            reaction: view.reaction,
            severity: view.severity.as_str().to_owned(),
            status: view.status.as_str().to_owned(),
            source: view.source.as_str().to_owned(),
            verified_by: view.verified_by.map(MembershipId::uuid),
            confirmed: view.verified_by.is_some(),
            created_at: rfc3339(view.created_at),
            updated_at: rfc3339(view.updated_at),
        }
    }
}

/// A patient's allergies, active and severe first.
#[derive(Debug, Serialize, ToSchema)]
pub struct AllergyList {
    /// The allergies.
    pub items: Vec<Allergy>,
}

/// An allergy to record or edit. On an edit, fields left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AllergyFields {
    /// The substance, 1 to 200 characters; required for a new allergy.
    pub substance: Option<String>,
    /// Optional code.
    pub code: Option<Code>,
    /// What happens, or empty to clear it.
    pub reaction: Option<String>,
    /// `mild`, `moderate` (default) or `severe`.
    pub severity: Option<String>,
    /// `active` (default), `resolved` or `entered_in_error`.
    pub status: Option<String>,
    /// `clinician` (default), `assistant`, `patient` or `import`.
    pub source: Option<String>,
}

impl From<AllergyFields> for AllergyInput {
    fn from(fields: AllergyFields) -> Self {
        Self {
            substance: fields.substance,
            code: code_in(fields.code),
            reaction: fields.reaction,
            severity: fields.severity,
            status: fields.status,
            source: fields.source,
        }
    }
}

/// A patient's allergies, active and severe first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/allergies",
    operation_id = "listAllergies",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = AllergyList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn allergies(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<AllergyList>, ApiFailure> {
    let rows = app::allergies(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(AllergyList {
        items: rows.into_iter().map(Allergy::from).collect(),
    }))
}

/// Records an allergy.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/allergies",
    operation_id = "addAllergy",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    request_body = AllergyFields,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Allergy),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn add_allergy(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<AllergyFields>,
) -> Result<(StatusCode, Json<Allergy>), ApiFailure> {
    let view = app::add_allergy(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        body.into(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Edits an allergy: resolve it, change its severity, or mark it entered in error.
#[utoipa::path(
    patch,
    path = "/api/v1/patients/{id}/allergies/{allergy_id}",
    operation_id = "updateAllergy",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("allergy_id" = String, Path, description = "The allergy")
    ),
    request_body = AllergyFields,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Allergy),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such allergy for this patient in this clinic")
    )
)]
pub(crate) async fn edit_allergy(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath((id, allergy_id)): ApiPath<(Uuid, Uuid)>,
    ApiJson(body): ApiJson<AllergyFields>,
) -> Result<Json<Allergy>, ApiFailure> {
    let view = app::edit_allergy(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        AllergyId::from_uuid(allergy_id),
        body.into(),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Confirms an allergy the patient reported at the desk: the caller becomes its verifier.
/// Confirming one already confirmed changes nothing.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/allergies/{allergy_id}/confirm",
    operation_id = "confirmAllergy",
    tag = "clinical",
    params(
        ("id" = String, Path, description = "The patient"),
        ("allergy_id" = String, Path, description = "The allergy")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Allergy),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such allergy for this patient in this clinic")
    )
)]
pub(crate) async fn confirm_allergy(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath((id, allergy_id)): ApiPath<(Uuid, Uuid)>,
) -> Result<Json<Allergy>, ApiFailure> {
    let view = app::confirm_allergy(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        AllergyId::from_uuid(allergy_id),
    )
    .await?;
    tracing::info!(
        event = Event::AllergyConfirmed.as_str(),
        allergy_id = %view.id.uuid(),
        "allergy confirmed"
    );
    Ok(Json(view.into()))
}

/// Patient 360's safety banner. Anyone who can see the patient learns that flags exist and how
/// many; the substances and conditions need `clinical.read`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicalFlags {
    /// Active allergies.
    pub allergy_count: usize,
    /// Whether any active allergy is severe.
    pub severe_allergy: bool,
    /// Flagged active conditions.
    pub condition_count: usize,
    /// True when the lists below were left out because the role lacks `clinical.read`.
    pub details_hidden: bool,
    /// Active allergies, severe first.
    pub allergies: Vec<Allergy>,
    /// Flagged active conditions.
    pub conditions: Vec<Condition>,
    /// Whether the patient was asked about allergies: `unknown` (never asked), `none_known`
    /// ("No known allergies") or `has_allergies`.
    pub allergies_reviewed: String,
}

impl From<FlagsView> for ClinicalFlags {
    fn from(view: FlagsView) -> Self {
        Self {
            allergy_count: view.allergy_count,
            severe_allergy: view.severe_allergy,
            condition_count: view.condition_count,
            details_hidden: view.details_hidden,
            allergies: view.allergies.into_iter().map(Allergy::from).collect(),
            conditions: view.conditions.into_iter().map(Condition::from).collect(),
            allergies_reviewed: view.allergies_reviewed.as_str().to_owned(),
        }
    }
}

/// The patient's clinical flags: active allergies and flagged active conditions.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/clinical-flags",
    operation_id = "getClinicalFlags",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ClinicalFlags),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks patients.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn flags(
    State(state): State<AppState>,
    Require { request, .. }: Require<PatientsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ClinicalFlags>, ApiFailure> {
    let view = app::flags(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}
