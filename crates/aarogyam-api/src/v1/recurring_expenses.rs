//! Recurring expenses (rent, salaries): set up, edit, pause, resume and stop
//! (`expenses.write`), list (`finance.view`). The outbox job records each due expense.

use aarogyam_app::recurring_expenses::{
    self as app, NewRecurringInput, RecurringAction, RecurringChange, RecurringView,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::expense::{Cadence, RecurringStatus};
use aarogyam_domain::ids::RecurringExpenseId;
use aarogyam_domain::permission::require::{ExpensesWrite, FinanceView};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use sakalya_types::Paise;
use serde::{Deserialize, Deserializer, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::expenses::ExpenseCategory;
use super::{parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// Tells a field sent as `null` (`Some(None)`) from one left out (`None`).
#[expect(clippy::option_option, reason = "null clears, absent keeps")]
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

/// How often a recurring expense is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecurringCadence {
    /// On `day_of_month` of every month; a shorter month uses its last day.
    Monthly,
    /// On `weekday` of every week.
    Weekly,
}

impl From<Cadence> for RecurringCadence {
    fn from(cadence: Cadence) -> Self {
        match cadence {
            Cadence::Monthly => Self::Monthly,
            Cadence::Weekly => Self::Weekly,
        }
    }
}

impl RecurringCadence {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Monthly => "monthly",
            Self::Weekly => "weekly",
        }
    }
}

/// Where a recurring expense stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecurringExpenseStatus {
    /// Records an expense on each due day.
    Active,
    /// Records nothing until resumed.
    Paused,
    /// Stopped for good.
    Stopped,
    /// Past its end date.
    Ended,
}

impl From<RecurringStatus> for RecurringExpenseStatus {
    fn from(status: RecurringStatus) -> Self {
        match status {
            RecurringStatus::Active => Self::Active,
            RecurringStatus::Paused => Self::Paused,
            RecurringStatus::Stopped => Self::Stopped,
            RecurringStatus::Ended => Self::Ended,
        }
    }
}

/// An expense the clinic records every month or week, such as rent or a salary.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecurringExpense {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// What it is for.
    pub category: ExpenseCategory,
    /// The category's name, such as `Rent`.
    pub category_name: String,
    /// Paise, each time.
    pub amount_paise: i64,
    /// How it is paid: `cash`, `upi`, `card` or `bank`. Absent when not recorded.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// A note copied to each expense.
    pub note: Option<String>,
    /// Monthly or weekly.
    pub cadence: RecurringCadence,
    /// 1 to 31, for a monthly one; a shorter month uses its last day. Absent for weekly.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_of_month: Option<i16>,
    /// 1 (Monday) to 7 (Sunday), for a weekly one. Absent for monthly.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekday: Option<i16>,
    /// The first day it may fall on, `YYYY-MM-DD`.
    pub starts_on: String,
    /// The last day it may fall on, `YYYY-MM-DD`; null for no end.
    pub ends_on: Option<String>,
    /// The next day it records an expense, `YYYY-MM-DD`.
    pub next_due_on: String,
    /// Active, paused, stopped or ended.
    pub status: RecurringExpenseStatus,
    /// The membership whose name the recorded expenses carry.
    #[schema(value_type = String)]
    pub recorded_by: Uuid,
    /// When it was set up (RFC 3339).
    pub created_at: String,
}

impl From<RecurringView> for RecurringExpense {
    fn from(view: RecurringView) -> Self {
        Self {
            id: view.id.uuid(),
            category: view.category.into(),
            category_name: view.category_name,
            amount_paise: view.amount.get(),
            method: view.method.map(|m| m.as_str().to_owned()),
            note: view.note,
            cadence: view.day.cadence().into(),
            day_of_month: view.day.day_of_month(),
            weekday: view.day.weekday(),
            starts_on: view.starts_on.to_string(),
            ends_on: view.ends_on.map(|d| d.to_string()),
            next_due_on: view.next_due_on.to_string(),
            status: view.status.into(),
            recorded_by: view.recorded_by.uuid(),
            created_at: rfc3339(view.created_at),
        }
    }
}

/// Recurring expenses.
#[derive(Debug, Serialize, ToSchema)]
pub struct RecurringExpenseList {
    /// By next due day, stopped ones last.
    pub items: Vec<RecurringExpense>,
}

/// A recurring expense to set up.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewRecurringExpense {
    /// What it is for.
    pub category: ExpenseCategory,
    /// Paise each time, more than zero and at most 1,00,00,000 rupees.
    pub amount_paise: i64,
    /// How it is paid: `cash`, `upi`, `card` or `bank`. Optional.
    pub method: Option<String>,
    /// Up to 300 characters, copied to each expense.
    pub note: Option<String>,
    /// Monthly or weekly.
    pub cadence: RecurringCadence,
    /// 1 to 31; required for monthly, absent for weekly.
    pub day_of_month: Option<i16>,
    /// 1 (Monday) to 7 (Sunday); required for weekly, absent for monthly.
    pub weekday: Option<i16>,
    /// The first day it may fall on, `YYYY-MM-DD`: up to 90 days back (the missed days are
    /// recorded on the next run) or a year ahead.
    pub starts_on: String,
}

/// A change to a recurring expense. Fields left out stay; only expenses recorded after the
/// change use it.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RecurringExpenseChange {
    /// Paise each time.
    pub amount_paise: Option<i64>,
    /// `cash`, `upi`, `card` or `bank`; `null` clears.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    #[expect(clippy::option_option, reason = "null clears, absent keeps")]
    pub method: Option<Option<String>>,
    /// Up to 300 characters; `null` clears.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    #[expect(clippy::option_option, reason = "null clears, absent keeps")]
    pub note: Option<Option<String>>,
    /// 1 to 31, for a monthly one.
    pub day_of_month: Option<i16>,
    /// 1 (Monday) to 7, for a weekly one.
    pub weekday: Option<i16>,
    /// The last day, `YYYY-MM-DD`, not before `starts_on`; `null` clears.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    #[expect(clippy::option_option, reason = "null clears, absent keeps")]
    pub ends_on: Option<Option<String>>,
}

/// The clinic's recurring expenses.
#[utoipa::path(
    get,
    path = "/api/v1/recurring-expenses",
    operation_id = "listRecurringExpenses",
    tag = "billing",
    security(("bearer" = [])),
    responses(
        (status = 200, body = RecurringExpenseList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
) -> Result<Json<RecurringExpenseList>, ApiFailure> {
    let rows = app::list(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(RecurringExpenseList {
        items: rows.into_iter().map(RecurringExpense::from).collect(),
    }))
}

/// Sets up a recurring expense. Its first expense is recorded on the first due day on or after
/// `starts_on`, by the background job (within a few minutes).
#[utoipa::path(
    post,
    path = "/api/v1/recurring-expenses",
    operation_id = "createRecurringExpense",
    tag = "billing",
    request_body = NewRecurringExpense,
    security(("bearer" = [])),
    responses(
        (status = 201, body = RecurringExpense, description = "Set up"),
        (status = 400, description = "Invalid input: amount, note, method, day, or a start out of range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiJson(body): ApiJson<NewRecurringExpense>,
) -> Result<(StatusCode, Json<RecurringExpense>), ApiFailure> {
    let starts_on = parse_day("starts_on", &body.starts_on)?;
    let view = app::create(
        state.db(),
        &request.actor,
        request.request_id,
        NewRecurringInput {
            category: body.category.into(),
            amount: Paise::new(body.amount_paise),
            method: body.method,
            note: body.note,
            cadence: body.cadence.as_str().to_owned(),
            day_of_month: body.day_of_month,
            weekday: body.weekday,
            starts_on,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::RecurringExpenseCreated.as_str(), recurring_expense_id = %view.id.uuid(), "recurring expense created");
    Ok((StatusCode::CREATED, Json(view.into())))
}

async fn act(
    state: &AppState,
    request: &crate::extract::ClinicRequest,
    id: Uuid,
    action: RecurringAction,
    change: &'static str,
) -> Result<Json<RecurringExpense>, ApiFailure> {
    let view = app::act(
        state.db(),
        &request.actor,
        request.request_id,
        RecurringExpenseId::from_uuid(id),
        action,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::RecurringExpenseChanged.as_str(), recurring_expense_id = %id, change, "recurring expense changed");
    Ok(Json(view.into()))
}

/// Edits a recurring expense. Only expenses recorded from now on change; a new day moves the
/// next due day to the first one on or after today.
#[utoipa::path(
    patch,
    path = "/api/v1/recurring-expenses/{id}",
    operation_id = "updateRecurringExpense",
    tag = "billing",
    params(("id" = String, Path, description = "The recurring expense")),
    request_body = RecurringExpenseChange,
    security(("bearer" = [])),
    responses(
        (status = 200, body = RecurringExpense),
        (status = 400, description = "Invalid input"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 404, description = "No such recurring expense in this clinic"),
        (status = 409, description = "Stopped")
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<RecurringExpenseChange>,
) -> Result<Json<RecurringExpense>, ApiFailure> {
    let ends_on = match body.ends_on {
        Some(Some(text)) => Some(Some(parse_day("ends_on", &text)?)),
        Some(None) => Some(None),
        None => None,
    };
    let change = RecurringChange {
        amount: body.amount_paise.map(Paise::new),
        method: body.method,
        note: body.note,
        day_of_month: body.day_of_month,
        weekday: body.weekday,
        ends_on,
    };
    act(&state, &request, id, RecurringAction::Edit(change), "edit").await
}

/// Pauses a recurring expense: nothing is recorded until it is resumed.
#[utoipa::path(
    post,
    path = "/api/v1/recurring-expenses/{id}/pause",
    operation_id = "pauseRecurringExpense",
    tag = "billing",
    params(("id" = String, Path, description = "The recurring expense")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = RecurringExpense),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 404, description = "No such recurring expense in this clinic"),
        (status = 409, description = "Already paused, or stopped")
    )
)]
pub(crate) async fn pause(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<RecurringExpense>, ApiFailure> {
    act(&state, &request, id, RecurringAction::Pause, "pause").await
}

/// Resumes a paused recurring expense from its next due day on or after today; the days it was
/// paused are not recorded.
#[utoipa::path(
    post,
    path = "/api/v1/recurring-expenses/{id}/resume",
    operation_id = "resumeRecurringExpense",
    tag = "billing",
    params(("id" = String, Path, description = "The recurring expense")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = RecurringExpense),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 404, description = "No such recurring expense in this clinic"),
        (status = 409, description = "Not paused, or stopped")
    )
)]
pub(crate) async fn resume(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<RecurringExpense>, ApiFailure> {
    act(&state, &request, id, RecurringAction::Resume, "resume").await
}

/// Stops a recurring expense for good. Expenses it recorded stay.
#[utoipa::path(
    post,
    path = "/api/v1/recurring-expenses/{id}/stop",
    operation_id = "stopRecurringExpense",
    tag = "billing",
    params(("id" = String, Path, description = "The recurring expense")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = RecurringExpense),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 404, description = "No such recurring expense in this clinic"),
        (status = 409, description = "Already stopped")
    )
)]
pub(crate) async fn stop(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<RecurringExpense>, ApiFailure> {
    act(&state, &request, id, RecurringAction::Stop, "stop").await
}
