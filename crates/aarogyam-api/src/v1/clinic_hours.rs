//! The clinic's opening hours per branch.

use aarogyam_app::clinic_hours as app;
use aarogyam_dal::clinic_hours::OpeningRow;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::BranchId;
use aarogyam_domain::permission::require::{AppointmentsRead, SettingsManage};
use aarogyam_domain::schedule::Shift;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{bad, clock, parse_clock, parse_id};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A stretch of the week the clinic is open.
#[derive(Debug, Serialize, ToSchema)]
pub struct OpeningShift {
    /// The branch.
    pub branch_id: String,
    /// 1 Monday to 7 Sunday.
    pub weekday: u8,
    /// Opening time, `HH:MM`.
    pub starts: String,
    /// Closing time, `HH:MM`.
    pub ends: String,
}

impl From<OpeningRow> for OpeningShift {
    fn from(row: OpeningRow) -> Self {
        Self {
            branch_id: row.branch_id.to_string(),
            weekday: u8::try_from(row.weekday).unwrap_or_default(),
            starts: clock(row.starts),
            ends: clock(row.ends),
        }
    }
}

/// The clinic's opening hours.
#[derive(Debug, Serialize, ToSchema)]
pub struct ClinicHours {
    /// By branch, weekday and start; split shifts are two entries. Empty when not set.
    pub shifts: Vec<OpeningShift>,
}

/// One opening shift to save.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct OpeningTime {
    /// 1 Monday to 7 Sunday.
    pub weekday: u8,
    /// Opening time, `HH:MM`.
    pub starts: String,
    /// Closing time, `HH:MM`, after the opening time.
    pub ends: String,
}

/// A branch's new week.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ClinicHoursChange {
    /// Branch; the default branch when left out.
    pub branch_id: Option<String>,
    /// Shifts, at most 28, none overlapping on a day. Empty clears the branch's hours.
    pub shifts: Vec<OpeningTime>,
}

/// The clinic's opening hours, every branch.
#[utoipa::path(
    get,
    path = "/api/v1/clinic-hours",
    operation_id = "getClinicHours",
    tag = "schedule",
    security(("bearer" = [])),
    responses(
        (status = 200, body = ClinicHours),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks appointments.read")
    )
)]
pub(crate) async fn hours(
    State(state): State<AppState>,
    Require { request, .. }: Require<AppointmentsRead>,
) -> Result<Json<ClinicHours>, ApiFailure> {
    let rows = app::hours(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(ClinicHours {
        shifts: rows.into_iter().map(OpeningShift::from).collect(),
    }))
}

/// Replaces one branch's opening hours and returns them. The Analytics page counts chair
/// utilization against them; without any it assumes nine hours a day.
#[utoipa::path(
    put,
    path = "/api/v1/clinic-hours",
    operation_id = "setClinicHours",
    tag = "schedule",
    request_body = ClinicHoursChange,
    security(("bearer" = [])),
    responses(
        (status = 200, body = ClinicHours),
        (status = 400, description = "Bad or overlapping shifts, or an unknown branch"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn set_hours(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<ClinicHoursChange>,
) -> Result<Json<ClinicHours>, ApiFailure> {
    let mut shifts = Vec::with_capacity(body.shifts.len());
    for shift in body.shifts {
        shifts.push(Shift {
            weekday: shift.weekday,
            starts: parse_clock("starts", &shift.starts)?,
            ends: parse_clock("ends", &shift.ends)?,
        });
    }
    let branch_id = match body.branch_id.as_deref() {
        None => None,
        Some("") => return Err(bad("branch_id", "must not be empty").into()),
        Some(text) => Some(BranchId::from_uuid(parse_id("branch_id", text)?)),
    };
    let rows = app::set_hours(
        state.db(),
        &request.actor,
        request.request_id,
        branch_id,
        shifts,
    )
    .await?;
    tracing::info!(
        event = Event::ScheduleSetupChanged.as_str(),
        what = "clinic_hours",
        shifts = rows.len(),
        "schedule setup changed"
    );
    Ok(Json(ClinicHours {
        shifts: rows.into_iter().map(OpeningShift::from).collect(),
    }))
}
