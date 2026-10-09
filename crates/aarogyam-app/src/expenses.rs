//! Clinic expenses: recorded by the owner or finance (`expenses.write`), listed and voided
//! with `finance.view`. An expense is never edited: a mistake is voided with a reason.

use aarogyam_dal::expenses::{self as dal, ExpenseRow, NewExpense};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::expense::{ExpenseCategoryKey, ExpenseStatus, check_amount, check_note};
use aarogyam_domain::ids::{ExpenseCategoryId, ExpenseId, MembershipId};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::void_reason;
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Most expenses one list returns.
pub const MAX_LIST: i64 = 500;

/// An expense as the API shows it.
#[derive(Debug, Clone)]
pub struct ExpenseView {
    /// Identifier.
    pub id: ExpenseId,
    /// The category.
    pub category_id: ExpenseCategoryId,
    /// Its key.
    pub category: ExpenseCategoryKey,
    /// Its name.
    pub category_name: String,
    /// The clinic day the money went out.
    pub spent_on: Date,
    /// How much.
    pub amount: Paise,
    /// A note.
    pub note: Option<String>,
    /// Recorded or void.
    pub status: ExpenseStatus,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<OffsetDateTime>,
    /// Who recorded it.
    pub recorded_by: MembershipId,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
}

fn view(row: ExpenseRow) -> ExpenseView {
    ExpenseView {
        id: ExpenseId::from_uuid(row.id),
        category_id: ExpenseCategoryId::from_uuid(row.category_id),
        category: ExpenseCategoryKey::parse(&row.category_key).unwrap_or(ExpenseCategoryKey::Other),
        category_name: row.category_name,
        spent_on: row.spent_on,
        amount: Paise::new(row.amount_paise),
        note: row.note,
        status: ExpenseStatus::parse(&row.status).unwrap_or(ExpenseStatus::Recorded),
        void_reason: row.void_reason,
        voided_at: row.voided_at,
        recorded_by: MembershipId::from_uuid(row.recorded_by),
        created_at: row.created_at,
    }
}

/// An expense to record.
#[derive(Debug, Clone)]
pub struct NewExpenseInput {
    /// What it was for.
    pub category: ExpenseCategoryKey,
    /// The clinic day; today or earlier.
    pub spent_on: Date,
    /// How much.
    pub amount: Paise,
    /// A note, up to 300 characters.
    pub note: Option<String>,
}

/// Records an expense.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write`; [`AppError::Invalid`] for an amount that
/// isn't above zero, a long note or a day after today.
pub async fn record(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewExpenseInput,
    now: OffsetDateTime,
) -> Result<ExpenseView, AppError> {
    actor.require(Permission::ExpensesWrite)?;
    let amount = check_amount(input.amount).map_err(|e| AppError::invalid("amount_paise", e))?;
    let note = check_note(input.note.as_deref()).map_err(|e| AppError::invalid("note", e))?;
    if input.spent_on > clinic_today(&actor.timezone, now) {
        return Err(AppError::invalid("spent_on", "must not be after today"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::insert(
            tx.conn(),
            &NewExpense {
                id: ExpenseId::new_v7().uuid(),
                category_key: input.category.as_str(),
                spent_on: input.spent_on,
                amount_paise: amount.get(),
                note: note.as_deref(),
                recorded_by: actor.membership_id.uuid(),
            },
        )
        .await?
        // Every clinic has the system categories (migration 0300); a missing one is a bug.
        .ok_or(AppError::Internal("expense category missing"))?;
        Ok(view(row))
    })
    .await
}

/// Expenses spent on clinic days `from` to `to` (both included), voided ones too, newest day
/// first; at most `limit` (1 to 500).
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::Invalid`] for a backwards range.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    from: Option<Date>,
    to: Option<Date>,
    limit: i64,
) -> Result<Vec<ExpenseView>, AppError> {
    actor.require(Permission::FinanceView)?;
    if let (Some(from), Some(to)) = (from, to)
        && from > to
    {
        return Err(AppError::invalid("from", "must not be after to"));
    }
    let limit = limit.clamp(1, MAX_LIST);
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(tx.conn(), from, to, limit).await?;
        Ok(rows.into_iter().map(view).collect())
    })
    .await
}

/// Voids an expense with a reason; it stops counting in reports.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::Invalid`] without a reason;
/// [`AppError::NotFound`]; [`AppError::Conflict`] when already void or a lab payment's.
pub async fn void(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ExpenseId,
    reason: &str,
    now: OffsetDateTime,
) -> Result<ExpenseView, AppError> {
    actor.require(Permission::FinanceView)?;
    let reason = void_reason(reason)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if let Some(row) = dal::void(
            tx.conn(),
            id.uuid(),
            &reason,
            now,
            actor.membership_id.uuid(),
        )
        .await?
        {
            return Ok(view(row));
        }
        match dal::status(tx.conn(), id.uuid()).await? {
            None => Err(AppError::NotFound("expense")),
            Some(status) if status == ExpenseStatus::Recorded.as_str() => Err(AppError::Conflict(
                "this expense is a lab payment: void the payment instead",
            )),
            Some(_) => Err(AppError::Conflict("this expense is already void")),
        }
    })
    .await
}
