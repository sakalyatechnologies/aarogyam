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
    /// How it was paid, when recorded.
    pub method: Option<String>,
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
    /// How it was paid.
    pub method: Option<&'a str>,
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
                                            idempotency_key, request_hash, method)
             select $1, c.id, $3, $4, $5, $6, $7, $8, $9 from c
             returning id, category_id, spent_on, amount_paise, note, method, status, void_reason,
                       voided_at, recorded_by, created_at
           )
           select e.id as "id!", e.category_id as "category_id!", c.key as "category_key!",
                  c.name as "category_name!", e.spent_on as "spent_on!",
                  e.amount_paise as "amount_paise!", e.note, e.method, e.status as "status!",
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
        new.method,
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A listed expense with its current bill, flat as the join returns it.
struct ListedRow {
    id: Uuid,
    category_id: Uuid,
    category_key: String,
    category_name: String,
    spent_on: Date,
    amount_paise: i64,
    note: Option<String>,
    method: Option<String>,
    status: String,
    void_reason: Option<String>,
    voided_at: Option<OffsetDateTime>,
    recorded_by: Uuid,
    created_at: OffsetDateTime,
    bill_id: Option<Uuid>,
    bill_mime_type: Option<String>,
    bill_size_bytes: Option<i64>,
    bill_file_name: Option<String>,
}

impl From<ListedRow> for (ExpenseRow, Option<BillRow>) {
    fn from(row: ListedRow) -> Self {
        let bill = match (row.bill_id, row.bill_mime_type, row.bill_size_bytes) {
            (Some(id), Some(mime_type), Some(size_bytes)) => Some(BillRow {
                id,
                expense_id: row.id,
                mime_type,
                size_bytes,
                file_name: row.bill_file_name,
            }),
            _ => None,
        };
        let expense = ExpenseRow {
            id: row.id,
            category_id: row.category_id,
            category_key: row.category_key,
            category_name: row.category_name,
            spent_on: row.spent_on,
            amount_paise: row.amount_paise,
            note: row.note,
            method: row.method,
            status: row.status,
            void_reason: row.void_reason,
            voided_at: row.voided_at,
            recorded_by: row.recorded_by,
            created_at: row.created_at,
        };
        (expense, bill)
    }
}

/// Expenses spent on clinic days `from` to `to` (both included, either open), voided ones
/// too, newest day first, each with its current bill. One query, so the list stays within its
/// round-trip budget.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    from: Option<Date>,
    to: Option<Date>,
    limit: i64,
) -> Result<Vec<(ExpenseRow, Option<BillRow>)>, DbError> {
    let rows = sqlx::query_as!(
        ListedRow,
        r#"select e.id, e.category_id, c.key as category_key, c.name as category_name, e.spent_on,
                  e.amount_paise, e.note, e.method, e.status, e.void_reason, e.voided_at,
                  e.recorded_by, e.created_at,
                  f.id as "bill_id?", f.mime_type as "bill_mime_type?",
                  f.size_bytes as "bill_size_bytes?", f.file_name as "bill_file_name?"
           from aarogyam.expenses e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id
           left join aarogyam.expense_files f
             on f.org_id = e.org_id and f.expense_id = e.id and f.superseded_at is null
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
    Ok(rows.into_iter().map(Into::into).collect())
}

/// One expense; `None` when the clinic has none with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<ExpenseRow>, DbError> {
    let row = sqlx::query_as!(
        ExpenseRow,
        r#"select e.id, e.category_id, c.key as category_key, c.name as category_name, e.spent_on,
                  e.amount_paise, e.note, e.method, e.status, e.void_reason, e.voided_at,
                  e.recorded_by, e.created_at
           from aarogyam.expenses e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id
           where e.id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
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
             returning org_id, id, category_id, spent_on, amount_paise, note, method, status,
                       void_reason, voided_at, recorded_by, created_at
           )
           select e.id as "id!", e.category_id as "category_id!", c.key as "category_key!",
                  c.name as "category_name!", e.spent_on as "spent_on!",
                  e.amount_paise as "amount_paise!", e.note, e.method, e.status as "status!",
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
                  e.amount_paise, e.note, e.method, e.status, e.void_reason, e.voided_at,
                  e.recorded_by, e.created_at, e.request_hash as "request_hash!"
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
                method: row.method,
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

/// The current bill of an expense.
#[derive(Debug, Clone)]
pub struct BillRow {
    /// Identifier; also the name of the bytes in storage.
    pub id: Uuid,
    /// The expense it belongs to.
    pub expense_id: Uuid,
    /// `image/jpeg`, `image/png` or `application/pdf`.
    pub mime_type: String,
    /// Bytes.
    pub size_bytes: i64,
    /// The name the uploader's device gave it, tidied.
    pub file_name: Option<String>,
}

/// A new bill file.
#[derive(Debug, Clone, Copy)]
pub struct NewBill<'a> {
    /// Identifier, also the storage name.
    pub id: Uuid,
    /// The expense.
    pub expense_id: Uuid,
    /// Media type.
    pub mime_type: &'a str,
    /// Bytes.
    pub size_bytes: i64,
    /// Tidied file name.
    pub file_name: Option<&'a str>,
}

/// The current bills of these expenses.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn current_bills(
    conn: &mut PgConnection,
    expense_ids: &[Uuid],
) -> Result<Vec<BillRow>, DbError> {
    let rows = sqlx::query_as!(
        BillRow,
        r#"select id, expense_id, mime_type, size_bytes, file_name
           from aarogyam.expense_files
           where expense_id = any($1) and superseded_at is null"#,
        expense_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A bill file by id, current or superseded; `None` when the clinic has none.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn bill_file(conn: &mut PgConnection, id: Uuid) -> Result<Option<BillRow>, DbError> {
    let row = sqlx::query_as!(
        BillRow,
        r#"select id, expense_id, mime_type, size_bytes, file_name
           from aarogyam.expense_files where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Locks an expense and returns its status; `None` when the clinic has none with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_status(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!(
        "select status from aarogyam.expenses where id = $1 for update",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(status)
}

/// Marks the expense's current bill superseded, if it has one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn supersede_bill(conn: &mut PgConnection, expense_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.expense_files set superseded_at = now()
         where expense_id = $1 and superseded_at is null",
        expense_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Adds a bill file as the expense's current one (supersede the old one first).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_bill(conn: &mut PgConnection, new: &NewBill<'_>) -> Result<(), DbError> {
    sqlx::query!(
        "insert into aarogyam.expense_files (id, expense_id, mime_type, size_bytes, file_name)
         values ($1, $2, $3, $4, $5)",
        new.id,
        new.expense_id,
        new.mime_type,
        new.size_bytes,
        new.file_name
    )
    .execute(conn)
    .await?;
    Ok(())
}
