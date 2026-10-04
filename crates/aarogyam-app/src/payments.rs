//! Payments: money received, allocated to issued bills, receipted, and voided with a reason.
//! A retry with the same `Idempotency-Key` returns the first payment instead of a second one.

use aarogyam_dal::billing::{self as dal, PaymentFilter};
use aarogyam_dal::patients;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::billing::{
    FinancialYear, InvoiceStatus, PaymentMethod, PaymentStatus, RECEIPT_PREFIX, serial_number,
};
use aarogyam_domain::ids::{InvoiceId, PatientId, PaymentId};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::{PatientRef, void_reason};
use crate::clock::{clinic_today, day_range};
use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::tokens::hash_token;

/// A payment as received.
#[derive(Debug, Clone)]
pub struct RecordPayment {
    /// The client's key for this payment; a retry sends the same key.
    pub idempotency_key: String,
    /// Who paid.
    pub patient_id: PatientId,
    /// `cash`, `upi`, `card` or `bank`.
    pub method: String,
    /// How much.
    pub amount_paise: i64,
    /// UPI or card reference.
    pub reference: Option<String>,
    /// Which bills it pays, and how much of each.
    pub allocations: Vec<(InvoiceId, i64)>,
}

/// Part of a payment going to a bill.
#[derive(Debug, Clone)]
pub struct AllocationView {
    /// The bill.
    pub invoice_id: InvoiceId,
    /// Its number.
    pub invoice_number: Option<String>,
    /// How much.
    pub amount: Paise,
}

/// A payment as the API shows it.
#[derive(Debug, Clone)]
pub struct PaymentView {
    /// Identifier.
    pub id: PaymentId,
    /// Receipt number.
    pub number: String,
    /// Who paid.
    pub patient: PatientRef,
    /// When.
    pub received_at: OffsetDateTime,
    /// How much.
    pub amount: Paise,
    /// How.
    pub method: PaymentMethod,
    /// Reference.
    pub reference: Option<String>,
    /// Received or void.
    pub status: PaymentStatus,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// Allocated to bills.
    pub allocated: Paise,
    /// Left as an advance.
    pub unallocated: Paise,
    /// The allocations.
    pub allocations: Vec<AllocationView>,
}

/// Valid keys: 8 to 100 of letters, digits, `_`, `-`, `.` and `:` (a UUID works).
fn check_key(key: &str) -> Result<String, AppError> {
    let key = key.trim();
    let ok = (8..=100).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'));
    if ok {
        Ok(key.to_owned())
    } else {
        Err(AppError::invalid(
            "Idempotency-Key",
            "send a header of 8 to 100 letters, digits, '-', '_', '.' or ':'",
        ))
    }
}

/// What a payment request says, in a fixed form, so a reused key can be compared.
fn request_hash(input: &RecordPayment, method: PaymentMethod, reference: Option<&str>) -> String {
    let mut allocations: Vec<String> = input
        .allocations
        .iter()
        .map(|(invoice, amount)| format!("{}={amount}", invoice.uuid()))
        .collect();
    allocations.sort();
    hash_token(&format!(
        "{}|{}|{}|{}|{}",
        input.patient_id.uuid(),
        method.as_str(),
        input.amount_paise,
        reference.unwrap_or_default(),
        allocations.join(",")
    ))
}

async fn load_many(
    tx: &mut ScopedTx,
    filter: &PaymentFilter<'_>,
) -> Result<Vec<(PaymentView, String)>, AppError> {
    let rows = dal::payments(tx.conn(), filter).await?;
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let allocations = dal::allocations(tx.conn(), &ids).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let mine = allocations
                .iter()
                .filter(|a| a.payment_id == row.id)
                .map(|a| AllocationView {
                    invoice_id: InvoiceId::from_uuid(a.invoice_id),
                    invoice_number: a.invoice_number.clone(),
                    amount: Paise::new(a.amount_paise),
                })
                .collect();
            let view = PaymentView {
                id: PaymentId::from_uuid(row.id),
                number: row.number,
                patient: PatientRef {
                    id: PatientId::from_uuid(row.patient_id),
                    name: row.patient_name,
                    number: row.patient_number,
                },
                received_at: row.received_at,
                amount: Paise::new(row.amount_paise),
                method: PaymentMethod::parse(&row.method).unwrap_or(PaymentMethod::Cash),
                reference: row.reference,
                status: PaymentStatus::parse(&row.status).unwrap_or(PaymentStatus::Received),
                void_reason: row.void_reason,
                allocated: Paise::new(row.allocated_paise),
                unallocated: Paise::new((row.amount_paise - row.allocated_paise).max(0)),
                allocations: mine,
            };
            (view, row.request_hash)
        })
        .collect())
}

async fn load_one(tx: &mut ScopedTx, id: Uuid) -> Result<PaymentView, AppError> {
    load_many(
        tx,
        &PaymentFilter {
            id: Some(id),
            limit: 1,
            ..PaymentFilter::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .map(|(view, _)| view)
    .ok_or(AppError::NotFound("payment"))
}

/// A payment request's values, checked.
struct Checked {
    key: String,
    method: PaymentMethod,
    reference: Option<String>,
}

fn check(input: &RecordPayment) -> Result<Checked, AppError> {
    let key = check_key(&input.idempotency_key)?;
    let method = PaymentMethod::parse(&input.method).map_err(|e| AppError::invalid("method", e))?;
    if input.amount_paise <= 0 {
        return Err(AppError::invalid("amount_paise", "must be more than zero"));
    }
    let reference = match input.reference.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(text) if text.chars().count() > 64 => {
            return Err(AppError::invalid(
                "reference",
                "must be at most 64 characters",
            ));
        }
        Some(text) => Some(text.to_owned()),
    };
    let mut seen = Vec::new();
    let mut allocated: i64 = 0;
    for (invoice, amount) in &input.allocations {
        if *amount <= 0 {
            return Err(AppError::invalid(
                "allocations.amount_paise",
                "must be more than zero",
            ));
        }
        if seen.contains(invoice) {
            return Err(AppError::invalid("allocations", "name each bill once"));
        }
        seen.push(*invoice);
        allocated = allocated.saturating_add(*amount);
    }
    if allocated > input.amount_paise {
        return Err(AppError::invalid(
            "allocations",
            "add up to more than the payment",
        ));
    }
    Ok(Checked {
        key,
        method,
        reference,
    })
}

/// Records a payment once. Returns the payment and whether this call created it (`false` when
/// the key was seen before with the same request).
///
/// # Errors
/// [`AppError::Denied`] without `billing.write`; [`AppError::NotFound`] for an unknown patient
/// or bill; [`AppError::Invalid`] for bad values or an allocation past a bill's balance or the
/// payment; [`AppError::Conflict`] for a key reused with a different request or a bill that
/// isn't issued.
pub async fn record(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: RecordPayment,
    now: OffsetDateTime,
) -> Result<(PaymentView, bool), AppError> {
    actor.require(Permission::BillingWrite)?;
    let Checked {
        key,
        method,
        reference,
    } = check(&input)?;
    let hash = request_hash(&input, method, reference.as_deref());
    let attempt = async || {
        db.scoped(&scope(actor, request_id), async |tx| {
            let existing = load_many(
                tx,
                &PaymentFilter {
                    idempotency_key: Some(&key),
                    limit: 1,
                    ..PaymentFilter::default()
                },
            )
            .await?;
            if let Some((view, stored_hash)) = existing.into_iter().next() {
                if stored_hash == hash {
                    return Ok((view, false));
                }
                return Err(AppError::Conflict(
                    "this Idempotency-Key was used for a different payment",
                ));
            }
            patients::get(tx.conn(), input.patient_id.uuid())
                .await?
                .ok_or(AppError::NotFound("patient"))?;
            let ids: Vec<Uuid> = input.allocations.iter().map(|(id, _)| id.uuid()).collect();
            let bills = dal::lock_invoices(tx.conn(), &ids).await?;
            for (invoice, amount) in &input.allocations {
                let bill = bills
                    .iter()
                    .find(|bill| {
                        bill.id == invoice.uuid() && bill.patient_id == input.patient_id.uuid()
                    })
                    .ok_or(AppError::NotFound("invoice"))?;
                if bill.status != InvoiceStatus::Issued.as_str() {
                    return Err(AppError::Conflict("only issued bills take payments"));
                }
                if *amount > bill.total_paise - bill.paid_paise {
                    return Err(AppError::invalid(
                        "allocations.amount_paise",
                        "is more than the bill's balance",
                    ));
                }
            }
            let timezone = dal::supplier(tx.conn())
                .await?
                .map_or_else(|| "Asia/Kolkata".to_owned(), |s| s.timezone);
            let year = FinancialYear::of(clinic_today(&timezone, now));
            let serial = dal::next_number(tx.conn(), "receipt", &year.label()).await?;
            let serial =
                u64::try_from(serial).map_err(|_| AppError::Internal("negative serial"))?;
            let number = serial_number(RECEIPT_PREFIX, year, serial)
                .map_err(|e| AppError::invalid("number", e))?;
            let id = PaymentId::new_v7().uuid();
            dal::insert_payment(
                tx.conn(),
                &dal::NewPayment {
                    id,
                    number: &number,
                    patient_id: input.patient_id.uuid(),
                    received_at: now,
                    amount_paise: input.amount_paise,
                    method: method.as_str(),
                    reference: reference.as_deref(),
                    received_by: actor.membership_id.uuid(),
                    idempotency_key: &key,
                    request_hash: &hash,
                },
            )
            .await?;
            for (invoice, amount) in &input.allocations {
                dal::insert_allocation(
                    tx.conn(),
                    id,
                    invoice.uuid(),
                    input.patient_id.uuid(),
                    *amount,
                )
                .await?;
            }
            Ok((load_one(tx, id).await?, true))
        })
        .await
    };
    match attempt().await {
        // Two requests with the same key at once: the loser finds the winner's payment.
        Err(AppError::Db(error)) if error.constraint() == Some("payments_idempotency") => {
            attempt().await
        }
        other => other,
    }
}

/// Voids a payment with a reason. Its allocations stop counting, so the bills it paid show
/// their balance again.
///
/// # Errors
/// [`AppError::Denied`] without `billing.write`; [`AppError::NotFound`]; [`AppError::Conflict`]
/// when already void; [`AppError::Invalid`] without a reason.
pub async fn void(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PaymentId,
    reason: &str,
    now: OffsetDateTime,
) -> Result<PaymentView, AppError> {
    actor.require(Permission::BillingWrite)?;
    let reason = void_reason(reason)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let status = dal::lock_payment(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("payment"))?;
        if status != PaymentStatus::Received.as_str() {
            return Err(AppError::Conflict("this payment is already void"));
        }
        dal::void_payment(
            tx.conn(),
            id.uuid(),
            &reason,
            now,
            actor.membership_id.uuid(),
        )
        .await?;
        load_one(tx, id.uuid()).await
    })
    .await
}

/// One payment, for its receipt.
///
/// # Errors
/// [`AppError::Denied`] without `billing.read`; [`AppError::NotFound`].
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PaymentId,
) -> Result<PaymentView, AppError> {
    actor.require(Permission::BillingRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        load_one(tx, id.uuid()).await
    })
    .await
}

/// Payments received on clinic days `from` to `to` (both included), newest first.
///
/// # Errors
/// [`AppError::Denied`] without `billing.read`; [`AppError::Db`] on failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    from: Option<Date>,
    to: Option<Date>,
    limit: i64,
) -> Result<Vec<PaymentView>, AppError> {
    actor.require(Permission::BillingRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let timezone = dal::supplier(tx.conn())
            .await?
            .map_or_else(|| "Asia/Kolkata".to_owned(), |s| s.timezone);
        let from = from.map(|day| day_range(&timezone, day, day).0);
        let to = to.map(|day| day_range(&timezone, day, day).1);
        let rows = load_many(
            tx,
            &PaymentFilter {
                from,
                to,
                limit: limit.clamp(1, 500),
                ..PaymentFilter::default()
            },
        )
        .await?;
        Ok(rows.into_iter().map(|(view, _)| view).collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_and_request_hashes() {
        assert!(check_key("short").is_err());
        assert!(check_key("has space in it").is_err());
        assert_eq!(
            check_key(" 0192f1c4-0000-7000 ").unwrap(),
            "0192f1c4-0000-7000"
        );
        let invoice = InvoiceId::new_v7();
        let other = InvoiceId::new_v7();
        let input = RecordPayment {
            idempotency_key: "k".repeat(10),
            patient_id: PatientId::new_v7(),
            method: "upi".into(),
            amount_paise: 500,
            reference: None,
            allocations: vec![(invoice, 200), (other, 300)],
        };
        let mut reordered = input.clone();
        reordered.allocations.reverse();
        let first = request_hash(&input, PaymentMethod::Upi, None);
        assert_eq!(first, request_hash(&reordered, PaymentMethod::Upi, None));
        assert_ne!(first, request_hash(&input, PaymentMethod::Cash, None));
    }
}
