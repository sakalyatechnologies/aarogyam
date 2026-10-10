//! Lab orders (`labs.read`, `labs.write`): record, list, move, change and remind the lab.
//! Unit costs show and may be set only with `finance.view`.

use aarogyam_app::lab_orders::{
    self as app, DetailsInput, EventView, ItemInput, LabOrderView, ListFilter, NewOrderInput,
    StatusInput,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{
    EncounterId, LabContactId, LabOrderId, LabVendorId, MembershipId, PatientId, ProcedureId,
};
use aarogyam_domain::lab::{LabOrderStatus, LabPipeline};
use aarogyam_domain::permission::require::{LabsRead, LabsWrite};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use sakalya_types::Paise;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{optional_uuid, parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Where a lab order is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabOrderState {
    /// Being written; not at the lab yet.
    Draft,
    /// Handed to the lab.
    Sent,
    /// The lab is working on it.
    InProgress,
    /// Back from the lab.
    Received,
    /// Fitted.
    Fitted,
    /// Sent back to be made again; the remake is a new order.
    ReturnedForRework,
    /// Called off.
    Cancelled,
}

impl From<LabOrderStatus> for LabOrderState {
    fn from(status: LabOrderStatus) -> Self {
        match status {
            LabOrderStatus::Draft => Self::Draft,
            LabOrderStatus::Sent => Self::Sent,
            LabOrderStatus::InProgress => Self::InProgress,
            LabOrderStatus::Received => Self::Received,
            LabOrderStatus::Fitted => Self::Fitted,
            LabOrderStatus::ReturnedForRework => Self::ReturnedForRework,
            LabOrderStatus::Cancelled => Self::Cancelled,
        }
    }
}

impl From<LabOrderState> for LabOrderStatus {
    fn from(state: LabOrderState) -> Self {
        match state {
            LabOrderState::Draft => Self::Draft,
            LabOrderState::Sent => Self::Sent,
            LabOrderState::InProgress => Self::InProgress,
            LabOrderState::Received => Self::Received,
            LabOrderState::Fitted => Self::Fitted,
            LabOrderState::ReturnedForRework => Self::ReturnedForRework,
            LabOrderState::Cancelled => Self::Cancelled,
        }
    }
}

/// Where an order stands for the front desk, derived from its status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LabPipelineStage {
    /// Written but not yet handed to the lab (a draft).
    ToSend,
    /// Handed to the lab.
    Sent,
    /// The lab is making it.
    InProgress,
    /// Back from the lab, waiting to be fitted.
    ReadyToFit,
    /// Fitted.
    Fitted,
    /// Sent back to be made again.
    Rework,
    /// Called off.
    Cancelled,
}

impl From<LabPipeline> for LabPipelineStage {
    fn from(stage: LabPipeline) -> Self {
        match stage {
            LabPipeline::ToSend => Self::ToSend,
            LabPipeline::Sent => Self::Sent,
            LabPipeline::InProgress => Self::InProgress,
            LabPipeline::ReadyToFit => Self::ReadyToFit,
            LabPipeline::Fitted => Self::Fitted,
            LabPipeline::Rework => Self::Rework,
            LabPipeline::Cancelled => Self::Cancelled,
        }
    }
}

/// An item on a lab order.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabOrderItem {
    /// Identifier, for `PATCH` and `DELETE /lab-order-items/{id}`.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Position, from 1.
    pub line_no: i16,
    /// What to make.
    pub work_type: String,
    /// FDI tooth numbers.
    pub teeth: Vec<i16>,
    /// Shade.
    pub shade: Option<String>,
    /// Material.
    pub material: Option<String>,
    /// How many.
    pub qty: i32,
    /// Paise for one; absent without `finance.view`.
    pub unit_cost_paise: Option<i64>,
}

/// Something that happened to a lab order.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabOrderEvent {
    /// created, `status_changed`, `stage_changed`, `due_changed`, reminded, `reminder_skipped`,
    /// overdue, contacted, `item_added`, `item_changed` or `item_removed`.
    pub kind: String,
    /// The status before a change.
    pub from_status: Option<LabOrderState>,
    /// The status after.
    pub to_status: Option<LabOrderState>,
    /// The stage.
    pub stage: Option<String>,
    /// The due date, `YYYY-MM-DD`.
    pub due_on: Option<String>,
    /// `due_soon`, `due_today` or manual, for a reminder.
    pub reminder: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// How the lab was contacted: call, whatsapp, email or visit (contacted only).
    pub channel: Option<String>,
    /// reached, `no_answer`, `promised_date` or other (contacted only).
    pub outcome: Option<String>,
    /// Who at the lab was contacted.
    #[schema(value_type = Option<String>)]
    pub contact_id: Option<Uuid>,
    /// The item's line, for an item change.
    pub line_no: Option<i16>,
    /// The membership; absent for the reminder job.
    #[schema(value_type = Option<String>)]
    pub actor_id: Option<Uuid>,
    /// When (RFC 3339).
    pub at: String,
}

impl From<EventView> for LabOrderEvent {
    fn from(view: EventView) -> Self {
        Self {
            kind: view.kind.as_str().to_owned(),
            from_status: view.from_status.map(Into::into),
            to_status: view.to_status.map(Into::into),
            stage: view.stage,
            due_on: view.due_on.map(|d| d.to_string()),
            reminder: view.reminder.map(|r| r.as_str().to_owned()),
            note: view.note,
            channel: view.channel.map(|c| c.as_str().to_owned()),
            outcome: view.outcome.map(|o| o.as_str().to_owned()),
            contact_id: view.contact_id.map(LabContactId::uuid),
            line_no: view.line_no,
            actor_id: view.actor_id.map(MembershipId::uuid),
            at: rfc3339(view.at),
        }
    }
}

/// A lab order.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabOrder {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `LAB-<n>`.
    pub number: String,
    /// The lab.
    #[schema(value_type = String)]
    pub vendor_id: Uuid,
    /// Its name.
    pub vendor_name: Option<String>,
    /// Who at the lab.
    #[schema(value_type = Option<String>)]
    pub contact_id: Option<Uuid>,
    /// Their name.
    pub contact_name: Option<String>,
    /// Their phone, E.164, for a dialler.
    pub contact_phone: Option<String>,
    /// Their email.
    pub contact_email: Option<String>,
    /// Whether they use `WhatsApp` on that phone.
    pub contact_whatsapp: bool,
    /// The lab's own phone, E.164, when no contact is named.
    pub vendor_phone: Option<String>,
    /// When a member last contacted the lab about it: the contact log or a manual reminder
    /// (RFC 3339).
    pub last_contacted_at: Option<String>,
    /// Who.
    #[schema(value_type = Option<String>)]
    pub last_contacted_by: Option<Uuid>,
    /// Their name.
    pub last_contacted_by_name: Option<String>,
    /// The patient.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// Their clinic number.
    pub patient_number: String,
    /// Their name (never sent to the lab).
    pub patient_name: String,
    /// The membership responsible.
    #[schema(value_type = String)]
    pub doctor_id: Uuid,
    /// Their name.
    pub doctor_name: Option<String>,
    /// The procedure it is for.
    #[schema(value_type = Option<String>)]
    pub procedure_id: Option<Uuid>,
    /// The visit it came from.
    #[schema(value_type = Option<String>)]
    pub encounter_id: Option<Uuid>,
    /// Where it is.
    pub status: LabOrderState,
    /// Where it stands for the front desk: a draft is `to_send`, work back from the lab is
    /// `ready_to_fit`; the rest follow the status.
    pub pipeline_stage: LabPipelineStage,
    /// Still at the lab after its due day (clinic time).
    pub late: bool,
    /// Whole days past the due day while late.
    pub days_late: Option<i64>,
    /// Where the work is between trials: wax try-in, framework trial, bisque.
    pub stage: Option<String>,
    /// Instructions for the lab.
    pub instructions: Option<String>,
    /// When it went to the lab (RFC 3339).
    pub sent_at: Option<String>,
    /// When it is due back, `YYYY-MM-DD`.
    pub due_on: Option<String>,
    /// When it came back (RFC 3339).
    pub received_at: Option<String>,
    /// The order this one remakes.
    #[schema(value_type = Option<String>)]
    pub rework_of_id: Option<Uuid>,
    /// When it was recorded (RFC 3339).
    pub created_at: String,
    /// Whether unit costs are filled (the caller has `finance.view`).
    pub costs_visible: bool,
    /// What to make.
    pub items: Vec<LabOrderItem>,
    /// What happened to it, oldest first; filled only when one order is read.
    pub events: Vec<LabOrderEvent>,
}

impl From<LabOrderView> for LabOrder {
    fn from(view: LabOrderView) -> Self {
        let (contact_id, contact_name) = view
            .contact
            .map_or((None, None), |(id, name)| (Some(id.uuid()), name));
        let (last_contacted_at, last_contacted_by, last_contacted_by_name) =
            view.last_contact.map_or((None, None, None), |last| {
                let (by, name) = last
                    .by
                    .map_or((None, None), |(id, name)| (Some(id.uuid()), name));
                (Some(rfc3339(last.at)), by, name)
            });
        Self {
            id: view.id.uuid(),
            number: view.number,
            vendor_id: view.vendor.0.uuid(),
            vendor_name: view.vendor.1,
            contact_id,
            contact_name,
            contact_phone: view.contact_reach.phone,
            contact_email: view.contact_reach.email,
            contact_whatsapp: view.contact_reach.whatsapp,
            vendor_phone: view.vendor_phone,
            last_contacted_at,
            last_contacted_by,
            last_contacted_by_name,
            patient_id: view.patient.0.uuid(),
            patient_number: view.patient.1,
            patient_name: view.patient.2,
            doctor_id: view.doctor.0.uuid(),
            doctor_name: view.doctor.1,
            procedure_id: view.procedure_id.map(ProcedureId::uuid),
            encounter_id: view.encounter_id.map(EncounterId::uuid),
            status: view.status.into(),
            pipeline_stage: view.pipeline.into(),
            late: view.late,
            days_late: view.days_late,
            stage: view.stage,
            instructions: view.instructions,
            sent_at: view.sent_at.map(rfc3339),
            due_on: view.due_on.map(|d| d.to_string()),
            received_at: view.received_at.map(rfc3339),
            rework_of_id: view.rework_of_id.map(LabOrderId::uuid),
            created_at: rfc3339(view.created_at),
            costs_visible: view.costs_visible,
            items: view
                .items
                .into_iter()
                .map(|i| LabOrderItem {
                    id: i.id.uuid(),
                    line_no: i.line_no,
                    work_type: i.work_type,
                    teeth: i.teeth,
                    shade: i.shade,
                    material: i.material,
                    qty: i.qty,
                    unit_cost_paise: i.unit_cost.map(Paise::get),
                })
                .collect(),
            events: view.events.into_iter().map(LabOrderEvent::from).collect(),
        }
    }
}

/// Lab orders.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabOrderList {
    /// Newest first.
    pub items: Vec<LabOrder>,
}

/// An item to make.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewLabOrderItem {
    /// What to make, such as `Crown`; up to 80 characters.
    pub work_type: String,
    /// FDI tooth numbers, each once, up to 32.
    #[serde(default)]
    pub teeth: Vec<i64>,
    /// Shade, such as `A2`; up to 20 characters.
    pub shade: Option<String>,
    /// Material, such as `zirconia`; up to 80 characters.
    pub material: Option<String>,
    /// How many, 1 to 100 (default 1).
    pub qty: Option<i32>,
    /// Paise for one, 0 to 10,00,000 rupees; needs `finance.view`.
    pub unit_cost_paise: Option<i64>,
}

/// A lab order to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewLabOrder {
    /// The lab.
    #[schema(value_type = String)]
    pub vendor_id: Uuid,
    /// Who at the lab.
    #[schema(value_type = Option<String>)]
    pub contact_id: Option<Uuid>,
    /// The patient.
    #[schema(value_type = String)]
    pub patient_id: Uuid,
    /// The membership responsible; the caller unless said.
    #[schema(value_type = Option<String>)]
    pub doctor_id: Option<Uuid>,
    /// The procedure it is for, of this patient.
    #[schema(value_type = Option<String>)]
    pub procedure_id: Option<Uuid>,
    /// The visit it came from, of this patient.
    #[schema(value_type = Option<String>)]
    pub encounter_id: Option<Uuid>,
    /// The order this one remakes, of this patient.
    #[schema(value_type = Option<String>)]
    pub rework_of_id: Option<Uuid>,
    /// Whether it goes to the lab now; otherwise it is a draft.
    #[serde(default)]
    pub send: bool,
    /// Stage, up to 80 characters.
    pub stage: Option<String>,
    /// Instructions for the lab, up to 2000 characters.
    pub instructions: Option<String>,
    /// When it is due back, `YYYY-MM-DD`.
    pub due_on: Option<String>,
    /// What to make: 1 to 50 items.
    pub items: Vec<NewLabOrderItem>,
}

/// A move to another status.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LabOrderStatusChange {
    /// The status to move to: draft to sent or cancelled; sent to `in_progress`, received or
    /// cancelled; `in_progress` to received or cancelled; received to fitted or
    /// `returned_for_rework`.
    pub status: LabOrderState,
    /// A new stage, up to 80 characters.
    pub stage: Option<String>,
    /// Why, up to 500 characters.
    pub note: Option<String>,
}

/// A change to a lab order's details. Fields left out stay; an empty string clears.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LabOrderChanges {
    /// Who at the lab: a contact of the order's lab.
    pub contact_id: Option<String>,
    /// Stage, up to 80 characters.
    pub stage: Option<String>,
    /// Instructions, up to 2000 characters.
    pub instructions: Option<String>,
    /// When it is due back, `YYYY-MM-DD`; a new date runs the reminders again.
    pub due_on: Option<String>,
}

/// A reminder queued to the lab.
#[derive(Debug, Serialize, ToSchema)]
pub struct LabReminderQueued {
    /// The outbox message.
    #[schema(value_type = String)]
    pub message_id: Uuid,
}

/// Filters for the lab order list.
#[derive(Debug, Deserialize)]
pub struct LabOrderParams {
    /// Only this status.
    pub status: Option<LabOrderState>,
    /// Only this lab.
    pub vendor_id: Option<String>,
    /// Only this patient.
    pub patient_id: Option<String>,
    /// Only work at the lab past its due date.
    pub overdue: Option<bool>,
    /// Only orders still needing something done (drafts, work at the lab, work waiting to be
    /// fitted), soonest due first. `1` or `true`.
    #[serde(default, deserialize_with = "flag")]
    pub open: Option<bool>,
    /// Most rows, 1 to 200 (default 200).
    pub limit: Option<i64>,
}

/// A flag sent as `1`, `0`, `true` or `false`.
fn flag<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<bool>, D::Error> {
    let text = Option::<String>::deserialize(deserializer)?;
    match text.as_deref() {
        None | Some("") => Ok(None),
        Some("1" | "true") => Ok(Some(true)),
        Some("0" | "false") => Ok(Some(false)),
        Some(_) => Err(serde::de::Error::custom("must be 1, 0, true or false")),
    }
}

/// Lab orders within reach, newest first; with `open`, the work still to do, soonest due first,
/// each with its derived `pipeline_stage` and `late` flag.
#[utoipa::path(
    get,
    path = "/api/v1/lab-orders",
    operation_id = "listLabOrders",
    tag = "labs",
    params(
        ("status" = Option<LabOrderState>, Query, description = "Only this status"),
        ("vendor_id" = Option<String>, Query, description = "Only this lab"),
        ("patient_id" = Option<String>, Query, description = "Only this patient"),
        ("overdue" = Option<bool>, Query, description = "Only work at the lab past its due date"),
        ("open" = Option<bool>, Query, description = "1 or true: only orders still needing something done, soonest due first"),
        ("limit" = Option<i64>, Query, description = "Most rows, 1 to 200 (default 200)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabOrderList),
        (status = 400, description = "A bad filter"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.read")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsRead>,
    ApiQuery(params): ApiQuery<LabOrderParams>,
) -> Result<Json<LabOrderList>, ApiFailure> {
    let vendor = optional_uuid("vendor_id", params.vendor_id.as_deref().unwrap_or(""))?;
    let patient = optional_uuid("patient_id", params.patient_id.as_deref().unwrap_or(""))?;
    let filter = ListFilter {
        status: params.status.map(Into::into),
        vendor_id: vendor.map(LabVendorId::from_uuid),
        patient_id: patient.map(PatientId::from_uuid),
        overdue: params.overdue.unwrap_or(false),
        open: params.open.unwrap_or(false),
    };
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        filter,
        params.limit.unwrap_or(app::MAX_LIST),
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(LabOrderList {
        items: rows.into_iter().map(LabOrder::from).collect(),
    }))
}

/// Records a lab order with its items, as a draft or sent to the lab now.
#[utoipa::path(
    post,
    path = "/api/v1/lab-orders",
    operation_id = "createLabOrder",
    tag = "labs",
    request_body = NewLabOrder,
    security(("bearer" = [])),
    responses(
        (status = 201, body = LabOrder),
        (status = 400, description = "Invalid values or references"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write, or finance.view for costs"),
        (status = 404, description = "No such patient in this clinic or within reach")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiJson(body): ApiJson<NewLabOrder>,
) -> Result<(StatusCode, Json<LabOrder>), ApiFailure> {
    let due_on = body
        .due_on
        .as_deref()
        .map(|t| parse_day("due_on", t))
        .transpose()?;
    let input = NewOrderInput {
        vendor_id: LabVendorId::from_uuid(body.vendor_id),
        contact_id: body.contact_id.map(LabContactId::from_uuid),
        patient_id: PatientId::from_uuid(body.patient_id),
        doctor_id: body.doctor_id.map(MembershipId::from_uuid),
        procedure_id: body.procedure_id.map(ProcedureId::from_uuid),
        encounter_id: body.encounter_id.map(EncounterId::from_uuid),
        rework_of_id: body.rework_of_id.map(LabOrderId::from_uuid),
        send: body.send,
        stage: body.stage,
        instructions: body.instructions,
        due_on,
        items: body
            .items
            .into_iter()
            .map(|i| ItemInput {
                work_type: i.work_type,
                teeth: i.teeth,
                shade: i.shade,
                material: i.material,
                qty: i.qty,
                unit_cost: i.unit_cost_paise.map(Paise::new),
            })
            .collect(),
    };
    let view = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::LabOrderCreated.as_str(), lab_order_id = %view.id.uuid(), "lab order created");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// One lab order within reach, with its history.
#[utoipa::path(
    get,
    path = "/api/v1/lab-orders/{id}",
    operation_id = "getLabOrder",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabOrder),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.read"),
        (status = 404, description = "No such lab order in this clinic or within reach")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<LabOrder>, ApiFailure> {
    let view = app::get(
        state.db(),
        &request.actor,
        request.request_id,
        LabOrderId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Changes a lab order's contact, stage, instructions or due date.
#[utoipa::path(
    patch,
    path = "/api/v1/lab-orders/{id}",
    operation_id = "updateLabOrder",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order")),
    request_body = LabOrderChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabOrder),
        (status = 400, description = "Invalid values, or a contact at another lab"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such lab order in this clinic or within reach"),
        (status = 409, description = "The order is fitted, reworked or cancelled")
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LabOrderChanges>,
) -> Result<Json<LabOrder>, ApiFailure> {
    let contact_id = body
        .contact_id
        .as_deref()
        .map(|t| optional_uuid("contact_id", t).map(|id| id.map(LabContactId::from_uuid)))
        .transpose()?;
    let due_on = body
        .due_on
        .as_deref()
        .map(|t| {
            if t.trim().is_empty() {
                Ok(None)
            } else {
                parse_day("due_on", t).map(Some)
            }
        })
        .transpose()?;
    let input = DetailsInput {
        contact_id,
        stage: body.stage,
        instructions: body.instructions,
        due_on,
    };
    let view = app::update(
        state.db(),
        &request.actor,
        request.request_id,
        LabOrderId::from_uuid(id),
        input,
    )
    .await?;
    tracing::info!(event = Event::LabOrderUpdated.as_str(), lab_order_id = %id, "lab order changed");
    Ok(Json(view.into()))
}

/// Moves a lab order to another status, optionally with a new stage and a note.
#[utoipa::path(
    post,
    path = "/api/v1/lab-orders/{id}/status",
    operation_id = "setLabOrderStatus",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order")),
    request_body = LabOrderStatusChange,
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabOrder),
        (status = 400, description = "A long stage or note"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such lab order in this clinic or within reach"),
        (status = 409, description = "The order's status doesn't allow that move")
    )
)]
pub(crate) async fn set_status(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<LabOrderStatusChange>,
) -> Result<Json<LabOrder>, ApiFailure> {
    let input = StatusInput {
        status: body.status.into(),
        stage: body.stage,
        note: body.note,
    };
    let view = app::set_status(
        state.db(),
        &request.actor,
        request.request_id,
        LabOrderId::from_uuid(id),
        &input,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::LabOrderUpdated.as_str(),
        lab_order_id = %id,
        status = view.status.as_str(),
        "lab order status changed"
    );
    Ok(Json(view.into()))
}

/// Emails the lab a reminder now, through the outbox. It names the clinic, the order number,
/// the work, teeth, shade and due date, never the patient.
#[utoipa::path(
    post,
    path = "/api/v1/lab-orders/{id}/remind",
    operation_id = "remindLab",
    tag = "labs",
    params(("id" = String, Path, description = "The lab order")),
    security(("bearer" = [])),
    responses(
        (status = 202, body = LabReminderQueued),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.write"),
        (status = 404, description = "No such lab order in this clinic or within reach"),
        (status = 409, description = "The work isn't at the lab, or the lab has no email")
    )
)]
pub(crate) async fn remind(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<(StatusCode, Json<LabReminderQueued>), ApiFailure> {
    let message = app::remind(
        state.db(),
        &request.actor,
        request.request_id,
        LabOrderId::from_uuid(id),
    )
    .await?;
    tracing::info!(
        event = Event::LabOrderReminded.as_str(),
        lab_order_id = %id,
        message_id = %message.uuid(),
        "lab reminded"
    );
    Ok((
        StatusCode::ACCEPTED,
        Json(LabReminderQueued {
            message_id: message.uuid(),
        }),
    ))
}

/// A patient's lab orders within reach, newest first.
#[utoipa::path(
    get,
    path = "/api/v1/patients/{id}/lab-orders",
    operation_id = "listPatientLabOrders",
    tag = "labs",
    params(("id" = String, Path, description = "The patient")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = LabOrderList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks labs.read"),
        (status = 404, description = "No such patient in this clinic or within reach")
    )
)]
pub(crate) async fn for_patient(
    State(state): State<AppState>,
    Require { request, .. }: Require<LabsRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<LabOrderList>, ApiFailure> {
    let rows = app::for_patient(
        state.db(),
        &request.actor,
        request.request_id,
        PatientId::from_uuid(id),
    )
    .await?;
    Ok(Json(LabOrderList {
        items: rows.into_iter().map(LabOrder::from).collect(),
    }))
}
