//! The clinic's staff-operations settings (time-off approval, task reminders).

use aarogyam_app::staff_ops as app;
use aarogyam_domain::event::Event;
use aarogyam_domain::permission::require::SettingsManage;
use aarogyam_domain::time_off::{StaffOpsChanges, StaffOpsSettings};
use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The routes of this module.
pub(crate) fn routes() -> Router<AppState> {
    Router::new().route(
        "/settings/staff-ops",
        get(get_settings).patch(update_settings),
    )
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths(get_settings, update_settings))]
pub(crate) struct Doc;

/// Whether staff time off needs approval, and how often open tasks are reminded.
#[derive(Debug, Serialize, ToSchema)]
pub struct StaffOpsSettingsBody {
    /// Time-off settings.
    pub time_off: TimeOffSettings,
    /// Task settings.
    pub tasks: TaskSettings,
}

/// Time-off settings.
#[derive(Debug, Serialize, ToSchema)]
pub struct TimeOffSettings {
    /// Whether a member's own request waits for the owner (default true). Time off the owner
    /// records for someone else is always approved at once.
    pub requires_approval: bool,
}

/// Task settings.
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskSettings {
    /// Minutes between reminders of a task still open, 15 to 1440 (default 60).
    pub remind_every_minutes: u16,
}

impl From<StaffOpsSettings> for StaffOpsSettingsBody {
    fn from(settings: StaffOpsSettings) -> Self {
        Self {
            time_off: TimeOffSettings {
                requires_approval: settings.time_off_requires_approval,
            },
            tasks: TaskSettings {
                remind_every_minutes: settings.tasks_remind_every_minutes,
            },
        }
    }
}

/// Changes to the time-off settings; what is left out stays.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TimeOffSettingsChanges {
    /// Whether a member's own request waits for the owner.
    pub requires_approval: Option<bool>,
}

/// Changes to the task settings; what is left out stays.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskSettingsChanges {
    /// Minutes between reminders, 15 to 1440.
    pub remind_every_minutes: Option<i64>,
}

/// Changes to the staff-operations settings; what is left out stays.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StaffOpsSettingsChanges {
    /// Time-off settings.
    pub time_off: Option<TimeOffSettingsChanges>,
    /// Task settings.
    pub tasks: Option<TaskSettingsChanges>,
}

/// The clinic's staff-operations settings.
#[utoipa::path(
    get,
    path = "/api/v1/settings/staff-ops",
    operation_id = "getStaffOpsSettings",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = StaffOpsSettingsBody),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<StaffOpsSettingsBody>, ApiFailure> {
    let settings = app::settings(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(settings.into()))
}

/// Changes the staff-operations settings. The change history records each change.
#[utoipa::path(
    patch,
    path = "/api/v1/settings/staff-ops",
    operation_id = "updateStaffOpsSettings",
    tag = "settings",
    request_body = StaffOpsSettingsChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = StaffOpsSettingsBody),
        (status = 400, description = "Invalid input; the message names the setting"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn update_settings(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<StaffOpsSettingsChanges>,
) -> Result<Json<StaffOpsSettingsBody>, ApiFailure> {
    let changes = StaffOpsChanges {
        time_off_requires_approval: body
            .time_off
            .and_then(|time_off| time_off.requires_approval),
        tasks_remind_every_minutes: body.tasks.and_then(|tasks| tasks.remind_every_minutes),
    };
    let settings =
        app::update_settings(state.db(), &request.actor, request.request_id, changes).await?;
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        "staff operations settings changed"
    );
    Ok(Json(settings.into()))
}
