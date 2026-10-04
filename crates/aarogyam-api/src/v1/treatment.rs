//! Procedures and treatment plans.

use aarogyam_app::treatment::{
    self as app, PlanInput, PlanItemInput, PlanItemView, PlanView, ProcedureInput, ProcedureView,
    WorkInput, WorkView,
};
use aarogyam_domain::dental::Tooth;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{
    EncounterId, PatientId, ProcedureId, TreatmentPlanId, TreatmentPlanItemId,
};
use aarogyam_domain::permission::require::{ClinicalRead, ClinicalWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use sakalya_types::Paise;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::facts::Code;
use super::rfc3339;
use super::visits::{EnteredInError, Member};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

fn code_out(work: &WorkView) -> Option<Code> {
    work.code.as_ref().map(|(system, code)| Code {
        system: system.as_str().to_owned(),
        code: code.clone(),
    })
}

fn surfaces_out(work: &WorkView) -> Vec<String> {
    work.surfaces
        .iter()
        .map(|s| s.as_str().to_owned())
        .collect()
}

/// A procedure planned or done in a visit. Done procedures never change; a mistaken one is
/// marked `entered_in_error` with a reason.
#[derive(Debug, Serialize, ToSchema)]
pub struct Procedure {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The visit.
    #[schema(value_type = String)]
    pub visit_id: Uuid,
    /// The member who did it.
    pub clinician: Member,
    /// What was done.
    pub name: String,
    /// Optional code.
    pub code: Option<Code>,
    /// FDI tooth number.
    pub tooth: Option<u8>,
    /// Surfaces: `M`, `O`, `D`, `B`, `L`.
    pub surfaces: Vec<String>,
    /// `planned`, `done` or `entered_in_error`.
    pub status: String,
    /// When it was done (RFC 3339).
    pub performed_at: Option<String>,
    /// The fee in paise.
    pub price_paise: Option<i64>,
    /// The treatment plan item it carries out.
    #[schema(value_type = Option<String>)]
    pub plan_item_id: Option<Uuid>,
    /// A remark.
    pub note: Option<String>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// When it was recorded (RFC 3339).
    pub created_at: String,
}

impl From<ProcedureView> for Procedure {
    fn from(view: ProcedureView) -> Self {
        Self {
            id: view.id.uuid(),
            visit_id: view.visit_id.uuid(),
            clinician: view.clinician.into(),
            code: code_out(&view.work),
            tooth: view.work.tooth.map(Tooth::number),
            surfaces: surfaces_out(&view.work),
            name: view.work.name,
            status: view.status.as_str().to_owned(),
            performed_at: view.performed_at.map(rfc3339),
            price_paise: view.price.map(Paise::get),
            plan_item_id: view.plan_item_id.map(TreatmentPlanItemId::uuid),
            note: view.note,
            error_reason: view.error_reason,
            created_at: rfc3339(view.created_at),
        }
    }
}

/// A patient's procedures, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProcedureList {
    /// The procedures.
    pub items: Vec<Procedure>,
}

/// What is done and where.
#[derive(Debug, Deserialize, ToSchema, Default)]
pub struct WorkFields {
    /// What is done, 1 to 200 characters, such as "Composite filling".
    pub name: Option<String>,
    /// Optional code.
    pub code: Option<Code>,
    /// FDI tooth number: 11-48, or 51-85 for primary teeth.
    pub tooth: Option<i64>,
    /// Surfaces: `M`, `O`, `D`, `B`, `L`.
    #[serde(default)]
    pub surfaces: Vec<String>,
}

impl From<WorkFields> for WorkInput {
    fn from(fields: WorkFields) -> Self {
        Self {
            name: fields.name,
            code: fields.code.map(|code| aarogyam_app::facts::CodeInput {
                system: Some(code.system),
                code: Some(code.code),
            }),
            tooth: fields.tooth,
            surfaces: fields.surfaces,
        }
    }
}

/// A procedure to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewProcedure {
    /// What and where; taken from the plan item when left out.
    #[serde(flatten)]
    pub work: WorkFields,
    /// `done` (default) or `planned`.
    pub status: Option<String>,
    /// The fee in paise; the plan item's estimate when left out.
    pub price_paise: Option<i64>,
    /// An accepted treatment plan item this carries out; when done, the item is done too.
    #[schema(value_type = Option<String>)]
    pub plan_item_id: Option<Uuid>,
    /// A remark, up to 1,000 characters.
    pub note: Option<String>,
}

/// Records a procedure in an open visit.
#[utoipa::path(
    post,
    path = "/api/v1/visits/{id}/procedures",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    request_body = NewProcedure,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Procedure),
        (status = 400, description = "Invalid input, or a plan item of another patient"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such visit in this clinic"),
        (status = 409, description = "The visit is closed, or the plan item isn't accepted or already has a procedure")
    )
)]
pub(crate) async fn record_procedure(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewProcedure>,
) -> Result<(StatusCode, Json<Procedure>), ApiFailure> {
    let view = app::record_procedure(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        ProcedureInput {
            work: body.work.into(),
            status: body.status,
            price_paise: body.price_paise,
            plan_item_id: body.plan_item_id,
            note: body.note,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    if view.performed_at.is_some() {
        tracing::info!(event = Event::ProcedureCompleted.as_str(), procedure_id = %view.id.uuid(), "procedure done");
    }
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// A patient's procedures, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/procedures",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ProcedureList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn procedures(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ProcedureList>, ApiFailure> {
    let rows = app::procedures(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(ProcedureList {
        items: rows.into_iter().map(Procedure::from).collect(),
    }))
}

/// Marks a planned procedure done; its plan item, if any, is done too.
#[utoipa::path(
    post,
    path = "/api/v1/procedures/{id}/complete",
    tag = "clinical",
    params(("id" = String, Path, description = "The procedure")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Procedure),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such procedure in this clinic"),
        (status = 409, description = "Not planned")
    )
)]
pub(crate) async fn complete(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Procedure>, ApiFailure> {
    let view = app::complete_procedure(
        state.db(),
        &request.actor,
        request.request_id,
        ProcedureId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ProcedureCompleted.as_str(), procedure_id = %id, "procedure done");
    Ok(Json(view.into()))
}

/// Marks a procedure entered in error with a reason; its plan item is open again.
#[utoipa::path(
    post,
    path = "/api/v1/procedures/{id}/entered-in-error",
    tag = "clinical",
    params(("id" = String, Path, description = "The procedure")),
    request_body = EnteredInError,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Procedure),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such procedure in this clinic"),
        (status = 409, description = "Already marked")
    )
)]
pub(crate) async fn procedure_in_error(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<EnteredInError>,
) -> Result<Json<Procedure>, ApiFailure> {
    let view = app::mark_procedure_in_error(
        state.db(),
        &request.actor,
        request.request_id,
        ProcedureId::from_uuid(id),
        &body.reason,
    )
    .await?;
    tracing::info!(event = Event::RecordRetracted.as_str(), procedure_id = %id, "procedure entered in error");
    Ok(Json(view.into()))
}

/// A step of a treatment plan.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlanItem {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// What is to be done.
    pub name: String,
    /// Optional code.
    pub code: Option<Code>,
    /// FDI tooth number.
    pub tooth: Option<u8>,
    /// Surfaces: `M`, `O`, `D`, `B`, `L`.
    pub surfaces: Vec<String>,
    /// Phase, from 1.
    pub phase: i16,
    /// Estimated cost in paise.
    pub estimate_paise: i64,
    /// `proposed`, `accepted`, `done` or `cancelled`.
    pub status: String,
    /// The procedure carrying it out.
    #[schema(value_type = Option<String>)]
    pub procedure_id: Option<Uuid>,
}

impl From<PlanItemView> for PlanItem {
    fn from(view: PlanItemView) -> Self {
        Self {
            id: view.id.uuid(),
            code: code_out(&view.work),
            tooth: view.work.tooth.map(Tooth::number),
            surfaces: surfaces_out(&view.work),
            name: view.work.name,
            phase: view.phase,
            estimate_paise: view.estimate.get(),
            status: view.status.as_str().to_owned(),
            procedure_id: view.procedure_id.map(ProcedureId::uuid),
        }
    }
}

/// A treatment plan with its estimate.
#[derive(Debug, Serialize, ToSchema)]
pub struct Plan {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The patient.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// The visit it was proposed in.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// The member who proposed it.
    pub clinician: Member,
    /// Its title.
    pub title: String,
    /// `proposed`, `accepted`, `in_progress`, `completed` or `declined`.
    pub status: String,
    /// When the patient accepted it (RFC 3339).
    pub accepted_at: Option<String>,
    /// When it was proposed (RFC 3339).
    pub created_at: String,
    /// The sum of the items that aren't cancelled, in paise.
    pub estimate_paise: i64,
    /// Its items, by phase.
    pub items: Vec<PlanItem>,
}

impl From<PlanView> for Plan {
    fn from(view: PlanView) -> Self {
        Self {
            id: view.id.uuid(),
            patient_id: view.patient_id.uuid(),
            visit_id: view.visit_id.map(EncounterId::uuid),
            clinician: view.clinician.into(),
            title: view.title,
            status: view.status.as_str().to_owned(),
            accepted_at: view.accepted_at.map(rfc3339),
            created_at: rfc3339(view.created_at),
            estimate_paise: view.estimate.get(),
            items: view.items.into_iter().map(PlanItem::from).collect(),
        }
    }
}

/// A patient's treatment plans, newest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlanList {
    /// The plans.
    pub items: Vec<Plan>,
}

/// A plan item to propose.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewPlanItem {
    /// What and where; `name` is required.
    #[serde(flatten)]
    pub work: WorkFields,
    /// Estimated cost in paise.
    pub estimate_paise: i64,
    /// Phase, 1 (default) to 20.
    pub phase: Option<i16>,
}

/// A treatment plan to propose.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewPlan {
    /// Its title, 1 to 200 characters.
    pub title: String,
    /// The visit it is proposed in.
    #[schema(value_type = Option<String>)]
    pub visit_id: Option<Uuid>,
    /// 1 to 50 items.
    pub items: Vec<NewPlanItem>,
}

/// Proposes a treatment plan with an estimate per item.
#[utoipa::path(
    post,
    path = "/api/v1/patients/{id}/treatment-plans",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    request_body = NewPlan,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Plan),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn create_plan(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewPlan>,
) -> Result<(StatusCode, Json<Plan>), ApiFailure> {
    let input = PlanInput {
        title: body.title,
        visit_id: body.visit_id,
        items: body
            .items
            .into_iter()
            .map(|item| PlanItemInput {
                work: item.work.into(),
                estimate_paise: item.estimate_paise,
                phase: item.phase,
            })
            .collect(),
    };
    let view = app::create_plan(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
        input,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// A patient's treatment plans, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/treatment-plans",
    tag = "clinical",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PlanList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such patient in this clinic")
    )
)]
pub(crate) async fn plans(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PlanList>, ApiFailure> {
    let rows = app::plans(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(PlanList {
        items: rows.into_iter().map(Plan::from).collect(),
    }))
}

/// Which items the patient accepted.
#[derive(Debug, Deserialize, ToSchema, Default)]
pub struct Acceptance {
    /// The accepted items; every proposed item when left out. The others are cancelled.
    #[schema(value_type = Option<Vec<String>>)]
    pub item_ids: Option<Vec<Uuid>>,
}

/// Records the patient's acceptance of a proposed plan.
#[utoipa::path(
    post,
    path = "/api/v1/treatment-plans/{id}/accept",
    tag = "clinical",
    params(("id" = String, Path, description = "The treatment plan")),
    request_body = Acceptance,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Plan),
        (status = 400, description = "A chosen item isn't a proposed item of this plan"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.write"),
        (status = 404, description = "No such plan in this clinic"),
        (status = 409, description = "The plan isn't proposed")
    )
)]
pub(crate) async fn accept_plan(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<Acceptance>,
) -> Result<Json<Plan>, ApiFailure> {
    let view = app::accept_plan(
        state.db(),
        &request.actor,
        request.request_id,
        TreatmentPlanId::from_uuid(id),
        body.item_ids,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::TreatmentPlanAccepted.as_str(), plan_id = %id, "treatment plan accepted");
    Ok(Json(view.into()))
}
