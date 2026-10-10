//! Clinic expenses. Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// An expense with its category.
#[derive(Debug, Clone)]
pub struct ExpenseRow {
    /// Identifier.
    pub id: Uuid,
    /// The category.
    pub category_id: Uuid,
    /// Its key, such as `rent`.
    pub category_key: String,
    /// Its name, such as `Rent`.
    pub category_name: String,
    /// The clinic day the money went out.
    pub spent_on: Date,
    /// How much.
    pub amount_paise: i64,
    /// A note.
    pub note: Option<String>,
    /// `recorded` or `void`.
    pub status: String,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<OffsetDateTime>,
    /// The member who recorded it.
    pub recorded_by: Uuid,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
}

/// A new expense.
#[derive(Debug, Clone, Copy)]
pub struct NewExpense<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The category's key.
    pub category_key: &'a str,
    /// The clinic day.
    pub spent_on: Date,
    /// How much, above zero.
    pub amount_paise: i64,
    /// A note.
    pub note: Option<&'a str>,
    /// The member recording it.
    pub recorded_by: Uuid,
    /// The client's idempotency key, if it sent one.
    pub idempotency_key: Option<&'a str>,
    /// The hash of the request the key was sent with.
    pub request_hash: Option<&'a str>,
}

/// Records an expense in the category with `category_key`, in one statement. `None` when the
/// clinic has no such category.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    new: &NewExpense<'_>,
) -> Result<Option<ExpenseRow>, DbError> {
    let row = sqlx::query_as!(
        ExpenseRow,
        r#"with c as (
             select id, key, name from aarogyam.expense_categories where key = $2
           ), e as (
             insert into aarogyam.expenses (id, category_id, spent_on, amount_paise, note, recorded_by,
                                            idempotency_key, request_hash)
             select $1, c.id, $3, $4, $5, $6, $7, $8 from c
             returning id, category_id, spent_on, amount_paise, note, status, void_reason, voided_at,
                       recorded_by, created_at
           )
           select e.id as "id!", e.category_id as "category_id!", c.key as "category_key!",
                  c.name as "category_name!", e.spent_on as "spent_on!",
                  e.amount_paise as "amount_paise!", e.note, e.status as "status!",
                  e.void_reason, e.voided_at, e.recorded_by as "recorded_by!",
                  e.created_at as "created_at!"
           from e join c on c.id = e.category_id"#,
        new.id,
        new.category_key,
        new.spent_on,
        new.amount_paise,
        new.note,
        new.recorded_by,
        new.idempotency_key,
        new.request_hash,
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Expenses spent on clinic days `from` to `to` (both included, either open), voided ones
/// too, newest day first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    from: Option<Date>,
    to: Option<Date>,
    limit: i64,
) -> Result<Vec<ExpenseRow>, DbError> {
    let rows = sqlx::query_as!(
        ExpenseRow,
        r#"select e.id, e.category_id, c.key as category_key, c.name as category_name, e.spent_on,
                  e.amount_paise, e.note, e.status, e.void_reason, e.voided_at, e.recorded_by,
                  e.created_at
           from aarogyam.expenses e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id
           where ($1::date is null or e.spent_on >= $1)
             and ($2::date is null or e.spent_on <= $2)
           order by e.spent_on desc, e.id desc
           limit $3"#,
        from,
        to,
        limit,
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Voids a recorded expense, in one statement. `None` when there is no recorded expense with
/// `id` (unknown or already void; see [`status`]) or it belongs to a recorded lab payment.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn void(
    conn: &mut PgConnection,
    id: Uuid,
    reason: &str,
    at: OffsetDateTime,
    by: Uuid,
) -> Result<Option<ExpenseRow>, DbError> {
    let row = sqlx::query_as!(
        ExpenseRow,
        r#"with e as (
             update aarogyam.expenses
             set status = 'void', void_reason = $2, voided_at = $3, voided_by = $4
             where id = $1 and status = 'recorded'
               -- A lab payment's expense is voided with the payment, never alone.
               and not exists (select 1 from aarogyam.lab_payments p
                               where p.org_id = expenses.org_id and p.expense_id = expenses.id
                                 and p.status = 'recorded')
             returning org_id, id, category_id, spent_on, amount_paise, note, status, void_reason,
                       voided_at, recorded_by, created_at
           )
           select e.id as "id!", e.category_id as "category_id!", c.key as "category_key!",
                  c.name as "category_name!", e.spent_on as "spent_on!",
                  e.amount_paise as "amount_paise!", e.note, e.status as "status!",
                  e.void_reason, e.voided_at, e.recorded_by as "recorded_by!",
                  e.created_at as "created_at!"
           from e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id"#,
        id,
        reason,
        at,
        by,
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// An expense's status, or `None` when the clinic has no expense with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn status(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!("select status from aarogyam.expenses where id = $1", id)
        .fetch_optional(conn)
        .await?;
    Ok(status)
}

/// The expense recorded with an idempotency key, with the hash of its request.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn by_key(
    conn: &mut PgConnection,
    key: &str,
) -> Result<Option<(ExpenseRow, String)>, DbError> {
    let row = sqlx::query!(
        r#"select e.id, e.category_id, c.key as category_key, c.name as category_name, e.spent_on,
                  e.amount_paise, e.note, e.status, e.void_reason, e.voided_at, e.recorded_by,
                  e.created_at, e.request_hash as "request_hash!"
           from aarogyam.expenses e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id
           where e.idempotency_key = $1"#,
        key
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| {
        (
            ExpenseRow {
                id: row.id,
                category_id: row.category_id,
                category_key: row.category_key,
                category_name: row.category_name,
                spent_on: row.spent_on,
                amount_paise: row.amount_paise,
                note: row.note,
                status: row.status,
                void_reason: row.void_reason,
                voided_at: row.voided_at,
                recorded_by: row.recorded_by,
                created_at: row.created_at,
            },
            row.request_hash,
        )
    }))
}
