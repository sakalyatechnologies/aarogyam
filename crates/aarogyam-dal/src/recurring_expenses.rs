//! Recurring expenses: rules that record an expense every month or week. Every function but
//! [`run`] takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use sqlx::{PgConnection, PgPool};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A recurring expense with its category.
#[derive(Debug, Clone)]
pub struct RecurringRow {
    /// Identifier.
    pub id: Uuid,
    /// The category.
    pub category_id: Uuid,
    /// Its key, such as `rent`.
    pub category_key: String,
    /// Its name, such as `Rent`.
    pub category_name: String,
    /// How much each time.
    pub amount_paise: i64,
    /// How it is paid, when recorded.
    pub method: Option<String>,
    /// A note copied to each expense.
    pub note: Option<String>,
    /// `monthly` or `weekly`.
    pub cadence: String,
    /// 1 to 31, for a monthly rule.
    pub day_of_month: Option<i16>,
    /// 1 (Monday) to 7, for a weekly rule.
    pub weekday: Option<i16>,
    /// The first day it may fall on.
    pub starts_on: Date,
    /// The last day it may fall on.
    pub ends_on: Option<Date>,
    /// The next day it records an expense.
    pub next_due_on: Date,
    /// When it was paused.
    pub paused_at: Option<OffsetDateTime>,
    /// When it was stopped for good.
    pub stopped_at: Option<OffsetDateTime>,
    /// The member whose name the expenses carry.
    pub recorded_by: Uuid,
    /// When it was set up.
    pub created_at: OffsetDateTime,
}

/// A new recurring expense.
#[derive(Debug, Clone, Copy)]
pub struct NewRecurring<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The category's key.
    pub category_key: &'a str,
    /// How much, above zero.
    pub amount_paise: i64,
    /// How it is paid.
    pub method: Option<&'a str>,
    /// A note.
    pub note: Option<&'a str>,
    /// `monthly` or `weekly`.
    pub cadence: &'a str,
    /// For a monthly rule.
    pub day_of_month: Option<i16>,
    /// For a weekly rule.
    pub weekday: Option<i16>,
    /// The first day.
    pub starts_on: Date,
    /// The first due day on or after `starts_on`.
    pub next_due_on: Date,
    /// The member setting it up.
    pub recorded_by: Uuid,
}

/// Sets up a recurring expense in the category with `category_key`. `None` when the clinic has
/// no such category.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewRecurring<'_>,
) -> Result<Option<RecurringRow>, DbError> {
    let row = sqlx::query_as!(
        RecurringRow,
        r#"with c as (
             select id, key, name from aarogyam.expense_categories where key = $2
           ), e as (
             insert into aarogyam.recurring_expenses
               (id, category_id, amount_paise, method, note, cadence, day_of_month, weekday,
                starts_on, next_due_on, recorded_by)
             select $1, c.id, $3, $4, $5, $6, $7, $8, $9, $10, $11 from c
             returning *
           )
           select e.id as "id!", e.category_id as "category_id!", c.key as "category_key!",
                  c.name as "category_name!", e.amount_paise as "amount_paise!", e.method, e.note,
                  e.cadence as "cadence!", e.day_of_month, e.weekday, e.starts_on as "starts_on!",
                  e.ends_on, e.next_due_on as "next_due_on!", e.paused_at, e.stopped_at,
                  e.recorded_by as "recorded_by!", e.created_at as "created_at!"
           from e join c on c.id = e.category_id"#,
        new.id,
        new.category_key,
        new.amount_paise,
        new.method,
        new.note,
        new.cadence,
        new.day_of_month,
        new.weekday,
        new.starts_on,
        new.next_due_on,
        new.recorded_by,
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The clinic's recurring expenses, stopped ones last, then by next due day.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(conn: &mut PgConnection) -> Result<Vec<RecurringRow>, DbError> {
    let rows = sqlx::query_as!(
        RecurringRow,
        r#"select e.id, e.category_id, c.key as category_key, c.name as category_name,
                  e.amount_paise, e.method, e.note, e.cadence, e.day_of_month, e.weekday,
                  e.starts_on, e.ends_on, e.next_due_on, e.paused_at, e.stopped_at,
                  e.recorded_by, e.created_at
           from aarogyam.recurring_expenses e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id
           order by e.stopped_at is not null, e.next_due_on, e.id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Locks one recurring expense; `None` when the clinic has none with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(conn: &mut PgConnection, id: Uuid) -> Result<Option<RecurringRow>, DbError> {
    let row = sqlx::query_as!(
        RecurringRow,
        r#"select e.id, e.category_id, c.key as category_key, c.name as category_name,
                  e.amount_paise, e.method, e.note, e.cadence, e.day_of_month, e.weekday,
                  e.starts_on, e.ends_on, e.next_due_on, e.paused_at, e.stopped_at,
                  e.recorded_by, e.created_at
           from aarogyam.recurring_expenses e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id
           where e.id = $1
           for update of e"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Writes the changeable fields of a locked rule back (amount, method, note, day, end, next due
/// day, paused, stopped) and returns it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save(conn: &mut PgConnection, row: &RecurringRow) -> Result<RecurringRow, DbError> {
    let saved = sqlx::query_as!(
        RecurringRow,
        r#"with e as (
             update aarogyam.recurring_expenses
             set amount_paise = $2, method = $3, note = $4, day_of_month = $5, weekday = $6,
                 ends_on = $7, next_due_on = $8, paused_at = $9, stopped_at = $10
             where id = $1
             returning *
           )
           select e.id as "id!", e.category_id as "category_id!", c.key as "category_key!",
                  c.name as "category_name!", e.amount_paise as "amount_paise!", e.method, e.note,
                  e.cadence as "cadence!", e.day_of_month, e.weekday, e.starts_on as "starts_on!",
                  e.ends_on, e.next_due_on as "next_due_on!", e.paused_at, e.stopped_at,
                  e.recorded_by as "recorded_by!", e.created_at as "created_at!"
           from e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id"#,
        row.id,
        row.amount_paise,
        row.method,
        row.note,
        row.day_of_month,
        row.weekday,
        row.ends_on,
        row.next_due_on,
        row.paused_at,
        row.stopped_at,
    )
    .fetch_one(conn)
    .await?;
    Ok(saved)
}

/// The first due day after `after` (`app.recurring_due_after`: a short month uses its last
/// day; weekday 1 is Monday). The one place the rule lives, shared with [`run`].
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn due_after(
    conn: &mut PgConnection,
    cadence: &str,
    day_of_month: Option<i16>,
    weekday: Option<i16>,
    after: Date,
) -> Result<Date, DbError> {
    let day = sqlx::query_scalar!(
        r#"select app.recurring_due_after($1, $2, $3, $4) as "day!""#,
        cadence,
        day_of_month.map(i32::from),
        weekday.map(i32::from),
        after
    )
    .fetch_one(conn)
    .await?;
    Ok(day)
}

/// One rule the recurring pass moved on.
#[derive(Debug, Clone)]
pub struct RunStep {
    /// The clinic.
    pub org_id: Uuid,
    /// The rule.
    pub recurring_expense_id: Uuid,
    /// Expenses it recorded this run (0 when every day was already recorded).
    pub recorded: i32,
}

/// Runs the recurring pass across clinics (`app.run_recurring_expenses`): records each due day
/// once, at most 12 per rule per run, for at most `limit` rules.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn run(pool: &PgPool, now: OffsetDateTime, limit: i32) -> Result<Vec<RunStep>, DbError> {
    let rows = sqlx::query_as!(
        RunStep,
        r#"select org_id as "org_id!", recurring_expense_id as "recurring_expense_id!",
                  recorded as "recorded!"
           from app.run_recurring_expenses($1, $2)"#,
        now,
        limit
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}
