//! Prescriptions, the medicine list, patient links and the QR verification page.

use aarogyam_app::prescriptions::{
    self as app, AlertView, DrugView, IssueOutcome, RxInput, RxItemInput, RxView,
};
use aarogyam_app::share::{self, OpenOutcome};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{PatientId, PrescriptionId};
use aarogyam_domain::permission::require::{ClinicalRead, PrescriptionsIssue};
use aarogyam_domain::share::LinkState;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::PatientRef;
use super::{optional_uuid, parse_day, rfc3339};
use crate::AppState;
use crate::extract::{PublicClinic, Require};
use crate::failure::ApiFailure;

/// A medicine from the catalogue.
#[derive(Debug, Serialize, ToSchema)]
pub struct Drug {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Generic name.
    pub generic_name: String,
    /// Brand, when listed.
    pub brand_name: Option<String>,
    /// Strength, such as `500 mg`.
    pub strength: String,
    /// Form, such as `tablet`.
    pub form: String,
    /// Usual dose.
    pub default_dose: String,
    /// Usual frequency, such as `1-0-1`.
    pub default_frequency: String,
    /// Usual timing.
    pub default_timing: Option<String>,
    /// Usual days.
    pub default_duration_days: Option<i16>,
}

impl From<DrugView> for Drug {
    fn from(d: DrugView) -> Self {
        Self {
            id: d.id.uuid(),
            generic_name: d.generic_name,
            brand_name: d.brand_name,
            strength: d.strength,
            form: d.form,
            default_dose: d.default_dose,
            default_frequency: d.default_frequency,
            default_timing: d.default_timing,
            default_duration_days: d.default_duration_days,
        }
    }
}

/// Medicines found.
#[derive(Debug, Serialize, ToSchema)]
pub struct DrugList {
    /// Names starting with the query first.
    pub items: Vec<Drug>,
}

/// What to search for.
#[derive(Debug, Deserialize, ToSchema)]
pub struct DrugSearch {
    /// Part of a name or strength, such as `amox` or `500`.
    #[serde(default)]
    pub q: String,
    /// Most results, 1 to 50 (default 20).
    pub limit: Option<i64>,
}

/// Finds medicines in the shared list.
#[utoipa::path(
    post,
    path = "/api/v1/drugs/search",
    tag = "prescriptions",
    request_body = DrugSearch,
    security(("bearer" = [])),
    responses(
        (status = 200, body = DrugList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue")
    )
)]
pub(crate) async fn search_drugs(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiJson(body): ApiJson<DrugSearch>,
) -> Result<Json<DrugList>, ApiFailure> {
    let rows = app::search_drugs(
        state.db(),
        &request.actor,
        request.request_id,
        &body.q,
        body.limit.unwrap_or(20),
    )
    .await?;
    Ok(Json(DrugList {
        items: rows.into_iter().map(Drug::from).collect(),
    }))
}

/// A medicine on a prescription.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RxItem {
    /// Position (in responses).
    #[serde(default, skip_deserializing)]
    pub line_no: i16,
    /// The catalogue entry; its values fill what is left out.
    #[schema(value_type = Option<String>)]
    pub drug_id: Option<Uuid>,
    /// As printed, generic name in capitals; required for free text.
    pub drug_name: Option<String>,
    /// Strength.
    pub strength: Option<String>,
    /// Form.
    pub form: Option<String>,
    /// Dose, such as `1 tablet`.
    pub dose: Option<String>,
    /// Frequency, such as `1-0-1`.
    pub frequency: Option<String>,
    /// `before_food`, `after_food`, `empty_stomach`, `bedtime`, `sos` or `as_directed`.
    pub timing: Option<String>,
    /// Days, 1 to 365.
    pub duration_days: Option<u16>,
    /// Instructions in the patient's language.
    pub instructions: Option<String>,
}

/// A safety alert.
#[derive(Debug, Serialize, ToSchema)]
pub struct Alert {
    /// The medicine's line.
    pub line_no: Option<i16>,
    /// `allergy`.
    pub kind: String,
    /// `info`, `caution` or `serious`.
    pub severity: String,
    /// What the doctor is told.
    pub message: String,
    /// `overridden` once issued; absent while asking.
    pub action: Option<String>,
    /// The doctor's reason.
    pub override_reason: Option<String>,
}

impl From<AlertView> for Alert {
    fn from(a: AlertView) -> Self {
        Self {
            line_no: a.line_no,
            kind: a.kind,
            severity: a.severity,
            message: a.message,
            action: a.action,
            override_reason: a.override_reason,
        }
    }
}

/// What the paper shows besides the medicines.
#[derive(Debug, Serialize, ToSchema)]
pub struct PrintData {
    /// Clinic name, legal name, address, phone, brand colour.
    #[schema(value_type = Object)]
    pub letterhead: serde_json::Value,
    /// Doctor's name and registration number (null when not recorded).
    #[schema(value_type = Object)]
    pub doctor: serde_json::Value,
    /// Patient's name, number, age and sex at issue.
    #[schema(value_type = Object)]
    pub patient: serde_json::Value,
    /// The clinic's footer text.
    pub footer: Option<String>,
    /// `Prescribed with Aarogyam`, printed beside the QR code.
    pub brand_line: String,
    /// Path the QR code opens on the clinic's host.
    pub verify_path: String,
}

/// A prescription.
#[derive(Debug, Serialize, ToSchema)]
pub struct Prescription {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `RX-412`, once issued.
    pub number: Option<String>,
    /// The patient.
    pub patient: PatientRef,
    /// The visit.
    #[schema(value_type = Option<String>)]
    pub encounter_id: Option<Uuid>,
    /// `draft`, `issued` or `cancelled`.
    pub status: String,
    /// Diagnosis.
    pub diagnosis_text: Option<String>,
    /// Advice.
    pub advice: Option<String>,
    /// Follow-up date.
    pub follow_up_on: Option<String>,
    /// Language of the instructions.
    pub language: String,
    /// When issued.
    pub issued_at: Option<String>,
    /// Why alerts were overridden.
    pub override_reason: Option<String>,
    /// Why it was cancelled.
    pub cancel_reason: Option<String>,
    /// When it was cancelled.
    pub cancelled_at: Option<String>,
    /// The prescription it replaces.
    #[schema(value_type = Option<String>)]
    pub supersedes_id: Option<Uuid>,
    /// The prescription that replaces it.
    #[schema(value_type = Option<String>)]
    pub superseded_by: Option<Uuid>,
    /// When the draft was started.
    pub created_at: String,
    /// Medicines.
    pub items: Vec<RxItem>,
    /// Alerts recorded at issue.
    pub alerts: Vec<Alert>,
    /// Print data, once issued.
    pub print: Option<PrintData>,
}

impl From<RxView> for Prescription {
    fn from(v: RxView) -> Self {
        Self {
            id: v.id.uuid(),
            number: v.number,
            patient: v.patient.into(),
            encounter_id: v.encounter_id,
            status: v.status.as_str().to_owned(),
            diagnosis_text: v.diagnosis_text,
            advice: v.advice,
            follow_up_on: v.follow_up_on.map(|d| d.to_string()),
            language: v.language,
            issued_at: v.issued_at.map(rfc3339),
            override_reason: v.override_reason,
            cancel_reason: v.cancel_reason,
            cancelled_at: v.cancelled_at.map(rfc3339),
            supersedes_id: v.supersedes_id,
            superseded_by: v.superseded_by,
            created_at: rfc3339(v.created_at),
            items: v
                .items
                .into_iter()
                .map(|i| RxItem {
                    line_no: i.line_no,
                    drug_id: i.drug_id,
                    drug_name: Some(i.drug_name),
                    strength: i.strength,
                    form: i.form,
                    dose: Some(i.dose),
                    frequency: Some(i.frequency),
                    timing: i.timing,
                    duration_days: i.duration_days.and_then(|d| u16::try_from(d).ok()),
                    instructions: i.instructions,
                })
                .collect(),
            alerts: v.alerts.into_iter().map(Alert::from).collect(),
            print: v.print.map(|p| PrintData {
                letterhead: p.letterhead,
                doctor: p.doctor,
                patient: p.recipient,
                footer: p.footer,
                brand_line: p.brand_line.to_owned(),
                verify_path: format!("/api/v1/verify/prescriptions/{}", p.verify_token),
            }),
        }
    }
}

/// Prescriptions.
#[derive(Debug, Serialize, ToSchema)]
pub struct PrescriptionList {
    /// Newest first.
    pub items: Vec<Prescription>,
}

/// A draft's values. On an edit, fields left out stay, an empty string clears text,
/// `encounter_id` or `follow_up_on`, and `items` replaces every medicine.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RxValues {
    /// The visit.
    pub encounter_id: Option<String>,
    /// Diagnosis.
    pub diagnosis_text: Option<String>,
    /// Advice: diet, care, warnings.
    pub advice: Option<String>,
    /// Follow-up date, `YYYY-MM-DD`.
    pub follow_up_on: Option<String>,
    /// Language, such as `hi-IN`; the patient's by default.
    pub language: Option<String>,
    /// Medicines.
    pub items: Option<Vec<RxItem>>,
}

fn rx_input(body: RxValues) -> Result<RxInput, ApiError> {
    let follow_up_on = match body.follow_up_on.as_deref().map(str::trim) {
        None => None,
        Some("") => Some(None),
        Some(text) => Some(Some(parse_day("follow_up_on", text)?)),
    };
    Ok(RxInput {
        encounter_id: body
            .encounter_id
            .map(|t| optional_uuid("encounter_id", &t))
            .transpose()?,
        diagnosis_text: body.diagnosis_text,
        advice: body.advice,
        follow_up_on,
        language: body.language,
        items: body.items.map(|items| {
            items
                .into_iter()
                .map(|i| RxItemInput {
                    drug_id: i.drug_id,
                    drug_name: i.drug_name,
                    strength: i.strength,
                    form: i.form,
                    dose: i.dose,
                    frequency: i.frequency,
                    timing: i.timing,
                    duration_days: i.duration_days,
                    instructions: i.instructions,
                })
                .collect()
        }),
    })
}

/// Starts a draft prescription for a patient.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/prescriptions",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The patient")),
    request_body = RxValues,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Prescription),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RxValues>,
) -> Result<(StatusCode, Json<Prescription>), ApiFailure> {
    let view = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        rx_input(body)?,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// A patient's prescriptions, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/prescriptions",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PrescriptionList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn for_patient(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PrescriptionList>, ApiFailure> {
    let rows = app::for_patient(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        false,
    )
    .await?;
    Ok(Json(PrescriptionList {
        items: rows.into_iter().map(Prescription::from).collect(),
    }))
}

/// The patient's last issued prescription, for Quick Rx (repeat it as a new draft).
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/prescriptions/last",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Prescription),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient, or no issued prescription yet")
    )
)]
pub(crate) async fn last(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Prescription>, ApiFailure> {
    let rows = app::for_patient(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        true,
    )
    .await?;
    let view = rows
        .into_iter()
        .next()
        .ok_or_else(|| ApiFailure(ApiError::not_found("not_found", "Not found.")))?;
    Ok(Json(view.into()))
}

/// Edits a draft. Issued prescriptions never change.
#[utoipa::path(
    patch,
    path = "/api/v1/prescriptions/{id}",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The prescription")),
    request_body = RxValues,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Prescription),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 404, description = "No such prescription in this clinic"),
        (status = 409, description = "Issued or cancelled")
    )
)]
pub(crate) async fn edit(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RxValues>,
) -> Result<Json<Prescription>, ApiFailure> {
    let view = app::edit(
        state.db(),
        &request.actor,
        request.request_id,
        PrescriptionId::from_uuid(id),
        rx_input(body)?,
    )
    .await?;
    Ok(Json(view.into()))
}

/// Opens a prescription with its print data. Writes the access record.
#[utoipa::path(
    get,
    path = "/api/v1/prescriptions/{id}",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The prescription")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Prescription),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such prescription in this clinic")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Prescription>, ApiFailure> {
    let view = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        PrescriptionId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Issuing a prescription.
#[derive(Debug, Deserialize, ToSchema)]
pub struct IssueRequest {
    /// Why to go ahead despite the allergy alerts; needed only when there are alerts.
    pub override_reason: Option<String>,
}

/// The alerts that stopped an issue.
#[derive(Debug, Serialize, ToSchema)]
pub struct IssueBlocked {
    /// `allergy_alerts`.
    pub code: String,
    /// Send again with `override_reason` to issue anyway.
    pub alerts: Vec<Alert>,
}

/// Issues a draft: allergy check, number, print data, frozen. With alerts and no
/// `override_reason`, answers `409` with the alerts and changes nothing.
#[utoipa::path(
    post,
    path = "/api/v1/prescriptions/{id}/issue",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The prescription")),
    request_body = IssueRequest,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Prescription),
        (status = 400, description = "No medicines, or a bad reason"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 404, description = "No such prescription in this clinic"),
        (status = 409, body = IssueBlocked, description = "Allergy alerts need an override reason, or already issued")
    )
)]
pub(crate) async fn issue(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<IssueRequest>,
) -> Result<Response, ApiFailure> {
    let outcome = app::issue(
        state.db(),
        &request.actor,
        request.request_id,
        PrescriptionId::from_uuid(id),
        body.override_reason.as_deref(),
        state.allergies(),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(match outcome {
        IssueOutcome::Issued(view) => {
            if !view.alerts.is_empty() {
                tracing::info!(event = Event::PrescriptionAlertOverridden.as_str(), prescription_id = %id, "allergy alert overridden");
            }
            tracing::info!(event = Event::PrescriptionIssued.as_str(), prescription_id = %id, "prescription issued");
            Json(Prescription::from(*view)).into_response()
        }
        IssueOutcome::NeedsOverride(alerts) => (
            StatusCode::CONFLICT,
            Json(IssueBlocked {
                code: "allergy_alerts".into(),
                alerts: alerts.into_iter().map(Alert::from).collect(),
            }),
        )
            .into_response(),
    })
}

/// Cancelling a prescription.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CancelRequest {
    /// Why, 3 to 500 characters.
    pub reason: String,
    /// Start a corrected draft copied from it (default true).
    pub reissue: Option<bool>,
}

/// The cancelled prescription and its corrected draft.
#[derive(Debug, Serialize, ToSchema)]
pub struct Cancelled {
    /// The cancelled prescription.
    pub cancelled: Prescription,
    /// The new draft that supersedes it, when reissued.
    pub draft: Option<Prescription>,
}

/// Cancels an issued prescription with a reason and, by default, starts a corrected draft
/// copied from it.
#[utoipa::path(
    post,
    path = "/api/v1/prescriptions/{id}/cancel",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The prescription")),
    request_body = CancelRequest,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Cancelled),
        (status = 400, description = "No reason given"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 404, description = "No such prescription in this clinic"),
        (status = 409, description = "Not issued")
    )
)]
pub(crate) async fn cancel(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<CancelRequest>,
) -> Result<Json<Cancelled>, ApiFailure> {
    let (cancelled, draft) = app::cancel(
        state.db(),
        &request.actor,
        request.request_id,
        PrescriptionId::from_uuid(id),
        &body.reason,
        body.reissue.unwrap_or(true),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::PrescriptionCancelled.as_str(), prescription_id = %id, "prescription cancelled");
    Ok(Json(Cancelled {
        cancelled: cancelled.into(),
        draft: draft.map(Prescription::from),
    }))
}

/// A new patient link. The token and PIN are shown once.
#[derive(Debug, Serialize, ToSchema)]
pub struct ShareLink {
    /// The link's id.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Token for the link: `/shared/{token}` on the clinic's host.
    pub token: String,
    /// Six-digit PIN to print on the paper or tell the patient.
    pub pin: String,
    /// When it stops working (seven days).
    pub expires_at: String,
}

/// Makes a seven-day link for the patient to open the prescription with a PIN.
#[utoipa::path(
    post,
    path = "/api/v1/prescriptions/{id}/share",
    tag = "prescriptions",
    params(("id" = String, Path, description = "The prescription")),
    security(("bearer" = [])),
    responses(
        (status = 201, body = ShareLink),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks prescriptions.issue"),
        (status = 404, description = "No such prescription in this clinic"),
        (status = 409, description = "Not issued")
    )
)]
pub(crate) async fn create_share(
    State(state): State<AppState>,
    Require { request, .. }: Require<PrescriptionsIssue>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<(StatusCode, Json<ShareLink>), ApiFailure> {
    let link = share::create(
        state.db(),
        &request.actor,
        request.request_id,
        PrescriptionId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ShareLinkCreated.as_str(), share_link_id = %link.id.uuid(), "share link created");
    Ok((
        StatusCode::CREATED,
        Json(ShareLink {
            id: link.id.uuid(),
            token: link.token,
            pin: link.pin,
            expires_at: rfc3339(link.expires_at),
        }),
    ))
}

const fn state_name(state: LinkState) -> &'static str {
    match state {
        LinkState::Usable => "usable",
        LinkState::Expired => "expired",
        LinkState::Locked => "locked",
    }
}

/// What a link shows before its PIN: no patient data.
#[derive(Debug, Serialize, ToSchema)]
pub struct SharedPreview {
    /// The clinic's name.
    pub clinic_name: String,
    /// `prescription`.
    pub resource: String,
    /// `usable`, `expired` or `locked`.
    pub state: String,
    /// When it stops working.
    pub expires_at: String,
}

/// Public, no sign-in: whether a link exists and which clinic sent it.
#[utoipa::path(
    get,
    path = "/api/v1/shared/{token}",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    responses(
        (status = 200, body = SharedPreview),
        (status = 404, description = "No such link")
    )
)]
pub(crate) async fn shared_preview(
    State(state): State<AppState>,
    public: PublicClinic,
    ApiPath(token): ApiPath<String>,
) -> Result<Json<SharedPreview>, ApiFailure> {
    let preview = share::preview(
        state.db(),
        public.clinic_id,
        public.request_id,
        &token,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(SharedPreview {
        clinic_name: preview.clinic_name,
        resource: preview.resource,
        state: state_name(preview.state).to_owned(),
        expires_at: rfc3339(preview.expires_at),
    }))
}

/// The PIN.
#[derive(Debug, Deserialize, ToSchema)]
pub struct OpenRequest {
    /// The six digits printed on the paper.
    pub pin: String,
}

/// Public, no sign-in: opens the prescription with the PIN. Five wrong PINs lock the link.
/// Every open is written to the access record.
#[utoipa::path(
    post,
    path = "/api/v1/shared/{token}/open",
    tag = "public",
    params(("token" = String, Path, description = "The link's token")),
    request_body = OpenRequest,
    responses(
        (status = 200, body = Prescription),
        (status = 403, description = "Wrong PIN; the message says how many tries are left"),
        (status = 404, description = "No such link"),
        (status = 410, description = "Expired"),
        (status = 423, description = "Locked after too many wrong PINs")
    )
)]
pub(crate) async fn shared_open(
    State(state): State<AppState>,
    public: PublicClinic,
    ApiPath(token): ApiPath<String>,
    ApiJson(body): ApiJson<OpenRequest>,
) -> Result<Response, ApiFailure> {
    let outcome = share::open(
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
        OpenOutcome::Opened(view) => {
            tracing::info!(event = Event::ShareLinkOpened.as_str(), "share link opened");
            Json(Prescription::from(*view)).into_response()
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

/// What the QR code shows: never patient data.
#[derive(Debug, Serialize, ToSchema)]
pub struct Verification {
    /// `valid` or `cancelled`.
    pub status: String,
    /// The prescription number.
    pub number: Option<String>,
    /// The clinic day it was issued.
    pub issued_on: Option<String>,
    /// The clinic's name.
    pub clinic_name: String,
}

/// Public, no sign-in: the QR code's check that a prescription is genuine.
#[utoipa::path(
    get,
    path = "/api/v1/verify/prescriptions/{verify_token}",
    tag = "public",
    params(("verify_token" = String, Path, description = "The token in the QR code")),
    responses(
        (status = 200, body = Verification),
        (status = 404, description = "No such prescription")
    )
)]
pub(crate) async fn verify(
    State(state): State<AppState>,
    public: PublicClinic,
    ApiPath(token): ApiPath<String>,
) -> Result<Json<Verification>, ApiFailure> {
    let found = share::verify(state.db(), public.clinic_id, public.request_id, &token).await?;
    Ok(Json(Verification {
        status: if found.status == aarogyam_domain::prescription::RxStatus::Issued {
            "valid"
        } else {
            "cancelled"
        }
        .to_owned(),
        number: found.number,
        issued_on: found.issued_on.map(|d| d.to_string()),
        clinic_name: found.clinic_name,
    }))
}
