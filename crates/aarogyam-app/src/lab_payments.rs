//! Money paid to labs. Recording a payment records an expense in the `lab` category in the
//! same transaction, and voiding one voids its expense, so reports count lab spending once.
//! Payments need `expenses.write` and `finance.view`; listing and balances need `finance.view`.

use aarogyam_dal::expenses::{self as expenses_dal, NewExpense};
use aarogyam_dal::lab_payments::{self as dal, NewPayment, PaymentRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::expense::{ExpenseCategoryKey, check_amount, check_note};
use aarogyam_domain::ids::{ExpenseId, LabOrderId, LabPaymentId, LabVendorId, MembershipId};
use aarogyam_domain::lab::LabPaymentStatus;
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::void_reason;
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::labs::trimmed;
use crate::scope::staff_scope as scope;

/// Most payments one list returns.
pub const MAX_LIST: i64 = 500;

/// A payment to a lab.
#[derive(Debug, Clone)]
pub struct PaymentView {
    /// Identifier.
    pub id: LabPaymentId,
    /// The lab.
    pub vendor_id: LabVendorId,
    /// The order paid for.
    pub lab_order_id: Option<LabOrderId>,
    /// The clinic day the money went out.
    pub paid_on: Date,
    /// How much.
    pub amount: Paise,
    /// The lab's bill number.
    pub lab_invoice_ref: Option<String>,
    /// A note.
    pub note: Option<String>,
    /// The expense recorded with it.
    pub expense_id: ExpenseId,
    /// Recorded or void.
    pub status: LabPaymentStatus,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<OffsetDateTime>,
    /// Who recorded it.
    pub recorded_by: MembershipId,
    /// When.
    pub created_at: OffsetDateTime,
}

fn view(row: PaymentRow) -> PaymentView {
    PaymentView {
        id: LabPaymentId::from_uuid(row.id),
        vendor_id: LabVendorId::from_uuid(row.vendor_id),
        lab_order_id: row.lab_order_id.map(LabOrderId::from_uuid),
        paid_on: row.paid_on,
        amount: Paise::new(row.amount_paise),
        lab_invoice_ref: row.lab_invoice_ref,
        note: row.note,
        expense_id: ExpenseId::from_uuid(row.expense_id),
        status: LabPaymentStatus::parse(&row.status).unwrap_or(LabPaymentStatus::Recorded),
        void_reason: row.void_reason,
        voided_at: row.voided_at,
        recorded_by: MembershipId::from_uuid(row.recorded_by),
        created_at: row.created_at,
    }
}

/// A payment to record.
#[derive(Debug, Clone)]
pub struct NewPaymentInput {
    /// The lab.
    pub vendor_id: LabVendorId,
    /// The order paid for, at that lab.
    pub lab_order_id: Option<LabOrderId>,
    /// The clinic day; today or earlier.
    pub paid_on: Date,
    /// How much.
    pub amount: Paise,
    /// The lab's bill number, up to 60 characters.
    pub lab_invoice_ref: Option<String>,
    /// A note, up to 300 characters.
    pub note: Option<String>,
}

fn require_money(actor: &ClinicActor) -> Result<(), AppError> {
    actor.require(Permission::ExpensesWrite)?;
    actor.require(Permission::FinanceView)?;
    Ok(())
}

/// Records a payment to a lab and its `lab` expense, in one transaction.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write` and `finance.view`; [`AppError::Invalid`] for
/// a bad amount, note or reference, a day after today, or an order at another lab;
/// [`AppError::NotFound`] for an unknown lab.
pub async fn record(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewPaymentInput,
    now: OffsetDateTime,
) -> Result<PaymentView, AppError> {
    require_money(actor)?;
    let amount = check_amount(input.amount).map_err(|e| AppError::invalid("amount_paise", e))?;
    let note = check_note(input.note.as_deref()).map_err(|e| AppError::invalid("note", e))?;
    let reference = trimmed(input.lab_invoice_ref.as_deref(), "lab_invoice_ref", 60)?;
    if input.paid_on > clinic_today(&actor.timezone, now) {
        return Err(AppError::invalid("paid_on", "must not be after today"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let vendor = dal::vendor_name(tx.conn(), input.vendor_id.uuid())
            .await?
            .ok_or(AppError::NotFound("lab"))?;
        if let Some(order) = input.lab_order_id
            && !dal::order_at_vendor(tx.conn(), order.uuid(), input.vendor_id.uuid()).await?
        {
            return Err(AppError::invalid(
                "lab_order_id",
                "not an order at this lab",
            ));
        }
        // The expense names the lab and its bill, never a patient.
        let mut expense_note: String = format!("Lab: {vendor}");
        if let Some(reference) = reference.as_deref() {
            expense_note.push_str(", bill ");
            expense_note.push_str(reference);
        }
        let expense_note: String = expense_note.chars().take(300).collect();
        let expense = expenses_dal::insert(
            tx.conn(),
            &NewExpense {
                id: ExpenseId::new_v7().uuid(),
                category_key: ExpenseCategoryKey::Lab.as_str(),
                spent_on: input.paid_on,
                amount_paise: amount.get(),
                note: Some(&expense_note),
                recorded_by: actor.membership_id.uuid(),
                idempotency_key: None,
                request_hash: None,
            },
        )
        .await?
        .ok_or(AppError::Internal("expense category missing"))?;
        let row = dal::insert(
            tx.conn(),
            &NewPayment {
                id: LabPaymentId::new_v7().uuid(),
                vendor_id: input.vendor_id.uuid(),
                lab_order_id: input.lab_order_id.map(LabOrderId::uuid),
                paid_on: input.paid_on,
                amount_paise: amount.get(),
                lab_invoice_ref: reference.as_deref(),
                note: note.as_deref(),
                expense_id: expense.id,
                recorded_by: actor.membership_id.uuid(),
            },
        )
        .await?;
        Ok(view(row))
    })
    .await
}

/// Payments, voided ones too, newest day first: to one lab or all, paid on clinic days `from`
/// to `to`; at most `limit` (1 to 500).
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::Invalid`] for a backwards range.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    vendor_id: Option<LabVendorId>,
    range: (Option<Date>, Option<Date>),
    limit: i64,
) -> Result<Vec<PaymentView>, AppError> {
    actor.require(Permission::FinanceView)?;
    let (from, to) = range;
    if let (Some(from), Some(to)) = (from, to)
        && from > to
    {
        return Err(AppError::invalid("from", "must not be after to"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(
            tx.conn(),
            vendor_id.map(LabVendorId::uuid),
            from,
            to,
            limit.clamp(1, MAX_LIST),
        )
        .await?;
        Ok(rows.into_iter().map(view).collect())
    })
    .await
}

/// Voids a payment and its expense with a reason, in one transaction.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write` and `finance.view`; [`AppError::Invalid`]
/// without a reason; [`AppError::NotFound`]; [`AppError::Conflict`] when already void.
pub async fn void(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabPaymentId,
    reason: &str,
    now: OffsetDateTime,
) -> Result<PaymentView, AppError> {
    require_money(actor)?;
    let reason = void_reason(reason)?;
    let by = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        let Some(row) = dal::void(tx.conn(), id.uuid(), &reason, now, by).await? else {
            return match dal::status(tx.conn(), id.uuid()).await? {
                None => Err(AppError::NotFound("lab payment")),
                Some(_) => Err(AppError::Conflict("this payment is already void")),
            };
        };
        // The payment is void now, so its expense may be voided too.
        expenses_dal::void(tx.conn(), row.expense_id, &reason, now, by)
            .await?
            .ok_or(AppError::Internal("lab payment expense not voidable"))?;
        Ok(view(row))
    })
    .await
}

/// What a lab has billed and been paid.
#[derive(Debug, Clone)]
pub struct BalanceView {
    /// The lab.
    pub vendor_id: LabVendorId,
    /// Its name.
    pub name: String,
    /// Orders sent to it, not cancelled.
    pub orders: i64,
    /// Their items at the lab's prices (items without a price count as nothing).
    pub billed: Paise,
    /// Payments recorded, not void.
    pub paid: Paise,
    /// Billed less paid: what the clinic still owes, or (below zero) has paid ahead.
    pub due: Paise,
}

/// A lab's balance.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::NotFound`] for an unknown lab.
pub async fn balance(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    vendor_id: LabVendorId,
) -> Result<BalanceView, AppError> {
    actor.require(Permission::FinanceView)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let row = dal::balance(tx.conn(), vendor_id.uuid())
            .await?
            .ok_or(AppError::NotFound("lab"))?;
        Ok(BalanceView {
            vendor_id,
            name: row.name,
            orders: row.orders,
            billed: Paise::new(row.billed_paise),
            paid: Paise::new(row.paid_paise),
            due: Paise::new(row.billed_paise - row.paid_paise),
        })
    })
    .await
}
