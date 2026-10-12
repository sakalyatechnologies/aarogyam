//! Recurring staff tasks: the to-do list (`GET /tasks/mine`) and finishing a task, and the
//! manager's screens for the tasks themselves, their next dates and the history.

use aarogyam_app::tasks::{
    self as app, AssigneeInput, CompleteInput, DueDate, HistoryFilter, NewTask, OccurrenceView,
    ScheduleInput, TaskChange, TemplateView, UsageLine,
};
use aarogyam_domain::ids::InventoryItemId;
use aarogyam_domain::permission::require::{TasksManage, TasksUse};
use aarogyam_domain::tasks::{OccurrenceStatus, ScheduleKind, TaskAction};
use axum::routing::{get, post};
use axum::{Json, Router, extract::State, http::StatusCode};
use sakalya_http::{ApiError, ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{OpenApi, ToSchema};
use uuid::Uuid;

use super::{bad, clock, optional_uuid, parse_clock, parse_day, parse_id, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The routes of this module.
pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/tasks/mine", get(mine))
        .route("/tasks/history", get(history))
        .route("/tasks", get(list).post(create))
        .route("/tasks/{id}", get(read).patch(update).delete(remove))
        .route("/tasks/{id}/preview", get(preview))
        .route("/tasks/occurrences/{id}/complete", post(complete))
        .route("/tasks/occurrences/{id}/reopen", post(reopen))
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths(
    mine, complete, reopen, list, create, read, update, remove, preview, history
))]
pub(crate) struct Doc;

// ------------------------------------------------------------------ occurrences

/// One day's run of a task.
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskOccurrence {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The task it came from.
    #[schema(value_type = String)]
    pub template_id: Uuid,
    /// The title.
    pub title: String,
    /// What finishing it asks of the person: `none`, `record_usage` (list the materials used)
    /// or `confirm_photos` (check the day's patients have their photos).
    pub action: String,
    /// The member it is for, when it is for one person.
    #[schema(value_type = Option<String>)]
    pub assignee_membership_id: Option<Uuid>,
    /// The role it is for: the first person holding it to finish it closes it for all.
    #[schema(value_type = Option<String>)]
    pub assignee_role_id: Option<Uuid>,
    /// The clinic's calendar day, `YYYY-MM-DD`.
    pub local_date: String,
    /// When it falls due, RFC 3339.
    pub due_at: String,
    /// `open`, `done`, `skipped` or `missed`.
    pub status: String,
    /// When it was finished, RFC 3339.
    pub completed_at: Option<String>,
    /// Who finished it.
    #[schema(value_type = Option<String>)]
    pub completed_by: Option<Uuid>,
    /// That person's name.
    pub completed_by_name: Option<String>,
    /// What they wrote.
    pub note: Option<String>,
    /// Only on a `confirm_photos` task: the patients seen that day with a visit that has no
    /// photo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patients_without_photos_today: Option<i64>,
}

impl From<OccurrenceView> for TaskOccurrence {
    fn from(view: OccurrenceView) -> Self {
        Self {
            id: view.id,
            template_id: view.template_id,
            title: view.title,
            action: view.action.as_str().to_owned(),
            assignee_membership_id: view.assignee_membership_id,
            assignee_role_id: view.assignee_role_id,
            local_date: view.local_date.to_string(),
            due_at: rfc3339(view.due_at),
            status: view.status.as_str().to_owned(),
            completed_at: view.completed_at.map(rfc3339),
            completed_by: view.completed_by,
            completed_by_name: view.completed_by_name,
            note: view.note,
            patients_without_photos_today: view.patients_without_photos_today,
        }
    }
}

/// A person's tasks for a day.
#[derive(Debug, Serialize, ToSchema)]
pub struct MyTasks {
    /// The clinic day, `YYYY-MM-DD`.
    pub date: String,
    /// Given to the caller or to their role, soonest first, plus any still open from earlier.
    pub items: Vec<TaskOccurrence>,
}

/// Query of `GET /tasks/mine`.
#[derive(Debug, Deserialize)]
pub struct MineParams {
    date: Option<String>,
}

/// The caller's tasks for a day: what is given to them or to their role, plus anything still
/// open from an earlier day.
#[utoipa::path(
    get,
    path = "/api/v1/tasks/mine",
    operation_id = "listMyTasks",
    tag = "tasks",
    params(("date" = Option<String>, Query, description = "The clinic day, YYYY-MM-DD; today by default")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = MyTasks),
        (status = 400, description = "A bad date"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.use")
    )
)]
pub(crate) async fn mine(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksUse>,
    ApiQuery(params): ApiQuery<MineParams>,
) -> Result<Json<MyTasks>, ApiFailure> {
    let date = params
        .date
        .as_deref()
        .filter(|text| !text.trim().is_empty())
        .map(|text| parse_day("date", text))
        .transpose()?;
    let mine = app::mine(
        state.db(),
        &request.actor,
        request.request_id,
        date,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(MyTasks {
        date: mine.date.to_string(),
        items: mine.items.into_iter().map(TaskOccurrence::from).collect(),
    }))
}

/// One line of materials used.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UsageBody {
    /// The stock item.
    pub item_id: String,
    /// Units used, 1 to 1000000.
    pub quantity: i64,
}

/// Finishing a task.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct CompleteBody {
    /// A note, at most 300 characters. The screen warns: no patient names.
    pub note: Option<String>,
    /// The materials used, taken off the shelf first-expiry-first-out, in the same step as
    /// finishing the task. Leave out or send an empty list for nothing used.
    pub usage: Option<Vec<UsageBody>>,
    /// An id the client made, so a retry after a lost answer is recognised. Finishing a task
    /// twice as the same person is harmless either way.
    #[schema(value_type = Option<String>)]
    pub client_id: Option<Uuid>,
}

/// Finishes an occurrence. The caller must be the person it is for or hold the role it is for;
/// the first to finish it closes it for everyone. Repeating it as the same person returns `200`
/// and changes nothing; anyone else then gets `409`. When materials are listed and the usable
/// stock is short, nothing is recorded and the task stays open.
#[utoipa::path(
    post,
    path = "/api/v1/tasks/occurrences/{id}/complete",
    operation_id = "completeTask",
    tag = "tasks",
    params(("id" = String, Path, description = "The occurrence")),
    request_body = CompleteBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = TaskOccurrence),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.use, or the task is for someone else"),
        (status = 404, description = "No such task in this clinic"),
        (status = 409, description = "Already done by someone else, no longer open, or not enough stock")
    )
)]
pub(crate) async fn complete(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksUse>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<CompleteBody>,
) -> Result<Json<TaskOccurrence>, ApiFailure> {
    let usage = body
        .usage
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|line| {
            Ok(UsageLine {
                item_id: InventoryItemId::from_uuid(parse_id("usage.item_id", &line.item_id)?),
                quantity: line.quantity,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let done = app::complete(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        CompleteInput {
            note: body.note.clone(),
            usage,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        occurrence_id = %id,
        client_id = ?body.client_id,
        already_done = done.already_done,
        "task completed"
    );
    Ok(Json(done.occurrence.into()))
}

/// Opens a done or skipped occurrence again, for a mistake. Stock already recorded for it stays
/// recorded.
#[utoipa::path(
    post,
    path = "/api/v1/tasks/occurrences/{id}/reopen",
    operation_id = "reopenTask",
    tag = "tasks",
    params(("id" = String, Path, description = "The occurrence")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = TaskOccurrence),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage"),
        (status = 404, description = "No such task in this clinic"),
        (status = 409, description = "The task was missed")
    )
)]
pub(crate) async fn reopen(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<TaskOccurrence>, ApiFailure> {
    let view = app::reopen(state.db(), &request.actor, request.request_id, id).await?;
    Ok(Json(view.into()))
}

// ------------------------------------------------------------------ templates

/// When a task falls due. Times are the clinic's local time.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct TaskSchedule {
    /// `once`, `daily`, `every_n_days` or `weekdays`.
    pub kind: Option<String>,
    /// `once`: the moment, RFC 3339.
    pub once_at: Option<String>,
    /// `every_n_days`: days between occurrences, 2 to 365.
    pub interval_days: Option<u16>,
    /// `weekdays`: the days, 1 (Monday) to 7 (Sunday).
    pub weekdays: Option<Vec<u8>>,
    /// The time of day, `HH:MM`.
    pub due_time: Option<String>,
    /// The first day, `YYYY-MM-DD`; today when left out on a new task.
    pub starts_on: Option<String>,
    /// The last day, `YYYY-MM-DD`.
    pub ends_on: Option<String>,
}

impl TaskSchedule {
    fn input(&self) -> Result<ScheduleInput, ApiError> {
        let weekdays = match &self.weekdays {
            None => None,
            Some(days) => {
                let mut mask = 0_u8;
                for day in days {
                    if !(1..=7).contains(day) {
                        return Err(bad("weekdays", "days are 1 (Monday) to 7 (Sunday)"));
                    }
                    mask |= 1 << (day - 1);
                }
                Some(mask)
            }
        };
        let day = |field: &str, text: &Option<String>| -> Result<_, ApiError> {
            text.as_deref()
                .filter(|text| !text.trim().is_empty())
                .map(|text| parse_day(field, text))
                .transpose()
        };
        Ok(ScheduleInput {
            kind: self
                .kind
                .as_deref()
                .map(|kind| {
                    ScheduleKind::parse(kind).map_err(|_| {
                        bad("schedule.kind", "is once, daily, every_n_days or weekdays")
                    })
                })
                .transpose()?,
            once_at: self
                .once_at
                .as_deref()
                .map(|text| parse_instant("once_at", text))
                .transpose()?,
            interval_days: self.interval_days,
            weekdays,
            due_time: self
                .due_time
                .as_deref()
                .map(|text| parse_clock("due_time", text))
                .transpose()?,
            starts_on: day("starts_on", &self.starts_on)?,
            ends_on: day("ends_on", &self.ends_on)?,
        })
    }
}

/// A task as the manager sees it.
#[derive(Debug, Serialize, ToSchema)]
pub struct Task {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// What is to be done.
    pub title: String,
    /// More detail.
    pub description: Option<String>,
    /// The member it is for, when it is for one person.
    #[schema(value_type = Option<String>)]
    pub assignee_membership_id: Option<Uuid>,
    /// That member's name.
    pub assignee_name: Option<String>,
    /// The role it is for.
    #[schema(value_type = Option<String>)]
    pub assignee_role_id: Option<Uuid>,
    /// That role's name.
    pub assignee_role_name: Option<String>,
    /// When it falls due.
    pub schedule: TaskSchedule,
    /// Minutes between reminders; none means the clinic's default.
    pub remind_every_minutes: Option<i32>,
    /// Reminders before the owner is told once more; 0 means never.
    pub escalate_after: i32,
    /// `none`, `record_usage` or `confirm_photos`.
    pub action: String,
    /// Whether occurrences are made from it. A standard task can only be switched off.
    pub active: bool,
    /// One of the standard tasks every clinic starts with; it cannot be deleted.
    pub is_default: bool,
    /// The standard task's key.
    pub default_key: Option<String>,
    /// When it was made, RFC 3339.
    pub created_at: String,
    /// When it last changed, RFC 3339.
    pub updated_at: String,
}

impl TryFrom<TemplateView> for Task {
    type Error = aarogyam_app::AppError;

    fn try_from(view: TemplateView) -> Result<Self, Self::Error> {
        let schedule = view.schedule()?;
        let columns = schedule.columns();
        let row = view.row;
        let weekdays = columns.weekdays.map(|mask| {
            (1_u8..=7)
                .filter(|day| mask & (1 << (day - 1)) != 0)
                .collect()
        });
        Ok(Self {
            id: row.id,
            title: row.title,
            description: row.description,
            assignee_membership_id: row.assignee_membership_id,
            assignee_name: row.assignee_name,
            assignee_role_id: row.assignee_role_id,
            assignee_role_name: row.assignee_role_name,
            schedule: TaskSchedule {
                kind: Some(columns.kind.as_str().to_owned()),
                once_at: columns.once_at.map(rfc3339),
                interval_days: columns.interval_days,
                weekdays,
                due_time: columns.due_time.map(clock),
                starts_on: columns.starts_on.map(|day| day.to_string()),
                ends_on: columns.ends_on.map(|day| day.to_string()),
            },
            remind_every_minutes: row.remind_every_minutes,
            escalate_after: row.escalate_after,
            action: row.action,
            active: row.active,
            is_default: row.is_default,
            default_key: row.default_key,
            created_at: rfc3339(row.created_at),
            updated_at: rfc3339(row.updated_at),
        })
    }
}

/// The clinic's tasks.
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskList {
    /// Switched-on first, then by title.
    pub items: Vec<Task>,
}

/// The clinic's recurring tasks, including the standard ones and any switched off.
#[utoipa::path(
    get,
    path = "/api/v1/tasks",
    operation_id = "listTasks",
    tag = "tasks",
    security(("bearer" = [])),
    responses(
        (status = 200, body = TaskList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
) -> Result<Json<TaskList>, ApiFailure> {
    let rows = app::templates(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(TaskList {
        items: rows
            .into_iter()
            .map(Task::try_from)
            .collect::<Result<_, _>>()?,
    }))
}

/// A task to make.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewTaskBody {
    /// What is to be done, 1 to 120 characters.
    pub title: String,
    /// More detail, at most 500 characters.
    pub description: Option<String>,
    /// The member it is for. Give this or `assignee_role_id`, not both.
    pub assignee_membership_id: Option<String>,
    /// The role it is for: the first person holding it to finish it closes it for all.
    pub assignee_role_id: Option<String>,
    /// When it falls due.
    pub schedule: TaskSchedule,
    /// Minutes between reminders, 15 to 1440; leave out for the clinic's default.
    pub remind_every_minutes: Option<u16>,
    /// Reminders before the owner is told once more, 0 to 24 (never at 0); 3 by default.
    pub escalate_after: Option<u8>,
    /// `none` (default), `record_usage` or `confirm_photos`.
    pub action: Option<String>,
    /// Switched on; true by default.
    pub active: Option<bool>,
}

fn assignee(membership: Option<&str>, role: Option<&str>) -> Result<AssigneeInput, ApiError> {
    Ok(AssigneeInput {
        membership_id: optional_uuid("assignee_membership_id", membership.unwrap_or(""))?,
        role_id: optional_uuid("assignee_role_id", role.unwrap_or(""))?,
    })
}

fn action(text: Option<&str>) -> Result<Option<TaskAction>, ApiError> {
    text.map(|text| {
        TaskAction::parse(text)
            .map_err(|_| bad("action", "is none, record_usage or confirm_photos"))
    })
    .transpose()
}

/// Makes a task.
#[utoipa::path(
    post,
    path = "/api/v1/tasks",
    operation_id = "createTask",
    tag = "tasks",
    request_body = NewTaskBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = Task),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
    ApiJson(body): ApiJson<NewTaskBody>,
) -> Result<(StatusCode, Json<Task>), ApiFailure> {
    let new = NewTask {
        title: body.title,
        description: body.description,
        assignee: assignee(
            body.assignee_membership_id.as_deref(),
            body.assignee_role_id.as_deref(),
        )?,
        schedule: body.schedule.input()?,
        remind_every_minutes: body.remind_every_minutes,
        escalate_after: body.escalate_after,
        action: action(body.action.as_deref())?,
        active: body.active,
    };
    let view = app::create_template(
        state.db(),
        &request.actor,
        request.request_id,
        new,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(view.try_into()?)))
}

/// One task.
#[utoipa::path(
    get,
    path = "/api/v1/tasks/{id}",
    operation_id = "getTask",
    tag = "tasks",
    params(("id" = String, Path, description = "The task")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Task),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage"),
        (status = 404, description = "No such task in this clinic")
    )
)]
pub(crate) async fn read(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Task>, ApiFailure> {
    let view = app::template(state.db(), &request.actor, request.request_id, id).await?;
    Ok(Json(view.try_into()?))
}

/// A change to a task. Fields left out stay as they are.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TaskChangeBody {
    /// Title.
    pub title: Option<String>,
    /// Description; an empty string clears it.
    pub description: Option<String>,
    /// A new member to give it to (replaces the old assignee).
    pub assignee_membership_id: Option<String>,
    /// A new role to give it to (replaces the old assignee).
    pub assignee_role_id: Option<String>,
    /// A new schedule, replacing the old one entirely.
    pub schedule: Option<TaskSchedule>,
    /// Minutes between reminders, 15 to 1440; 0 goes back to the clinic's default.
    pub remind_every_minutes: Option<u16>,
    /// Reminders before escalating, 0 to 24.
    pub escalate_after: Option<u8>,
    /// `none`, `record_usage` or `confirm_photos`.
    pub action: Option<String>,
    /// Switch on or off. Switching on, or changing the schedule, makes the task count from that
    /// moment.
    pub active: Option<bool>,
}

/// Changes a task.
#[utoipa::path(
    patch,
    path = "/api/v1/tasks/{id}",
    operation_id = "updateTask",
    tag = "tasks",
    params(("id" = String, Path, description = "The task")),
    request_body = TaskChangeBody,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Task),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage"),
        (status = 404, description = "No such task in this clinic")
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<TaskChangeBody>,
) -> Result<Json<Task>, ApiFailure> {
    let change = TaskChange {
        title: body.title,
        description: body.description,
        assignee: assignee(
            body.assignee_membership_id.as_deref(),
            body.assignee_role_id.as_deref(),
        )?,
        schedule: body
            .schedule
            .as_ref()
            .map(TaskSchedule::input)
            .transpose()?,
        remind_every_minutes: body.remind_every_minutes,
        escalate_after: body.escalate_after,
        action: action(body.action.as_deref())?,
        active: body.active,
    };
    let view = app::update_template(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        change,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(view.try_into()?))
}

/// Deletes a task. The days already made stay in the history. A standard task cannot be
/// deleted, only switched off with `active: false`.
#[utoipa::path(
    delete,
    path = "/api/v1/tasks/{id}",
    operation_id = "deleteTask",
    tag = "tasks",
    params(("id" = String, Path, description = "The task")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage"),
        (status = 404, description = "No such task in this clinic"),
        (status = 409, description = "A standard task cannot be deleted")
    )
)]
pub(crate) async fn remove(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete_template(state.db(), &request.actor, request.request_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A time a task falls due.
#[derive(Debug, Serialize, ToSchema)]
pub struct DueTime {
    /// The clinic's calendar day, `YYYY-MM-DD`.
    pub local_date: String,
    /// The moment, RFC 3339.
    pub due_at: String,
}

impl From<DueDate> for DueTime {
    fn from(due: DueDate) -> Self {
        Self {
            local_date: due.local_date.to_string(),
            due_at: rfc3339(due.due_at),
        }
    }
}

/// The next times a task falls due.
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskPreview {
    /// Up to five, soonest first; none for a task that is switched off or has ended.
    pub items: Vec<DueTime>,
}

/// The next five times a task falls due, worked out the way the generator does it.
#[utoipa::path(
    get,
    path = "/api/v1/tasks/{id}/preview",
    operation_id = "previewTask",
    tag = "tasks",
    params(("id" = String, Path, description = "The task")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = TaskPreview),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage"),
        (status = 404, description = "No such task in this clinic")
    )
)]
pub(crate) async fn preview(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<TaskPreview>, ApiFailure> {
    let items = app::preview(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(TaskPreview {
        items: items.into_iter().map(DueTime::from).collect(),
    }))
}

// ------------------------------------------------------------------ history

/// Query of `GET /tasks/history`.
#[derive(Debug, Deserialize)]
pub struct HistoryParams {
    from: Option<String>,
    to: Option<String>,
    assignee: Option<String>,
    status: Option<String>,
    template_id: Option<String>,
}

/// Past and open occurrences.
#[derive(Debug, Serialize, ToSchema)]
pub struct TaskHistory {
    /// Newest first, at most 500.
    pub items: Vec<TaskOccurrence>,
}

/// Occurrences by clinic day, newest first: who did what, and what was missed.
#[utoipa::path(
    get,
    path = "/api/v1/tasks/history",
    operation_id = "listTaskHistory",
    tag = "tasks",
    params(
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD; 30 days before `to` by default"),
        ("to" = Option<String>, Query, description = "Last clinic day, YYYY-MM-DD; today by default"),
        ("assignee" = Option<String>, Query, description = "A member: tasks given to them or their role, or finished by them"),
        ("status" = Option<String>, Query, description = "open, done, skipped or missed"),
        ("template_id" = Option<String>, Query, description = "One task")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = TaskHistory),
        (status = 400, description = "A bad filter, or a range over 92 days"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks tasks.manage")
    )
)]
pub(crate) async fn history(
    State(state): State<AppState>,
    Require { request, .. }: Require<TasksManage>,
    ApiQuery(params): ApiQuery<HistoryParams>,
) -> Result<Json<TaskHistory>, ApiFailure> {
    let day = |field: &str, text: &Option<String>| -> Result<_, ApiError> {
        text.as_deref()
            .filter(|text| !text.trim().is_empty())
            .map(|text| parse_day(field, text))
            .transpose()
    };
    let filter = HistoryFilter {
        from: day("from", &params.from)?,
        to: day("to", &params.to)?,
        assignee: optional_uuid("assignee", params.assignee.as_deref().unwrap_or(""))?,
        status: params
            .status
            .as_deref()
            .filter(|text| !text.trim().is_empty())
            .map(|text| {
                OccurrenceStatus::parse(text)
                    .map_err(|_| bad("status", "is open, done, skipped or missed"))
            })
            .transpose()?,
        template_id: optional_uuid("template_id", params.template_id.as_deref().unwrap_or(""))?,
    };
    let items = app::history(
        state.db(),
        &request.actor,
        request.request_id,
        filter,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(TaskHistory {
        items: items.into_iter().map(TaskOccurrence::from).collect(),
    }))
}
