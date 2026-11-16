//! Money paid to labs. Recording a payment records an expense in the `lab` category in the
//! same transaction, and voiding one voids its expense, so reports count lab spending once.
//! Payments need `expenses.write` and `finance.view`; listing and balances need `finance.view`.

use aarogyam_dal::expenses::{self as expenses_dal, NewExpense};
use aarogyam_dal::lab_payments::{self as dal, NewPayment, NewProof, PaymentRow, ProofRow};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::billing::PaymentMethod;
use aarogyam_domain::chat::tidy_file_name;
use aarogyam_domain::expense::{ExpenseCategoryKey, check_amount, check_note};
use aarogyam_domain::files::FileType;
use aarogyam_domain::ids::{
    AttachmentId, ClinicId, ExpenseId, LabOrderId, LabPaymentId, LabVendorId, MembershipId,
};
use aarogyam_domain::lab::{LabPaymentStatus, check_payment_proof};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::void_reason;
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::files::{DownloadRefusal, Files, LINK_LIFETIME, LinkRefusal, StorageKey};
use crate::labs::trimmed;
use crate::scope::{STAFF, staff_scope as scope};

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
    /// How it was paid.
    pub method: Option<PaymentMethod>,
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
    /// The current proof of payment, if one was attached.
    pub proof: Option<ProofView>,
}

/// The proof file of a payment, as shown. Fetch it with [`proof_link`].
#[derive(Debug, Clone)]
pub struct ProofView {
    /// The file.
    pub id: AttachmentId,
    /// `image/jpeg`, `image/png` or `application/pdf`.
    pub mime_type: String,
    /// Bytes.
    pub size_bytes: i64,
    /// The name the uploader's device gave it.
    pub file_name: Option<String>,
}

impl From<ProofRow> for ProofView {
    fn from(row: ProofRow) -> Self {
        Self {
            id: AttachmentId::from_uuid(row.id),
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
            file_name: row.file_name,
        }
    }
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
        method: row
            .method
            .as_deref()
            .and_then(|m| PaymentMethod::parse(m).ok()),
        expense_id: ExpenseId::from_uuid(row.expense_id),
        status: LabPaymentStatus::parse(&row.status).unwrap_or(LabPaymentStatus::Recorded),
        void_reason: row.void_reason,
        voided_at: row.voided_at,
        recorded_by: MembershipId::from_uuid(row.recorded_by),
        created_at: row.created_at,
        proof: None,
    }
}

/// The views of these rows, each with its current proof.
async fn with_proofs(
    tx: &mut ScopedTx,
    rows: Vec<PaymentRow>,
) -> Result<Vec<PaymentView>, AppError> {
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let mut proofs = dal::current_proofs(tx.conn(), &ids).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let proof = proofs
                .iter()
                .position(|p| p.lab_payment_id == row.id)
                .map(|at| ProofView::from(proofs.swap_remove(at)));
            PaymentView { proof, ..view(row) }
        })
        .collect())
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
    /// How it was paid: `cash`, `upi`, `card` or `bank`; absent when not recorded.
    pub method: Option<String>,
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
    let method = input
        .method
        .as_deref()
        .map(PaymentMethod::parse)
        .transpose()
        .map_err(|e| AppError::invalid("method", e))?;
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
                method: method.map(PaymentMethod::as_str),
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
        Ok(rows
            .into_iter()
            .map(|(row, proof)| PaymentView {
                proof: proof.map(ProofView::from),
                ..view(row)
            })
            .collect())
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
        // A voided payment keeps its proof.
        Ok(with_proofs(tx, vec![row]).await?.remove(0))
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

/// A proof file to attach.
#[derive(Debug)]
pub struct ProofUpload {
    /// The bytes.
    pub bytes: Vec<u8>,
    /// The name the sender's device gave it.
    pub file_name: Option<String>,
}

fn refused_proof(error: aarogyam_domain::lab::ProofError) -> AppError {
    AppError::Invalid {
        field: "file",
        message: error.to_string(),
    }
}

/// Attaches a proof of payment (a JPEG, PNG or PDF of at most 10 MB, judged by its content) to
/// a payment, replacing the current one: that stays as a superseded row, with its bytes. The
/// bytes are stored first and removed again when the row can't be written.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write` and `finance.view`; [`AppError::Invalid`] for
/// an empty, too large or unrecognised file; [`AppError::NotFound`] for an unknown payment;
/// [`AppError::Conflict`] when the payment is void.
pub async fn upload_proof(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabPaymentId,
    upload: ProofUpload,
) -> Result<PaymentView, AppError> {
    require_money(actor)?;
    let file_type = check_payment_proof(&upload.bytes).map_err(refused_proof)?;
    let size = i64::try_from(upload.bytes.len()).map_err(|_| AppError::Internal("file size"))?;
    let file_name = upload.file_name.as_deref().and_then(tidy_file_name);
    let file_id = AttachmentId::new_v7();
    let key = StorageKey::new(actor.clinic_id, file_id);
    let mut wrote = false;
    let result = db
        .scoped(&scope(actor, request_id), async |tx| {
            match dal::lock_status(tx.conn(), id.uuid()).await?.as_deref() {
                None => return Err(AppError::NotFound("lab payment")),
                Some(status) if status != LabPaymentStatus::Recorded.as_str() => {
                    return Err(AppError::Conflict("a voided payment takes no new proof"));
                }
                Some(_) => {}
            }
            files
                .storage()
                .put(key, &upload.bytes)
                .await
                .map_err(|_| AppError::Internal("could not store the file"))?;
            wrote = true;
            dal::supersede_proof(tx.conn(), id.uuid()).await?;
            dal::insert_proof(
                tx.conn(),
                &NewProof {
                    id: file_id.uuid(),
                    lab_payment_id: id.uuid(),
                    mime_type: file_type.mime_type(),
                    size_bytes: size,
                    file_name: file_name.as_deref(),
                },
            )
            .await?;
            payment(tx, id).await
        })
        .await;
    if result.is_err() && wrote {
        let _ = files.storage().delete(key).await;
    }
    result
}

/// Takes the proof off a payment that is not void. The file stays, superseded.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write` and `finance.view`; [`AppError::NotFound`] for
/// an unknown payment or one without a proof; [`AppError::Conflict`] when it is void.
pub async fn remove_proof(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabPaymentId,
) -> Result<PaymentView, AppError> {
    require_money(actor)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        match dal::lock_status(tx.conn(), id.uuid()).await?.as_deref() {
            None => return Err(AppError::NotFound("lab payment")),
            Some(status) if status != LabPaymentStatus::Recorded.as_str() => {
                return Err(AppError::Conflict("a voided payment keeps its proof"));
            }
            Some(_) => {}
        }
        if dal::current_proofs(tx.conn(), &[id.uuid()])
            .await?
            .is_empty()
        {
            return Err(AppError::NotFound("proof"));
        }
        dal::supersede_proof(tx.conn(), id.uuid()).await?;
        payment(tx, id).await
    })
    .await
}

/// One payment with its current proof.
async fn payment(tx: &mut ScopedTx, id: LabPaymentId) -> Result<PaymentView, AppError> {
    let row = dal::get(tx.conn(), id.uuid())
        .await?
        .ok_or(AppError::NotFound("lab payment"))?;
    Ok(with_proofs(tx, vec![row]).await?.remove(0))
}

/// A short-lived link to a payment's proof.
#[derive(Debug, Clone)]
pub struct ProofLink {
    /// The file.
    pub file_id: AttachmentId,
    /// The signed token, bound to the caller.
    pub token: String,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// Issues a five-minute link to a payment's current proof. A voided payment's proof stays
/// readable.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::NotFound`] for an unknown payment or
/// one without a proof; [`AppError::Forbidden`] for Sakalya staff under a support grant.
pub async fn proof_link(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: LabPaymentId,
    now: OffsetDateTime,
) -> Result<ProofLink, AppError> {
    actor.require(Permission::FinanceView)?;
    if actor.support_grant.is_some() {
        return Err(AppError::Forbidden(
            "Support access doesn't download files.",
        ));
    }
    let proof = db
        .scoped(&scope(actor, request_id), async |tx| {
            dal::current_proofs(tx.conn(), &[id.uuid()])
                .await?
                .pop()
                .ok_or(AppError::NotFound("proof"))
        })
        .await?;
    let file_id = AttachmentId::from_uuid(proof.id);
    let expires_at = now + LINK_LIFETIME;
    Ok(ProofLink {
        file_id,
        token: files.signer().sign_lab_payment_file(
            actor.clinic_id,
            file_id,
            actor.user_id,
            expires_at,
        ),
        expires_at,
    })
}

/// A proof file to send.
#[derive(Debug, Clone)]
pub struct ProofDownload {
    /// Its type.
    pub file_type: FileType,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// Opens a proof link on `clinic`'s host: checks the signature and expiry, that the file is
/// this clinic's, and returns it.
///
/// # Errors
/// The [`DownloadRefusal`] that applies.
pub async fn proof_content(
    db: &Db,
    files: &Files,
    clinic: ClinicId,
    request_id: Option<Uuid>,
    file_id: AttachmentId,
    token: &str,
    now: OffsetDateTime,
) -> Result<ProofDownload, DownloadRefusal> {
    let grant = files
        .signer()
        .verify_lab_payment_file(clinic, file_id, token, now)
        .map_err(|refusal| match refusal {
            LinkRefusal::Expired => DownloadRefusal::Expired,
            LinkRefusal::Invalid => DownloadRefusal::NotFound,
        })?;
    let mut scope = sakalya_db::Scope::tenant(clinic.uuid())
        .with_user(grant.user_id.uuid())
        .with_actor_kind(STAFF);
    if let Some(request) = request_id {
        scope = scope.with_request_id(request);
    }
    let row = db
        .scoped(&scope, async |tx| {
            Ok::<_, DownloadRefusal>(
                dal::proof_file(tx.conn(), file_id.uuid())
                    .await?
                    .ok_or(AppError::NotFound("proof"))?,
            )
        })
        .await?;
    let file_type = FileType::from_mime_type(&row.mime_type).ok_or(DownloadRefusal::Failed(
        AppError::Internal("unknown stored type"),
    ))?;
    let bytes = files
        .storage()
        .get(StorageKey::new(clinic, file_id))
        .await
        .map_err(|_| DownloadRefusal::Failed(AppError::Internal("could not read the file")))?;
    Ok(ProofDownload { file_type, bytes })
}
