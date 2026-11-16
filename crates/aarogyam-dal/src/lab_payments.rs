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
    /// How it was paid, when recorded.
    pub method: Option<String>,
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
    /// How it was paid.
    pub method: Option<&'a str>,
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
              method, expense_id, recorded_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           returning id, vendor_id, lab_order_id, paid_on, amount_paise, lab_invoice_ref, note,
                     method, expense_id, status, void_reason, voided_at, recorded_by, created_at"#,
        new.id,
        new.vendor_id,
        new.lab_order_id,
        new.paid_on,
        new.amount_paise,
        new.lab_invoice_ref,
        new.note,
        new.method,
        new.expense_id,
        new.recorded_by
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// A listed payment with its current proof, flat as the join returns it.
struct ListedRow {
    id: Uuid,
    vendor_id: Uuid,
    lab_order_id: Option<Uuid>,
    paid_on: Date,
    amount_paise: i64,
    lab_invoice_ref: Option<String>,
    note: Option<String>,
    method: Option<String>,
    expense_id: Uuid,
    status: String,
    void_reason: Option<String>,
    voided_at: Option<OffsetDateTime>,
    recorded_by: Uuid,
    created_at: OffsetDateTime,
    proof_id: Option<Uuid>,
    proof_mime_type: Option<String>,
    proof_size_bytes: Option<i64>,
    proof_file_name: Option<String>,
}

impl From<ListedRow> for (PaymentRow, Option<ProofRow>) {
    fn from(row: ListedRow) -> Self {
        let proof = match (row.proof_id, row.proof_mime_type, row.proof_size_bytes) {
            (Some(id), Some(mime_type), Some(size_bytes)) => Some(ProofRow {
                id,
                lab_payment_id: row.id,
                mime_type,
                size_bytes,
                file_name: row.proof_file_name,
            }),
            _ => None,
        };
        let payment = PaymentRow {
            id: row.id,
            vendor_id: row.vendor_id,
            lab_order_id: row.lab_order_id,
            paid_on: row.paid_on,
            amount_paise: row.amount_paise,
            lab_invoice_ref: row.lab_invoice_ref,
            note: row.note,
            method: row.method,
            expense_id: row.expense_id,
            status: row.status,
            void_reason: row.void_reason,
            voided_at: row.voided_at,
            recorded_by: row.recorded_by,
            created_at: row.created_at,
        };
        (payment, proof)
    }
}

/// Payments, voided ones too, newest day first, each with its current proof: to one lab or all,
/// paid on clinic days `from` to `to` (both included, either open). One query, so the list
/// stays within its round-trip budget.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list(
    conn: &mut PgConnection,
    vendor_id: Option<Uuid>,
    from: Option<Date>,
    to: Option<Date>,
    limit: i64,
) -> Result<Vec<(PaymentRow, Option<ProofRow>)>, DbError> {
    let rows = sqlx::query_as!(
        ListedRow,
        r#"select p.id, p.vendor_id, p.lab_order_id, p.paid_on, p.amount_paise, p.lab_invoice_ref,
                  p.note, p.method, p.expense_id, p.status, p.void_reason, p.voided_at,
                  p.recorded_by, p.created_at,
                  f.id as "proof_id?", f.mime_type as "proof_mime_type?",
                  f.size_bytes as "proof_size_bytes?", f.file_name as "proof_file_name?"
           from aarogyam.lab_payments p
           left join aarogyam.lab_payment_files f
             on f.org_id = p.org_id and f.lab_payment_id = p.id and f.superseded_at is null
           where ($1::uuid is null or p.vendor_id = $1)
             and ($2::date is null or p.paid_on >= $2) and ($3::date is null or p.paid_on <= $3)
           order by p.paid_on desc, p.id desc
           limit $4"#,
        vendor_id,
        from,
        to,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// One payment; `None` when the clinic has none with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<PaymentRow>, DbError> {
    let row = sqlx::query_as!(
        PaymentRow,
        r#"select id, vendor_id, lab_order_id, paid_on, amount_paise, lab_invoice_ref, note,
                  method, expense_id, status, void_reason, voided_at, recorded_by, created_at
           from aarogyam.lab_payments where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
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
                     method, expense_id, status, void_reason, voided_at, recorded_by, created_at"#,
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

/// The current proof of a payment.
#[derive(Debug, Clone)]
pub struct ProofRow {
    /// Identifier; also the name of the bytes in storage.
    pub id: Uuid,
    /// The payment it proves.
    pub lab_payment_id: Uuid,
    /// `image/jpeg`, `image/png` or `application/pdf`.
    pub mime_type: String,
    /// Bytes.
    pub size_bytes: i64,
    /// The name the uploader's device gave it, tidied.
    pub file_name: Option<String>,
}

/// A new proof file.
#[derive(Debug, Clone, Copy)]
pub struct NewProof<'a> {
    /// Identifier, also the storage name.
    pub id: Uuid,
    /// The payment.
    pub lab_payment_id: Uuid,
    /// Media type.
    pub mime_type: &'a str,
    /// Bytes.
    pub size_bytes: i64,
    /// Tidied file name.
    pub file_name: Option<&'a str>,
}

/// The current proofs of these payments.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn current_proofs(
    conn: &mut PgConnection,
    payment_ids: &[Uuid],
) -> Result<Vec<ProofRow>, DbError> {
    let rows = sqlx::query_as!(
        ProofRow,
        r#"select id, lab_payment_id, mime_type, size_bytes, file_name
           from aarogyam.lab_payment_files
           where lab_payment_id = any($1) and superseded_at is null"#,
        payment_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A proof file by id, current or superseded; `None` when the clinic has none.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn proof_file(conn: &mut PgConnection, id: Uuid) -> Result<Option<ProofRow>, DbError> {
    let row = sqlx::query_as!(
        ProofRow,
        r#"select id, lab_payment_id, mime_type, size_bytes, file_name
           from aarogyam.lab_payment_files where id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Locks a payment and returns its status; `None` when the clinic has none with `id`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_status(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!(
        "select status from aarogyam.lab_payments where id = $1 for update",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(status)
}

/// Marks the payment's current proof superseded, if it has one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn supersede_proof(conn: &mut PgConnection, payment_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.lab_payment_files set superseded_at = now()
         where lab_payment_id = $1 and superseded_at is null",
        payment_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Adds a proof file as the payment's current one (supersede the old one first).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_proof(conn: &mut PgConnection, new: &NewProof<'_>) -> Result<(), DbError> {
    sqlx::query!(
        "insert into aarogyam.lab_payment_files (id, lab_payment_id, mime_type, size_bytes, file_name)
         values ($1, $2, $3, $4, $5)",
        new.id,
        new.lab_payment_id,
        new.mime_type,
        new.size_bytes,
        new.file_name
    )
    .execute(conn)
    .await?;
    Ok(())
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
