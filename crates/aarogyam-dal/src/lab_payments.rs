//! Money paid to labs and what each lab is owed. Every function takes the connection of an open
//! clinic transaction. A payment's expense is recorded and voided with it by the use case.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A payment to a lab.
#[derive(Debug, Clone)]
pub struct PaymentRow {
    /// Identifier.
    pub id: Uuid,
    /// The lab.
    pub vendor_id: Uuid,
    /// The order paid for, if one.
    pub lab_order_id: Option<Uuid>,
    /// The clinic day the money went out.
    pub paid_on: Date,
    /// How much.
    pub amount_paise: i64,
    /// The lab's bill number.
    pub lab_invoice_ref: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// The expense recorded with it.
    pub expense_id: Uuid,
    /// `recorded` or `void`.
    pub status: String,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<OffsetDateTime>,
    /// Who recorded it.
    pub recorded_by: Uuid,
    /// When.
    pub created_at: OffsetDateTime,
}

/// A new payment, after its expense.
#[derive(Debug, Clone, Copy)]
pub struct NewPayment<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The lab.
    pub vendor_id: Uuid,
    /// The order paid for.
    pub lab_order_id: Option<Uuid>,
    /// The clinic day.
    pub paid_on: Date,
    /// How much.
    pub amount_paise: i64,
    /// The lab's bill number.
    pub lab_invoice_ref: Option<&'a str>,
    /// A note.
    pub note: Option<&'a str>,
    /// The expense just recorded for it.
    pub expense_id: Uuid,
    /// Who.
    pub recorded_by: Uuid,
}

/// A lab's name, or `None` when the clinic has no such lab.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn vendor_name(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let name = sqlx::query_scalar!(
        "select name from aarogyam.lab_vendors where id = $1 and deleted_at is null",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(name)
}

/// Whether the clinic has this order at this lab.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn order_at_vendor(
    conn: &mut PgConnection,
    order_id: Uuid,
    vendor_id: Uuid,
) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.lab_orders where id = $1 and vendor_id = $2)
             as "found!""#,
        order_id,
        vendor_id
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// Records a payment.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(conn: &mut PgConnection, new: &NewPayment<'_>) -> Result<PaymentRow, DbError> {
    let row = sqlx::query_as!(
        PaymentRow,
        r#"insert into aarogyam.lab_payments
             (id, vendor_id, lab_order_id, paid_on, amount_paise, lab_invoice_ref, note,
              expense_id, recorded_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id, vendor_id, lab_order_id, paid_on, amount_paise, lab_invoice_ref, note,
                     expense_id, status, void_reason, voided_at, recorded_by, created_at"#,
        new.id,
        new.vendor_id,
        new.lab_order_id,
        new.paid_on,
        new.amount_paise,
        new.lab_invoice_ref,
        new.note,
        new.expense_id,
        new.recorded_by
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Payments, voided ones too, newest day first: to one lab or all, paid on clinic days `from`
/// to `to` (both included, either open).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    vendor_id: Option<Uuid>,
    from: Option<Date>,
    to: Option<Date>,
    limit: i64,
) -> Result<Vec<PaymentRow>, DbError> {
    let rows = sqlx::query_as!(
        PaymentRow,
        r#"select id, vendor_id, lab_order_id, paid_on, amount_paise, lab_invoice_ref, note,
                  expense_id, status, void_reason, voided_at, recorded_by, created_at
           from aarogyam.lab_payments
           where ($1::uuid is null or vendor_id = $1)
             and ($2::date is null or paid_on >= $2) and ($3::date is null or paid_on <= $3)
           order by paid_on desc, id desc
           limit $4"#,
        vendor_id,
        from,
        to,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Voids a recorded payment; `None` when there is no recorded payment with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn void(
    conn: &mut PgConnection,
    id: Uuid,
    reason: &str,
    at: OffsetDateTime,
    by: Uuid,
) -> Result<Option<PaymentRow>, DbError> {
    let row = sqlx::query_as!(
        PaymentRow,
        r#"update aarogyam.lab_payments
           set status = 'void', void_reason = $2, voided_at = $3, voided_by = $4
           where id = $1 and status = 'recorded'
           returning id, vendor_id, lab_order_id, paid_on, amount_paise, lab_invoice_ref, note,
                     expense_id, status, void_reason, voided_at, recorded_by, created_at"#,
        id,
        reason,
        at,
        by
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A payment's status, or `None` when the clinic has none with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn status(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!("select status from aarogyam.lab_payments where id = $1", id)
        .fetch_optional(conn)
        .await?;
    Ok(status)
}

/// What a lab has billed and been paid.
#[derive(Debug, Clone)]
pub struct Balance {
    /// The lab's name.
    pub name: String,
    /// Orders sent to it, not cancelled.
    pub orders: i64,
    /// Their items at the lab's prices.
    pub billed_paise: i64,
    /// Payments recorded, not void.
    pub paid_paise: i64,
}

/// A lab's balance, in one statement; `None` when the clinic has no such lab.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn balance(conn: &mut PgConnection, vendor_id: Uuid) -> Result<Option<Balance>, DbError> {
    let row = sqlx::query_as!(
        Balance,
        r#"select v.name,
                  (select count(*) from aarogyam.lab_orders o where o.vendor_id = v.id
                     and o.status not in ('draft', 'cancelled')) as "orders!",
                  (select coalesce(sum(i.qty * coalesce(i.unit_cost_paise, 0)), 0)::bigint
                   from aarogyam.lab_order_items i
                   join aarogyam.lab_orders o on o.org_id = i.org_id and o.id = i.lab_order_id
                   where o.vendor_id = v.id and o.status not in ('draft', 'cancelled'))
                    as "billed_paise!",
                  (select coalesce(sum(p.amount_paise), 0)::bigint from aarogyam.lab_payments p
                   where p.vendor_id = v.id and p.status = 'recorded') as "paid_paise!"
           from aarogyam.lab_vendors v
           where v.id = $1 and v.deleted_at is null"#,
        vendor_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}
