//! Recurring expenses: rent, salaries and other amounts paid every month or week. Set up,
//! edited, paused, resumed and stopped with `expenses.write`; listed with `finance.view`. The
//! outbox job's pass ([`generate`]) records an ordinary expense on each due day. A change only
//! affects what a rule records next: recorded expenses are never rewritten.

use aarogyam_dal::recurring_expenses::{self as dal, NewRecurring, RecurringRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::billing::PaymentMethod;
use aarogyam_domain::event::Event;
use aarogyam_domain::expense::{
    Cadence, DueDay, ExpenseCategoryKey, RecurringStatus, check_amount, check_note,
};
use aarogyam_domain::ids::{ExpenseCategoryId, MembershipId, RecurringExpenseId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, DbError};
use sakalya_types::Paise;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// How far back a new rule may start: its missed days are recorded by the next pass.
pub const MAX_BACKDATE: Duration = Duration::days(90);
/// How far ahead a new rule may start.
pub const MAX_AHEAD: Duration = Duration::days(366);
/// Most rules one pass moves on; the next run takes the rest.
const BATCH: i32 = 200;

/// A recurring expense as the API shows it.
#[derive(Debug, Clone)]
pub struct RecurringView {
    /// Identifier.
    pub id: RecurringExpenseId,
    /// The category.
    pub category_id: ExpenseCategoryId,
    /// Its key.
    pub category: ExpenseCategoryKey,
    /// Its name.
    pub category_name: String,
    /// How much each time.
    pub amount: Paise,
    /// How it is paid, when recorded.
    pub method: Option<PaymentMethod>,
    /// A note copied to each expense.
    pub note: Option<String>,
    /// The day it falls on.
    pub day: DueDay,
    /// The first day it may fall on.
    pub starts_on: Date,
    /// The last day it may fall on.
    pub ends_on: Option<Date>,
    /// The next day it records an expense.
    pub next_due_on: Date,
    /// Where it stands.
    pub status: RecurringStatus,
    /// Whose name the expenses carry.
    pub recorded_by: MembershipId,
    /// When it was set up.
    pub created_at: OffsetDateTime,
}

fn due_day(row: &RecurringRow) -> DueDay {
    let cadence = Cadence::parse(&row.cadence).unwrap_or(Cadence::Monthly);
    // The table's checks guarantee the pair; fall back to the 1st rather than fail a list.
    DueDay::new(cadence, row.day_of_month, row.weekday).unwrap_or(DueDay::Monthly(1))
}

fn status(row: &RecurringRow) -> RecurringStatus {
    if row.stopped_at.is_some() {
        RecurringStatus::Stopped
    } else if row.paused_at.is_some() {
        RecurringStatus::Paused
    } else if row.ends_on.is_some_and(|end| row.next_due_on > end) {
        RecurringStatus::Ended
    } else {
        RecurringStatus::Active
    }
}

fn view(row: RecurringRow) -> RecurringView {
    let day = due_day(&row);
    let status = status(&row);
    RecurringView {
        id: RecurringExpenseId::from_uuid(row.id),
        category_id: ExpenseCategoryId::from_uuid(row.category_id),
        category: ExpenseCategoryKey::parse(&row.category_key).unwrap_or(ExpenseCategoryKey::Other),
        category_name: row.category_name,
        amount: Paise::new(row.amount_paise),
        method: row
            .method
            .as_deref()
            .and_then(|m| PaymentMethod::parse(m).ok()),
        note: row.note,
        day,
        starts_on: row.starts_on,
        ends_on: row.ends_on,
        next_due_on: row.next_due_on,
        status,
        recorded_by: MembershipId::from_uuid(row.recorded_by),
        created_at: row.created_at,
    }
}

fn parse_method(method: Option<&str>) -> Result<Option<PaymentMethod>, AppError> {
    method
        .map(PaymentMethod::parse)
        .transpose()
        .map_err(|e| AppError::invalid("method", e))
}

fn day_field(cadence: Cadence) -> &'static str {
    match cadence {
        Cadence::Monthly => "day_of_month",
        Cadence::Weekly => "weekday",
    }
}

/// A recurring expense to set up.
#[derive(Debug, Clone)]
pub struct NewRecurringInput {
    /// What it is for.
    pub category: ExpenseCategoryKey,
    /// How much each time.
    pub amount: Paise,
    /// `cash`, `upi`, `card` or `bank`; absent when not recorded.
    pub method: Option<String>,
    /// A note, up to 300 characters.
    pub note: Option<String>,
    /// `monthly` or `weekly`.
    pub cadence: String,
    /// 1 to 31, for a monthly rule.
    pub day_of_month: Option<i16>,
    /// 1 (Monday) to 7, for a weekly rule.
    pub weekday: Option<i16>,
    /// The first day it may fall on: up to 90 days back (the missed days are recorded by the
    /// next pass) or a year ahead.
    pub starts_on: Date,
}

/// Sets up a recurring expense; its first due day is the first on or after `starts_on`.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write`; [`AppError::Invalid`] for an amount, note,
/// method, cadence or day that doesn't fit, or a start more than 90 days back or a year ahead.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewRecurringInput,
    now: OffsetDateTime,
) -> Result<RecurringView, AppError> {
    actor.require(Permission::ExpensesWrite)?;
    let amount = check_amount(input.amount).map_err(|e| AppError::invalid("amount_paise", e))?;
    let note = check_note(input.note.as_deref()).map_err(|e| AppError::invalid("note", e))?;
    let method = parse_method(input.method.as_deref())?;
    let cadence = Cadence::parse(&input.cadence).map_err(|e| AppError::invalid("cadence", e))?;
    let day = DueDay::new(cadence, input.day_of_month, input.weekday)
        .map_err(|e| AppError::invalid(day_field(cadence), e))?;
    let today = clinic_today(&actor.timezone, now);
    if input.starts_on < today - MAX_BACKDATE || input.starts_on > today + MAX_AHEAD {
        return Err(AppError::invalid(
            "starts_on",
            "must be within 90 days before today and a year after",
        ));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let next_due_on = dal::due_after(
            tx.conn(),
            cadence.as_str(),
            day.day_of_month(),
            day.weekday(),
            input.starts_on - Duration::days(1),
        )
        .await?;
        let row = dal::insert(
            tx.conn(),
            &NewRecurring {
                id: RecurringExpenseId::new_v7().uuid(),
                category_key: input.category.as_str(),
                amount_paise: amount.get(),
                method: method.map(PaymentMethod::as_str),
                note: note.as_deref(),
                cadence: cadence.as_str(),
                day_of_month: day.day_of_month(),
                weekday: day.weekday(),
                starts_on: input.starts_on,
                next_due_on,
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

/// The clinic's recurring expenses, stopped ones last.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<RecurringView>, AppError> {
    actor.require(Permission::FinanceView)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok(dal::list(tx.conn()).await?.into_iter().map(view).collect())
    })
    .await
}

/// A change to a recurring expense. `None` keeps a field; for the clearable ones,
/// `Some(None)` clears it.
#[derive(Debug, Clone, Default)]
pub struct RecurringChange {
    /// A new amount.
    pub amount: Option<Paise>,
    /// A new method, or none.
    pub method: Option<Option<String>>,
    /// A new note, or none.
    pub note: Option<Option<String>>,
    /// A new day of the month (monthly rules).
    pub day_of_month: Option<i16>,
    /// A new weekday (weekly rules).
    pub weekday: Option<i16>,
    /// A new last day, or none.
    pub ends_on: Option<Option<Date>>,
}

/// Applies a checked change to a locked row; returns whether the day changed.
fn apply(row: &mut RecurringRow, change: RecurringChange) -> Result<bool, AppError> {
    if let Some(amount) = change.amount {
        let amount = check_amount(amount).map_err(|e| AppError::invalid("amount_paise", e))?;
        row.amount_paise = amount.get();
    }
    if let Some(method) = change.method {
        row.method = parse_method(method.as_deref())?.map(|m| m.as_str().to_owned());
    }
    if let Some(note) = change.note {
        row.note = check_note(note.as_deref()).map_err(|e| AppError::invalid("note", e))?;
    }
    let day_changed = change.day_of_month.is_some() || change.weekday.is_some();
    if day_changed {
        let cadence = due_day(row).cadence();
        let day = DueDay::new(
            cadence,
            change.day_of_month.or(row.day_of_month),
            change.weekday.or(row.weekday),
        )
        .map_err(|e| AppError::invalid(day_field(cadence), e))?;
        row.day_of_month = day.day_of_month();
        row.weekday = day.weekday();
    }
    if let Some(ends_on) = change.ends_on {
        if ends_on.is_some_and(|end| end < row.starts_on) {
            return Err(AppError::invalid("ends_on", "must not be before starts_on"));
        }
        row.ends_on = ends_on;
    }
    Ok(day_changed)
}

/// What to do with a recurring expense.
#[derive(Debug, Clone)]
pub enum RecurringAction {
    /// Edit it; only later expenses change.
    Edit(RecurringChange),
    /// Stop recording until resumed.
    Pause,
    /// Record again from the next due day on or after today; paused days are skipped.
    Resume,
    /// Stop for good.
    Stop,
}

/// Edits, pauses, resumes or stops a recurring expense.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write`; [`AppError::NotFound`];
/// [`AppError::Invalid`] for a field that doesn't fit; [`AppError::Conflict`] when stopped, or
/// pausing a paused one or resuming one that isn't paused.
pub async fn act(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: RecurringExpenseId,
    action: RecurringAction,
    now: OffsetDateTime,
) -> Result<RecurringView, AppError> {
    actor.require(Permission::ExpensesWrite)?;
    let today = clinic_today(&actor.timezone, now);
    db.scoped(&scope(actor, request_id), async |tx| {
        let mut row = dal::lock(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("recurring expense"))?;
        if row.stopped_at.is_some() {
            return Err(AppError::Conflict("this recurring expense is stopped"));
        }
        // The next due day counts from the later of today and the next one already set.
        let recompute_from = match action {
            RecurringAction::Edit(change) => apply(&mut row, change)?.then(|| {
                // Days before today were recorded (or skipped) under the old day.
                today.max(row.starts_on)
            }),
            RecurringAction::Pause if row.paused_at.is_some() => {
                return Err(AppError::Conflict(
                    "this recurring expense is already paused",
                ));
            }
            RecurringAction::Pause => {
                row.paused_at = Some(now);
                None
            }
            RecurringAction::Resume if row.paused_at.is_none() => {
                return Err(AppError::Conflict("this recurring expense is not paused"));
            }
            RecurringAction::Resume => {
                row.paused_at = None;
                Some(today.max(row.next_due_on))
            }
            RecurringAction::Stop => {
                row.stopped_at = Some(now);
                None
            }
        };
        if let Some(from) = recompute_from {
            row.next_due_on = dal::due_after(
                tx.conn(),
                &row.cadence,
                row.day_of_month,
                row.weekday,
                from - Duration::days(1),
            )
            .await?;
        }
        Ok(view(dal::save(tx.conn(), &row).await?))
    })
    .await
}

/// What one recurring pass did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RecurringReport {
    /// Rules moved on to their next due day.
    pub rules: usize,
    /// Expenses recorded.
    pub recorded: usize,
}

/// The recurring pass, across clinics, run by the outbox job: records each active rule's due
/// days up to the clinic's today (at most 12 per rule per run) and moves it on. Cheap when
/// nothing is due: one indexed query. Logs ids and counts only.
///
/// # Errors
/// [`DbError`] when the database fails; what was recorded stays recorded.
pub async fn generate(db: &Db, now: OffsetDateTime) -> Result<RecurringReport, DbError> {
    let steps = dal::run(db.pool(), now, BATCH).await?;
    let mut report = RecurringReport::default();
    for step in &steps {
        report.rules += 1;
        report.recorded += usize::try_from(step.recorded).unwrap_or_default();
        tracing::info!(
            event = Event::RecurringExpenseRecorded.as_str(),
            org_id = %step.org_id,
            recurring_expense_id = %step.recurring_expense_id,
            recorded = step.recorded,
            "recurring expense recorded"
        );
    }
    Ok(report)
}
