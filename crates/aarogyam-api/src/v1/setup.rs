//! First-run setup: the owner's short wizard (`settings.manage`) and each member's own
//! one-screen version (their own record; no permission beyond being a member), including a
//! doctor's own qualifications, registration number and working hours.

use aarogyam_app::schedule::{self as schedule, ShiftInput};
use aarogyam_app::setup::{self as app, SetupChanges, SetupView};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::BranchId;
use aarogyam_domain::permission::require::SettingsManage;
use aarogyam_domain::setup::StepStatus;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::schedule::{Practitioner, PractitionerFields, WorkingHours, WorkingShift};
use super::{bad, parse_clock, parse_id};
use crate::AppState;
use crate::extract::{ClinicRequest, Require};
use crate::failure::{ApiFailure, not_found};

/// One step of a setup.
#[derive(Debug, Serialize, ToSchema)]
pub struct SetupStep {
    /// The step key: `clinic`, `hours`, `look`, `services` or `team` (the owner's), `profile`
    /// (a doctor's own).
    pub key: String,
    /// `done`, `skipped`, or `todo` while the person hasn't answered.
    pub status: String,
}

/// Where a first-run setup stands.
#[derive(Debug, Serialize, ToSchema)]
pub struct Setup {
    /// `new` (show the wizard), `in_progress` (show "Finish setting up"), `complete` or
    /// `dismissed`.
    pub standing: String,
    /// `solo`, `team` or `multi`, once the owner said (the clinic's setup only).
    pub practice: Option<String>,
    /// Every step in order.
    pub steps: Vec<SetupStep>,
}

impl From<SetupView> for Setup {
    fn from(view: SetupView) -> Self {
        Self {
            standing: view.standing.as_str().to_owned(),
            practice: view.practice,
            steps: view
                .steps
                .into_iter()
                .map(|(key, status)| SetupStep {
                    key,
                    status: status.map_or("todo", StepStatus::as_str).to_owned(),
                })
                .collect(),
        }
    }
}

/// An answer to one step, and other changes. Anything left out stays as it is.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SetupUpdate {
    /// The step to change.
    pub step: Option<String>,
    /// `done`, `skipped` or `todo` (reopens it). Needed with `step`.
    pub status: Option<String>,
    /// Close (`true`) or reopen (`false`) the "Finish setting up" card.
    pub dismissed: Option<bool>,
    /// `solo`, `team` or `multi` (the clinic's setup only).
    pub practice: Option<String>,
}

impl SetupUpdate {
    fn into_changes(self) -> Result<SetupChanges, ApiFailure> {
        let step = match (self.step, self.status.as_deref()) {
            (None, None) => None,
            (Some(key), Some("todo")) => Some((key, None)),
            (Some(key), Some(text)) => Some((
                key,
                Some(
                    StepStatus::parse(text)
                        .ok_or_else(|| bad("status", "must be done, skipped or todo"))?,
                ),
            )),
            _ => return Err(bad("step", "needs both a step and a status").into()),
        };
        Ok(SetupChanges {
            step,
            dismissed: self.dismissed,
            practice: self.practice,
        })
    }
}

fn logged() {
    tracing::info!(event = Event::SetupChanged.as_str(), "setup changed");
}

/// The clinic's first-run setup. Nothing is stored until the owner answers a step.
#[utoipa::path(
    get,
    path = "/api/v1/settings/onboarding",
    tag = "setup",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Setup),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn get_clinic(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<Setup>, ApiFailure> {
    let view = app::clinic(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(view.into()))
}

/// Answers a step of the clinic's setup, closes the card, or says how the clinic practises.
#[utoipa::path(
    patch,
    path = "/api/v1/settings/onboarding",
    tag = "setup",
    request_body = SetupUpdate,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Setup),
        (status = 400, description = "Unknown step, status or practice"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn update_clinic(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<SetupUpdate>,
) -> Result<Json<Setup>, ApiFailure> {
    let view = app::change_clinic(
        state.db(),
        &request.actor,
        request.request_id,
        body.into_changes()?,
    )
    .await?;
    logged();
    Ok(Json(view.into()))
}

/// The signed-in member's own setup (a doctor's one screen).
#[utoipa::path(
    get,
    path = "/api/v1/me/onboarding",
    tag = "setup",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Setup),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn get_mine(
    State(state): State<AppState>,
    request: ClinicRequest,
) -> Result<Json<Setup>, ApiFailure> {
    let view = app::mine(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(view.into()))
}

/// Answers the member's own step or closes their card.
#[utoipa::path(
    patch,
    path = "/api/v1/me/onboarding",
    tag = "setup",
    request_body = SetupUpdate,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Setup),
        (status = 400, description = "Unknown step or status"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn update_mine(
    State(state): State<AppState>,
    request: ClinicRequest,
    ApiJson(body): ApiJson<SetupUpdate>,
) -> Result<Json<Setup>, ApiFailure> {
    let view = app::change_mine(
        state.db(),
        &request.actor,
        request.request_id,
        body.into_changes()?,
    )
    .await?;
    logged();
    Ok(Json(view.into()))
}

/// The doctor record linked to the signed-in member.
#[utoipa::path(
    get,
    path = "/api/v1/me/practitioner",
    tag = "setup",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Practitioner),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, a member of it, or not a doctor here")
    )
)]
pub(crate) async fn my_practitioner(
    State(state): State<AppState>,
    request: ClinicRequest,
) -> Result<Json<Practitioner>, ApiFailure> {
    let row = schedule::my_practitioner(state.db(), &request.actor, request.request_id)
        .await?
        .ok_or_else(|| ApiFailure(not_found()))?;
    Ok(Json(row.into()))
}

/// Changes the member's own doctor details: name, qualifications, registration number and
/// specialty. Colour, availability and the link to the member are ignored.
#[utoipa::path(
    patch,
    path = "/api/v1/me/practitioner",
    tag = "setup",
    request_body = PractitionerFields,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Practitioner),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, a member of it, or not a doctor here")
    )
)]
pub(crate) async fn update_my_practitioner(
    State(state): State<AppState>,
    request: ClinicRequest,
    ApiJson(body): ApiJson<PractitionerFields>,
) -> Result<Json<Practitioner>, ApiFailure> {
    let row = schedule::change_my_practitioner(
        state.db(),
        &request.actor,
        request.request_id,
        body.into_input()?,
    )
    .await?;
    logged();
    Ok(Json(row.into()))
}

/// The signed-in doctor's weekly hours.
#[utoipa::path(
    get,
    path = "/api/v1/me/working-hours",
    tag = "setup",
    security(("bearer" = [])),
    responses(
        (status = 200, body = WorkingHours),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, a member of it, or not a doctor here")
    )
)]
pub(crate) async fn my_hours(
    State(state): State<AppState>,
    request: ClinicRequest,
) -> Result<Json<WorkingHours>, ApiFailure> {
    let rows = schedule::my_hours(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(WorkingHours {
        shifts: rows.into_iter().map(WorkingShift::from).collect(),
    }))
}

/// Replaces the signed-in doctor's weekly hours. An empty list clears them.
#[utoipa::path(
    put,
    path = "/api/v1/me/working-hours",
    tag = "setup",
    request_body = WorkingHours,
    security(("bearer" = [])),
    responses(
        (status = 200, body = WorkingHours),
        (status = 400, description = "Bad or overlapping shifts"),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, a member of it, or not a doctor here")
    )
)]
pub(crate) async fn set_my_hours(
    State(state): State<AppState>,
    request: ClinicRequest,
    ApiJson(body): ApiJson<WorkingHours>,
) -> Result<Json<WorkingHours>, ApiFailure> {
    let mut shifts = Vec::with_capacity(body.shifts.len());
    for shift in body.shifts {
        shifts.push(ShiftInput {
            weekday: shift.weekday,
            starts: parse_clock("starts", &shift.starts)?,
            ends: parse_clock("ends", &shift.ends)?,
            branch_id: shift
                .branch_id
                .as_deref()
                .map(|text| parse_id("branch_id", text).map(BranchId::from_uuid))
                .transpose()?,
        });
    }
    let rows =
        schedule::set_my_hours(state.db(), &request.actor, request.request_id, shifts).await?;
    logged();
    Ok(Json(WorkingHours {
        shifts: rows.into_iter().map(WorkingShift::from).collect(),
    }))
}
