//! Price list, bills and payments. Every function takes the connection of an open clinic
//! transaction, so row-level security limits it to that clinic. Amounts are paise.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A price list entry as stored.
#[derive(Debug, Clone)]
pub struct PriceItemRow {
    /// Identifier.
    pub id: Uuid,
    /// Short code, unique in the clinic.
    pub code: Option<String>,
    /// Name.
    pub name: String,
    /// Revenue-mix category.
    pub category: Option<String>,
    /// SAC or HSN code.
    pub sac_hsn: Option<String>,
    /// Default price.
    pub price_paise: i64,
    /// Whether GST applies.
    pub taxable: bool,
    /// GST rate in basis points.
    pub tax_rate_bps: i32,
    /// Offered.
    pub active: bool,
}

/// A price list entry's values.
#[derive(Debug, Clone)]
pub struct PriceItemValues<'a> {
    /// Short code.
    pub code: Option<&'a str>,
    /// Name.
    pub name: &'a str,
    /// Category.
    pub category: Option<&'a str>,
    /// SAC or HSN.
    pub sac_hsn: Option<&'a str>,
    /// Default price.
    pub price_paise: i64,
    /// Whether GST applies.
    pub taxable: bool,
    /// GST rate in basis points.
    pub tax_rate_bps: i32,
    /// Offered.
    pub active: bool,
}

/// The price list, by name.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn price_items(conn: &mut PgConnection) -> Result<Vec<PriceItemRow>, DbError> {
    let rows = sqlx::query_as!(
        PriceItemRow,
        r#"select id, code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps, active
           from aarogyam.price_items where deleted_at is null order by name, id"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One price list entry.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn price_item(
    conn: &mut PgConnection,
    id: Uuid,
) -> Result<Option<PriceItemRow>, DbError> {
    let row = sqlx::query_as!(
        PriceItemRow,
        r#"select id, code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps, active
           from aarogyam.price_items where id = $1 and deleted_at is null"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Adds a price list entry.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken code (a conflict).
pub async fn insert_price_item(
    conn: &mut PgConnection,
    id: Uuid,
    values: &PriceItemValues<'_>,
) -> Result<PriceItemRow, DbError> {
    let row = sqlx::query_as!(
        PriceItemRow,
        r#"insert into aarogyam.price_items
             (id, code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps, active)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id, code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps, active"#,
        id,
        values.code,
        values.name,
        values.category,
        values.sac_hsn,
        values.price_paise,
        values.taxable,
        values.tax_rate_bps,
        values.active
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Saves a price list entry's values.
///
/// # Errors
/// [`DbError`] on a database failure, including a taken code (a conflict).
pub async fn update_price_item(
    conn: &mut PgConnection,
    id: Uuid,
    values: &PriceItemValues<'_>,
) -> Result<Option<PriceItemRow>, DbError> {
    let row = sqlx::query_as!(
        PriceItemRow,
        r#"update aarogyam.price_items
           set code = $2, name = $3, category = $4, sac_hsn = $5, price_paise = $6, taxable = $7,
               tax_rate_bps = $8, active = $9
           where id = $1 and deleted_at is null
           returning id, code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps, active"#,
        id,
        values.code,
        values.name,
        values.category,
        values.sac_hsn,
        values.price_paise,
        values.taxable,
        values.tax_rate_bps,
        values.active
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The supplier on a bill: the clinic and its default branch.
#[derive(Debug, Clone)]
pub struct SupplierRow {
    /// The clinic's display name.
    pub name: String,
    /// Registered legal name.
    pub legal_name: Option<String>,
    /// The clinic's GSTIN.
    pub org_gstin: Option<String>,
    /// Prefix of bill numbers.
    pub number_prefix: String,
    /// IANA time zone.
    pub timezone: String,
    /// The default branch.
    pub branch_id: Option<Uuid>,
    /// The branch's GSTIN, when it has its own.
    pub branch_gstin: Option<String>,
    /// The branch's state code.
    pub state_code: Option<String>,
    /// The branch's address.
    pub address: Option<Value>,
    /// The branch's phone.
    pub phone_e164: Option<String>,
}

/// The current clinic as a supplier.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn supplier(conn: &mut PgConnection) -> Result<Option<SupplierRow>, DbError> {
    let row = sqlx::query_as!(
        SupplierRow,
        r#"select o.name, o.legal_name, o.gstin as org_gstin, o.number_prefix, o.timezone,
                  b.id as "branch_id?", b.gstin as branch_gstin, b.state_code, b.address as "address?",
                  b.phone_e164
           from aarogyam.organizations o
           left join aarogyam.branches b on b.org_id = o.id and b.is_default and b.deleted_at is null
           where o.id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A bill with its patient and what has been paid towards it.
#[derive(Debug, Clone)]
pub struct InvoiceRow {
    /// Identifier.
    pub id: Uuid,
    /// Number, once issued.
    pub number: Option<String>,
    /// The patient.
    pub patient_id: Uuid,
    /// The patient's name.
    pub patient_name: String,
    /// The patient's number.
    pub patient_number: String,
    /// The visit, if any.
    pub encounter_id: Option<Uuid>,
    /// The branch.
    pub branch_id: Uuid,
    /// `tax_invoice` or `bill_of_supply`, once issued.
    pub doc_type: Option<String>,
    /// `draft`, `issued` or `void`.
    pub status: String,
    /// Place of supply state code.
    pub place_of_supply: Option<String>,
    /// Notes printed on the bill.
    pub notes: Option<String>,
    /// When issued.
    pub issued_at: Option<OffsetDateTime>,
    /// Supplier snapshot.
    pub supplier: Option<Value>,
    /// Patient snapshot.
    pub recipient: Option<Value>,
    /// Gross.
    pub subtotal_paise: i64,
    /// Discounts.
    pub discount_paise: i64,
    /// Taxable value.
    pub taxable_paise: i64,
    /// CGST.
    pub cgst_paise: i64,
    /// SGST.
    pub sgst_paise: i64,
    /// IGST.
    pub igst_paise: i64,
    /// All GST.
    pub tax_paise: i64,
    /// Round-off.
    pub round_off_paise: i64,
    /// Total.
    pub total_paise: i64,
    /// Paid by payments that aren't void.
    pub paid_paise: i64,
    /// Methods of those payments.
    pub methods: Vec<String>,
    /// The voided bill this one replaces.
    pub replaces_invoice_id: Option<Uuid>,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<OffsetDateTime>,
    /// When the draft was started.
    pub created_at: OffsetDateTime,
}

/// What to list. Every filter is optional.
#[derive(Debug, Clone, Copy, Default)]
pub struct InvoiceFilter {
    /// One bill.
    pub id: Option<Uuid>,
    /// `draft`, `issued` or `void`.
    pub status: Option<&'static str>,
    /// One patient's bills.
    pub patient_id: Option<Uuid>,
    /// Issued (or started, for drafts) at or after.
    pub from: Option<OffsetDateTime>,
    /// Issued (or started) before.
    pub to: Option<OffsetDateTime>,
    /// Only issued bills with something left to pay.
    pub with_balance: bool,
    /// Most rows.
    pub limit: i64,
}

/// Bills matching `filter`, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn invoices(
    conn: &mut PgConnection,
    filter: &InvoiceFilter,
) -> Result<Vec<InvoiceRow>, DbError> {
    let rows = sqlx::query_as!(
        InvoiceRow,
        r#"select i.id, i.number, i.patient_id, p.full_name as patient_name, p.number as patient_number,
                  i.encounter_id, i.branch_id, i.doc_type, i.status, i.place_of_supply, i.notes,
                  i.issued_at, i.supplier, i.recipient, i.subtotal_paise, i.discount_paise,
                  i.taxable_paise, i.cgst_paise, i.sgst_paise, i.igst_paise, i.tax_paise,
                  i.round_off_paise, i.total_paise,
                  coalesce(paid.amount, 0)::bigint as "paid_paise!",
                  coalesce(paid.methods, '{}') as "methods!",
                  i.replaces_invoice_id, i.void_reason, i.voided_at, i.created_at
           from aarogyam.invoices i
           join aarogyam.patients p on p.org_id = i.org_id and p.id = i.patient_id
           left join lateral (
             select sum(a.amount_paise) as amount,
                    array_agg(distinct m.method order by m.method) as methods
             from aarogyam.payment_allocations a
             join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
             where a.org_id = i.org_id and a.invoice_id = i.id and m.status = 'received'
           ) paid on true
           where ($1::uuid is null or i.id = $1)
             and ($2::text is null or i.status = $2)
             and ($3::uuid is null or i.patient_id = $3)
             and ($4::timestamptz is null or coalesce(i.issued_at, i.created_at) >= $4)
             and ($5::timestamptz is null or coalesce(i.issued_at, i.created_at) < $5)
             and (not $6 or (i.status = 'issued' and i.total_paise > coalesce(paid.amount, 0)))
           order by coalesce(i.issued_at, i.created_at) desc, i.id desc
           limit $7"#,
        filter.id,
        filter.status,
        filter.patient_id,
        filter.from,
        filter.to,
        filter.with_balance,
        filter.limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A bill's state, locked until the transaction ends.
#[derive(Debug, Clone)]
pub struct InvoiceLock {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// `draft`, `issued` or `void`.
    pub status: String,
    /// Total.
    pub total_paise: i64,
    /// Paid by payments that aren't void.
    pub paid_paise: i64,
    /// Place of supply.
    pub place_of_supply: Option<String>,
}

/// Locks bills and reads their state, so concurrent payments and voids apply one at a time.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_invoices(
    conn: &mut PgConnection,
    ids: &[Uuid],
) -> Result<Vec<InvoiceLock>, DbError> {
    let rows = sqlx::query_as!(
        InvoiceLock,
        r#"select i.id, i.patient_id, i.status, i.total_paise, i.place_of_supply,
                  coalesce((select sum(a.amount_paise)
                            from aarogyam.payment_allocations a
                            join aarogyam.payments m on m.org_id = a.org_id and m.id = a.payment_id
                            where a.org_id = i.org_id and a.invoice_id = i.id and m.status = 'received'),
                           0)::bigint as "paid_paise!"
           from aarogyam.invoices i
           where i.id = any($1)
           order by i.id
           for update of i"#,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A new draft bill.
#[derive(Debug, Clone)]
pub struct NewInvoice<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// The visit, if any.
    pub encounter_id: Option<Uuid>,
    /// The branch.
    pub branch_id: Uuid,
    /// Place of supply.
    pub place_of_supply: Option<&'a str>,
    /// Notes.
    pub notes: Option<&'a str>,
    /// The voided bill this one replaces.
    pub replaces_invoice_id: Option<Uuid>,
}

/// Starts a draft bill.
///
/// # Errors
/// [`DbError`] on a database failure (an unknown patient or replaced bill is a conflict).
pub async fn insert_invoice(conn: &mut PgConnection, new: &NewInvoice<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.invoices
             (id, patient_id, encounter_id, branch_id, place_of_supply, notes, replaces_invoice_id)
           values ($1, $2, $3, $4, $5, $6, $7)"#,
        new.id,
        new.patient_id,
        new.encounter_id,
        new.branch_id,
        new.place_of_supply,
        new.notes,
        new.replaces_invoice_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Changes a draft's header.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_draft(
    conn: &mut PgConnection,
    id: Uuid,
    encounter_id: Option<Uuid>,
    place_of_supply: Option<&str>,
    notes: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.invoices set encounter_id = $2, place_of_supply = $3, notes = $4
           where id = $1 and status = 'draft'"#,
        id,
        encounter_id,
        place_of_supply,
        notes
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A bill line as stored.
#[derive(Debug, Clone)]
pub struct InvoiceLineRow {
    /// Identifier.
    pub id: Uuid,
    /// Position, from 1.
    pub line_no: i16,
    /// The price list entry, if any.
    pub price_item_id: Option<Uuid>,
    /// The procedure, if any.
    pub procedure_id: Option<Uuid>,
    /// As printed.
    pub description: String,
    /// SAC or HSN.
    pub sac_hsn: Option<String>,
    /// Revenue-mix category.
    pub category: Option<String>,
    /// How many.
    pub quantity: i32,
    /// Price of one.
    pub unit_price_paise: i64,
    /// Discount on the line.
    pub discount_paise: i64,
    /// GST rate.
    pub tax_rate_bps: i32,
    /// Taxable value, at issue.
    pub taxable_paise: i64,
    /// CGST, at issue.
    pub cgst_paise: i64,
    /// SGST, at issue.
    pub sgst_paise: i64,
    /// IGST, at issue.
    pub igst_paise: i64,
    /// Total, at issue.
    pub total_paise: i64,
}

/// A bill's lines in order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn invoice_lines(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Vec<InvoiceLineRow>, DbError> {
    let rows = sqlx::query_as!(
        InvoiceLineRow,
        r#"select id, line_no, price_item_id, procedure_id, description, sac_hsn, category, quantity,
                  unit_price_paise, discount_paise, tax_rate_bps, taxable_paise, cgst_paise, sgst_paise,
                  igst_paise, total_paise
           from aarogyam.invoice_items where invoice_id = $1 order by line_no"#,
        invoice_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Removes a draft's lines (`app.clear_draft_invoice_lines`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clear_draft_lines(conn: &mut PgConnection, invoice_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        "select app.clear_draft_invoice_lines($1) as cleared",
        invoice_id
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// Adds a line to a draft. Amounts other than price and discount are filled in at issue.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_line(
    conn: &mut PgConnection,
    invoice_id: Uuid,
    line: &InvoiceLineRow,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.invoice_items
             (id, invoice_id, line_no, price_item_id, procedure_id, description, sac_hsn, category,
              quantity, unit_price_paise, discount_paise, tax_rate_bps)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"#,
        line.id,
        invoice_id,
        line.line_no,
        line.price_item_id,
        line.procedure_id,
        line.description,
        line.sac_hsn,
        line.category,
        line.quantity,
        line.unit_price_paise,
        line.discount_paise,
        line.tax_rate_bps
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Saves a line's computed amounts, while the bill is still a draft.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_line_amounts(
    conn: &mut PgConnection,
    line: &InvoiceLineRow,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.invoice_items
           set tax_rate_bps = $2, taxable_paise = $3, cgst_paise = $4, sgst_paise = $5,
               igst_paise = $6, total_paise = $7
           where id = $1"#,
        line.id,
        line.tax_rate_bps,
        line.taxable_paise,
        line.cgst_paise,
        line.sgst_paise,
        line.igst_paise,
        line.total_paise
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// What issuing writes on the bill.
#[derive(Debug, Clone)]
pub struct IssuedInvoice<'a> {
    /// The number.
    pub number: &'a str,
    /// Its financial year.
    pub financial_year: &'a str,
    /// `tax_invoice` or `bill_of_supply`.
    pub doc_type: &'a str,
    /// When.
    pub issued_at: OffsetDateTime,
    /// By whom (membership).
    pub issued_by: Uuid,
    /// Supplier snapshot.
    pub supplier: Value,
    /// Patient snapshot.
    pub recipient: Value,
    /// Gross.
    pub subtotal_paise: i64,
    /// Discounts.
    pub discount_paise: i64,
    /// Taxable value.
    pub taxable_paise: i64,
    /// CGST.
    pub cgst_paise: i64,
    /// SGST.
    pub sgst_paise: i64,
    /// IGST.
    pub igst_paise: i64,
    /// All GST.
    pub tax_paise: i64,
    /// Round-off.
    pub round_off_paise: i64,
    /// Total.
    pub total_paise: i64,
}

/// Issues a draft.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn issue(
    conn: &mut PgConnection,
    id: Uuid,
    issued: &IssuedInvoice<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.invoices
           set status = 'issued', number = $2, financial_year = $3, doc_type = $4, issued_at = $5,
               issued_by = $6, supplier = $7, recipient = $8, subtotal_paise = $9, discount_paise = $10,
               taxable_paise = $11, cgst_paise = $12, sgst_paise = $13, igst_paise = $14,
               tax_paise = $15, round_off_paise = $16, total_paise = $17
           where id = $1 and status = 'draft'"#,
        id,
        issued.number,
        issued.financial_year,
        issued.doc_type,
        issued.issued_at,
        issued.issued_by,
        issued.supplier,
        issued.recipient,
        issued.subtotal_paise,
        issued.discount_paise,
        issued.taxable_paise,
        issued.cgst_paise,
        issued.sgst_paise,
        issued.igst_paise,
        issued.tax_paise,
        issued.round_off_paise,
        issued.total_paise
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Voids a bill.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn void_invoice(
    conn: &mut PgConnection,
    id: Uuid,
    reason: &str,
    at: OffsetDateTime,
    by: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.invoices
           set status = 'void', void_reason = $2, voided_at = $3, voided_by = $4
           where id = $1 and status <> 'void'"#,
        id,
        reason,
        at,
        by
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A payment as stored, with its patient.
#[derive(Debug, Clone)]
pub struct PaymentRow {
    /// Identifier.
    pub id: Uuid,
    /// Receipt number.
    pub number: String,
    /// The patient.
    pub patient_id: Uuid,
    /// The patient's name.
    pub patient_name: String,
    /// The patient's number.
    pub patient_number: String,
    /// When received.
    pub received_at: OffsetDateTime,
    /// Amount.
    pub amount_paise: i64,
    /// `cash`, `upi`, `card` or `bank`.
    pub method: String,
    /// UPI or card reference.
    pub reference: Option<String>,
    /// `received` or `void`.
    pub status: String,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// Hash of the request that created it.
    pub request_hash: String,
    /// Allocated to bills.
    pub allocated_paise: i64,
}

/// Payments received in `[from, to)`, or one payment, or the payment with an idempotency key.
#[derive(Debug, Clone, Copy, Default)]
pub struct PaymentFilter<'a> {
    /// One payment.
    pub id: Option<Uuid>,
    /// The payment made with this key.
    pub idempotency_key: Option<&'a str>,
    /// Received at or after.
    pub from: Option<OffsetDateTime>,
    /// Received before.
    pub to: Option<OffsetDateTime>,
    /// Most rows.
    pub limit: i64,
}

/// Payments matching `filter`, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn payments(
    conn: &mut PgConnection,
    filter: &PaymentFilter<'_>,
) -> Result<Vec<PaymentRow>, DbError> {
    let rows = sqlx::query_as!(
        PaymentRow,
        r#"select m.id, m.number, m.patient_id, p.full_name as patient_name, p.number as patient_number,
                  m.received_at, m.amount_paise, m.method, m.reference, m.status, m.void_reason,
                  m.request_hash,
                  coalesce((select sum(a.amount_paise) from aarogyam.payment_allocations a
                            where a.org_id = m.org_id and a.payment_id = m.id), 0)::bigint as "allocated_paise!"
           from aarogyam.payments m
           join aarogyam.patients p on p.org_id = m.org_id and p.id = m.patient_id
           where ($1::uuid is null or m.id = $1)
             and ($2::text is null or m.idempotency_key = $2)
             and ($3::timestamptz is null or m.received_at >= $3)
             and ($4::timestamptz is null or m.received_at < $4)
           order by m.received_at desc, m.id desc
           limit $5"#,
        filter.id,
        filter.idempotency_key,
        filter.from,
        filter.to,
        filter.limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// An allocation, with the bill's number.
#[derive(Debug, Clone)]
pub struct AllocationRow {
    /// The payment.
    pub payment_id: Uuid,
    /// The bill.
    pub invoice_id: Uuid,
    /// The bill's number.
    pub invoice_number: Option<String>,
    /// Amount.
    pub amount_paise: i64,
}

/// The allocations of the given payments.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn allocations(
    conn: &mut PgConnection,
    payment_ids: &[Uuid],
) -> Result<Vec<AllocationRow>, DbError> {
    let rows = sqlx::query_as!(
        AllocationRow,
        r#"select a.payment_id, a.invoice_id, i.number as invoice_number, a.amount_paise
           from aarogyam.payment_allocations a
           join aarogyam.invoices i on i.org_id = a.org_id and i.id = a.invoice_id
           where a.payment_id = any($1)
           order by a.payment_id, a.created_at, a.id"#,
        payment_ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A new payment.
#[derive(Debug, Clone)]
pub struct NewPayment<'a> {
    /// Identifier.
    pub id: Uuid,
    /// Receipt number.
    pub number: &'a str,
    /// The patient.
    pub patient_id: Uuid,
    /// When.
    pub received_at: OffsetDateTime,
    /// Amount.
    pub amount_paise: i64,
    /// Method.
    pub method: &'a str,
    /// Reference.
    pub reference: Option<&'a str>,
    /// Who took it (membership).
    pub received_by: Uuid,
    /// The client's idempotency key.
    pub idempotency_key: &'a str,
    /// Hash of the request.
    pub request_hash: &'a str,
}

/// Records a payment.
///
/// # Errors
/// [`DbError`] on a database failure; a reused idempotency key is a conflict on
/// `payments_idempotency`.
pub async fn insert_payment(conn: &mut PgConnection, new: &NewPayment<'_>) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.payments
             (id, number, patient_id, received_at, amount_paise, method, reference, received_by,
              idempotency_key, request_hash)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
        new.id,
        new.number,
        new.patient_id,
        new.received_at,
        new.amount_paise,
        new.method,
        new.reference,
        new.received_by,
        new.idempotency_key,
        new.request_hash
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Allocates part of a payment to a bill of the same patient.
///
/// # Errors
/// [`DbError`] on a database failure; the trigger refuses over-allocation as invalid.
pub async fn insert_allocation(
    conn: &mut PgConnection,
    payment_id: Uuid,
    invoice_id: Uuid,
    patient_id: Uuid,
    amount_paise: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.payment_allocations (payment_id, invoice_id, patient_id, amount_paise)
           values ($1, $2, $3, $4)"#,
        payment_id,
        invoice_id,
        patient_id,
        amount_paise
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Locks a payment and returns its status.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_payment(conn: &mut PgConnection, id: Uuid) -> Result<Option<String>, DbError> {
    let status = sqlx::query_scalar!(
        "select status from aarogyam.payments where id = $1 for update",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(status)
}

/// Voids a payment.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn void_payment(
    conn: &mut PgConnection,
    id: Uuid,
    reason: &str,
    at: OffsetDateTime,
    by: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.payments
           set status = 'void', void_reason = $2, voided_at = $3, voided_by = $4
           where id = $1 and status = 'received'"#,
        id,
        reason,
        at,
        by
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Issues the next number of `kind` in `period` (`app.next_number`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn next_number(
    conn: &mut PgConnection,
    kind: &str,
    period: &str,
) -> Result<i64, DbError> {
    let value = sqlx::query_scalar!(
        r#"select app.next_number($1, 'main', $2) as "value!""#,
        kind,
        period
    )
    .fetch_one(conn)
    .await?;
    Ok(value)
}

/// Money received on one clinic day by one method.
#[derive(Debug, Clone)]
pub struct CollectionRow {
    /// The clinic day.
    pub day: time::Date,
    /// `cash`, `upi`, `card` or `bank`.
    pub method: String,
    /// Received, in paise.
    pub amount_paise: i64,
    /// How many payments.
    pub payments: i64,
}

/// Revenue in one category.
#[derive(Debug, Clone)]
pub struct MixRow {
    /// The price list category; `other` for free-text lines.
    pub category: String,
    /// Billed, in paise, including GST.
    pub amount_paise: i64,
}

/// The money figures a dashboard shows, read in one round trip: payments by day and method
/// over `payments`, bills issued over `bills` (count and total), and revenue by category over
/// `mix`. Each range is `[from, to)`; days are clinic days in `timezone`.
#[derive(Debug, Clone, Default)]
pub struct MoneyOverview {
    /// Payments that aren't void, by clinic day and method, ordered by day then method.
    pub collections: Vec<CollectionRow>,
    /// Bills issued and not void: how many, and their total in paise.
    pub invoiced: (i64, i64),
    /// Lines of bills issued and not void, by category, largest first.
    pub mix: Vec<MixRow>,
}

/// Date ranges for [`money_overview`].
#[derive(Debug, Clone, Copy)]
pub struct MoneyRanges {
    /// Payments received in `[from, to)`.
    pub payments: (OffsetDateTime, OffsetDateTime),
    /// Bills issued in `[from, to)`.
    pub bills: (OffsetDateTime, OffsetDateTime),
    /// Bill lines issued in `[from, to)`, for the revenue mix.
    pub mix: (OffsetDateTime, OffsetDateTime),
}

/// Payments, bills issued and the revenue mix in one statement, so a dashboard costs one round
/// trip instead of three.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn money_overview(
    conn: &mut PgConnection,
    ranges: MoneyRanges,
    timezone: &str,
) -> Result<MoneyOverview, DbError> {
    let rows = sqlx::query!(
        r#"select 'c'::text as "kind!", (m.received_at at time zone $3)::date as "day?",
                  m.method as "key?", sum(m.amount_paise)::bigint as "amount!",
                  count(*)::bigint as "count!"
           from aarogyam.payments m
           where m.status = 'received' and m.received_at >= $1 and m.received_at < $2
           group by 2, 3
           union all
           select 'i', null, null, coalesce(sum(i.total_paise), 0)::bigint, count(*)
           from aarogyam.invoices i
           where i.status = 'issued' and i.issued_at >= $4 and i.issued_at < $5
           union all
           select 'm', null, coalesce(l.category, 'other'), sum(l.total_paise)::bigint, count(*)
           from aarogyam.invoice_items l
           join aarogyam.invoices i on i.org_id = l.org_id and i.id = l.invoice_id
           where i.status = 'issued' and i.issued_at >= $6 and i.issued_at < $7
           group by 3"#,
        ranges.payments.0,
        ranges.payments.1,
        timezone,
        ranges.bills.0,
        ranges.bills.1,
        ranges.mix.0,
        ranges.mix.1,
    )
    .fetch_all(conn)
    .await?;
    let mut overview = MoneyOverview::default();
    for row in rows {
        match (row.kind.as_str(), row.day, row.key) {
            ("c", Some(day), Some(method)) => overview.collections.push(CollectionRow {
                day,
                method,
                amount_paise: row.amount,
                payments: row.count,
            }),
            ("i", _, _) => overview.invoiced = (row.count, row.amount),
            ("m", _, Some(category)) => overview.mix.push(MixRow {
                category,
                amount_paise: row.amount,
            }),
            _ => {}
        }
    }
    overview
        .collections
        .sort_by(|a, b| (a.day, &a.method).cmp(&(b.day, &b.method)));
    overview.mix.sort_by(|a, b| {
        b.amount_paise
            .cmp(&a.amount_paise)
            .then_with(|| a.category.cmp(&b.category))
    });
    Ok(overview)
}
