//! Clinic expenses: record (`expenses.write`), list and void (`finance.view`).

use aarogyam_app::expenses::{self as app, ExpenseView, NewExpenseInput};
use aarogyam_domain::event::Event;
use aarogyam_domain::expense::ExpenseCategoryKey;
use aarogyam_domain::ids::ExpenseId;
use aarogyam_domain::permission::require::{ExpensesWrite, FinanceView};
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use sakalya_types::Paise;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::billing::Reason;
use super::{parse_day, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// A system expense category. Stock deliveries count as `material` in analytics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExpenseCategory {
    /// Staff salaries.
    Salary,
    /// Materials bought outside stock.
    Material,
    /// Electricity.
    Electricity,
    /// Outside lab work.
    Lab,
    /// Rent.
    Rent,
    /// Anything else.
    Other,
}

impl From<ExpenseCategoryKey> for ExpenseCategory {
    fn from(key: ExpenseCategoryKey) -> Self {
        match key {
            ExpenseCategoryKey::Salary => Self::Salary,
            ExpenseCategoryKey::Material => Self::Material,
            ExpenseCategoryKey::Electricity => Self::Electricity,
            ExpenseCategoryKey::Lab => Self::Lab,
            ExpenseCategoryKey::Rent => Self::Rent,
            ExpenseCategoryKey::Other => Self::Other,
        }
    }
}

impl From<ExpenseCategory> for ExpenseCategoryKey {
    fn from(category: ExpenseCategory) -> Self {
        match category {
            ExpenseCategory::Salary => Self::Salary,
            ExpenseCategory::Material => Self::Material,
            ExpenseCategory::Electricity => Self::Electricity,
            ExpenseCategory::Lab => Self::Lab,
            ExpenseCategory::Rent => Self::Rent,
            ExpenseCategory::Other => Self::Other,
        }
    }
}

/// Money the clinic spent.
#[derive(Debug, Serialize, ToSchema)]
pub struct Expense {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// What it was for.
    pub category: ExpenseCategory,
    /// The category's name, such as `Rent`.
    pub category_name: String,
    /// The clinic day the money went out, `YYYY-MM-DD`.
    pub spent_on: String,
    /// Paise.
    pub amount_paise: i64,
    /// A note.
    pub note: Option<String>,
    /// `recorded` or `void`.
    pub status: String,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided (RFC 3339).
    pub voided_at: Option<String>,
    /// The membership that recorded it.
    #[schema(value_type = String)]
    pub recorded_by: Uuid,
    /// When it was recorded (RFC 3339).
    pub created_at: String,
}

impl From<ExpenseView> for Expense {
    fn from(view: ExpenseView) -> Self {
        Self {
            id: view.id.uuid(),
            category: view.category.into(),
            category_name: view.category_name,
            spent_on: view.spent_on.to_string(),
            amount_paise: view.amount.get(),
            note: view.note,
            status: view.status.as_str().to_owned(),
            void_reason: view.void_reason,
            voided_at: view.voided_at.map(rfc3339),
            recorded_by: view.recorded_by.uuid(),
            created_at: rfc3339(view.created_at),
        }
    }
}

/// Expenses.
#[derive(Debug, Serialize, ToSchema)]
pub struct ExpenseList {
    /// Newest day first, voided ones included.
    pub items: Vec<Expense>,
}

/// An expense to record.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewExpense {
    /// What it was for.
    pub category: ExpenseCategory,
    /// The clinic day, `YYYY-MM-DD`; today or earlier.
    pub spent_on: String,
    /// Paise, more than zero and at most 1,00,00,000 rupees.
    pub amount_paise: i64,
    /// Up to 300 characters.
    pub note: Option<String>,
}

/// Records an expense. Send an `Idempotency-Key` header (a UUID per form) so a retry returns
/// the first expense (`200`) instead of recording another.
#[utoipa::path(
    post,
    path = "/api/v1/expenses",
    operation_id = "recordExpense",
    tag = "billing",
    request_body = NewExpense,
    params(("Idempotency-Key" = Option<String>, Header, description = "Unique per expense, 8 to 100 letters, digits, '-', '_', '.' or ':'; a retry sends the same key")),
    security(("bearer" = [])),
    responses(
        (status = 201, body = Expense, description = "Recorded"),
        (status = 200, body = Expense, description = "Already recorded with this key"),
        (status = 400, description = "Invalid input: amount, note, a day after today, or a malformed key"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks expenses.write"),
        (status = 409, description = "The key was used for a different expense")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    Require { request, .. }: Require<ExpensesWrite>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<NewExpense>,
) -> Result<(StatusCode, Json<Expense>), ApiFailure> {
    let idempotency_key = headers
        .get("idempotency-key")
        .map(|value| value.to_str().unwrap_or_default().to_owned());
    let spent_on = parse_day("spent_on", &body.spent_on)?;
    let (view, created) = app::record(
        state.db(),
        &request.actor,
        request.request_id,
        NewExpenseInput {
            category: body.category.into(),
            spent_on,
            amount: Paise::new(body.amount_paise),
            note: body.note,
            idempotency_key,
        },
        OffsetDateTime::now_utc(),
    )
    .await?;
    if !created {
        return Ok((StatusCode::OK, Json(view.into())));
    }
    tracing::info!(event = Event::ExpenseRecorded.as_str(), expense_id = %view.id.uuid(), "expense recorded");
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// Filters for the expense list.
#[derive(Debug, Deserialize)]
pub struct ExpenseParams {
    /// First clinic day (`YYYY-MM-DD`).
    pub from: Option<String>,
    /// Last clinic day, included.
    pub to: Option<String>,
    /// Most rows, 1 to 500 (default 500).
    pub limit: Option<i64>,
}

/// Expenses spent on clinic days `from` to `to`, newest day first, voided ones included.
#[utoipa::path(
    get,
    path = "/api/v1/expenses",
    operation_id = "listExpenses",
    tag = "billing",
    params(
        ("from" = Option<String>, Query, description = "First clinic day, YYYY-MM-DD"),
        ("to" = Option<String>, Query, description = "Last clinic day, included"),
        ("limit" = Option<i64>, Query, description = "Most rows, 1 to 500 (default 500)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ExpenseList),
        (status = 400, description = "A bad date or a backwards range"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiQuery(params): ApiQuery<ExpenseParams>,
) -> Result<Json<ExpenseList>, ApiFailure> {
    let from = params
        .from
        .as_deref()
        .map(|t| parse_day("from", t))
        .transpose()?;
    let to = params
        .to
        .as_deref()
        .map(|t| parse_day("to", t))
        .transpose()?;
    let rows = app::list(
        state.db(),
        &request.actor,
        request.request_id,
        from,
        to,
        params.limit.unwrap_or(app::MAX_LIST),
    )
    .await?;
    Ok(Json(ExpenseList {
        items: rows.into_iter().map(Expense::from).collect(),
    }))
}

/// Voids an expense with a reason; it stops counting in reports.
#[utoipa::path(
    post,
    path = "/api/v1/expenses/{id}/void",
    operation_id = "voidExpense",
    tag = "billing",
    params(("id" = String, Path, description = "The expense")),
    request_body = Reason,
    security(("bearer" = [])),
    responses(
        (status = 200, body = Expense),
        (status = 400, description = "No reason given"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks finance.view"),
        (status = 404, description = "No such expense in this clinic"),
        (status = 409, description = "Already void")
    )
)]
pub(crate) async fn void(
    State(state): State<AppState>,
    Require { request, .. }: Require<FinanceView>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<Reason>,
) -> Result<Json<Expense>, ApiFailure> {
    let view = app::void(
        state.db(),
        &request.actor,
        request.request_id,
        ExpenseId::from_uuid(id),
        &body.reason,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(event = Event::ExpenseVoided.as_str(), expense_id = %id, "expense voided");
    Ok(Json(view.into()))
}
