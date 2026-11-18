//! Clinic expenses: recorded by the owner or finance (`expenses.write`), listed and voided
//! with `finance.view`. An expense is never edited: a mistake is voided with a reason. A bill
//! photo can be attached (`expenses.write`) and fetched (`finance.view`).

use aarogyam_dal::expenses::{self as dal, BillRow, ExpenseRow, NewBill, NewExpense};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::billing::PaymentMethod;
use aarogyam_domain::chat::tidy_file_name;
use aarogyam_domain::expense::{ExpenseCategoryKey, ExpenseStatus, check_amount, check_note};
use aarogyam_domain::files::FileType;
use aarogyam_domain::ids::{AttachmentId, ClinicId, ExpenseCategoryId, ExpenseId, MembershipId};
use aarogyam_domain::lab::{ProofError, check_payment_proof};
use aarogyam_domain::permission::Permission;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::void_reason;
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::files::{DownloadRefusal, Files, LINK_LIFETIME, LinkRefusal, StorageKey};
use crate::payments::check_key;
use crate::scope::{STAFF, staff_scope as scope};
use crate::tokens::hash_token;

/// Most expenses one list returns.
pub const MAX_LIST: i64 = 500;

/// An expense as the API shows it.
#[derive(Debug, Clone)]
pub struct ExpenseView {
    /// Identifier.
    pub id: ExpenseId,
    /// The category.
    pub category_id: ExpenseCategoryId,
    /// Its key.
    pub category: ExpenseCategoryKey,
    /// Its name.
    pub category_name: String,
    /// The clinic day the money went out.
    pub spent_on: Date,
    /// How much.
    pub amount: Paise,
    /// A note.
    pub note: Option<String>,
    /// How it was paid, when recorded.
    pub method: Option<PaymentMethod>,
    /// Recorded or void.
    pub status: ExpenseStatus,
    /// Why it was voided.
    pub void_reason: Option<String>,
    /// When it was voided.
    pub voided_at: Option<OffsetDateTime>,
    /// Who recorded it.
    pub recorded_by: MembershipId,
    /// When it was recorded.
    pub created_at: OffsetDateTime,
    /// The current bill photo, if one was attached.
    pub bill: Option<BillView>,
}

/// The bill file of an expense, as shown. Fetch it with [`bill_link`].
#[derive(Debug, Clone)]
pub struct BillView {
    /// The file.
    pub id: AttachmentId,
    /// `image/jpeg`, `image/png` or `application/pdf`.
    pub mime_type: String,
    /// Bytes.
    pub size_bytes: i64,
    /// The name the uploader's device gave it.
    pub file_name: Option<String>,
}

impl From<BillRow> for BillView {
    fn from(row: BillRow) -> Self {
        Self {
            id: AttachmentId::from_uuid(row.id),
            mime_type: row.mime_type,
            size_bytes: row.size_bytes,
            file_name: row.file_name,
        }
    }
}

fn view(row: ExpenseRow) -> ExpenseView {
    ExpenseView {
        id: ExpenseId::from_uuid(row.id),
        category_id: ExpenseCategoryId::from_uuid(row.category_id),
        category: ExpenseCategoryKey::parse(&row.category_key).unwrap_or(ExpenseCategoryKey::Other),
        category_name: row.category_name,
        spent_on: row.spent_on,
        amount: Paise::new(row.amount_paise),
        note: row.note,
        method: row
            .method
            .as_deref()
            .and_then(|m| PaymentMethod::parse(m).ok()),
        status: ExpenseStatus::parse(&row.status).unwrap_or(ExpenseStatus::Recorded),
        void_reason: row.void_reason,
        voided_at: row.voided_at,
        recorded_by: MembershipId::from_uuid(row.recorded_by),
        created_at: row.created_at,
        bill: None,
    }
}

/// The views of these rows, each with its current bill.
async fn with_bills(
    tx: &mut ScopedTx,
    rows: Vec<ExpenseRow>,
) -> Result<Vec<ExpenseView>, AppError> {
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let mut bills = dal::current_bills(tx.conn(), &ids).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let bill = bills
                .iter()
                .position(|b| b.expense_id == row.id)
                .map(|at| BillView::from(bills.swap_remove(at)));
            ExpenseView { bill, ..view(row) }
        })
        .collect())
}

/// An expense to record.
#[derive(Debug, Clone)]
pub struct NewExpenseInput {
    /// What it was for.
    pub category: ExpenseCategoryKey,
    /// The clinic day; today or earlier.
    pub spent_on: Date,
    /// How much.
    pub amount: Paise,
    /// A note, up to 300 characters.
    pub note: Option<String>,
    /// How it was paid: `cash`, `upi`, `card` or `bank`; absent when not recorded.
    pub method: Option<String>,
    /// The client's `Idempotency-Key`, if it sent one; a retry sends the same key.
    pub idempotency_key: Option<String>,
}

/// Records an expense once. With an idempotency key, a retry with the same key and request
/// returns the first expense; returns whether this call recorded it.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write`; [`AppError::Invalid`] for an amount that
/// isn't above zero, a long note, an unknown method, a day after today or a malformed key;
/// [`AppError::Conflict`] for a key reused with a different expense.
pub async fn record(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewExpenseInput,
    now: OffsetDateTime,
) -> Result<(ExpenseView, bool), AppError> {
    actor.require(Permission::ExpensesWrite)?;
    let amount = check_amount(input.amount).map_err(|e| AppError::invalid("amount_paise", e))?;
    let note = check_note(input.note.as_deref()).map_err(|e| AppError::invalid("note", e))?;
    let method = input
        .method
        .as_deref()
        .map(PaymentMethod::parse)
        .transpose()
        .map_err(|e| AppError::invalid("method", e))?;
    if input.spent_on > clinic_today(&actor.timezone, now) {
        return Err(AppError::invalid("spent_on", "must not be after today"));
    }
    let key = input
        .idempotency_key
        .as_deref()
        .map(check_key)
        .transpose()?;
    let hash = key.as_ref().map(|_| {
        let mut request = format!(
            "{}|{}|{}|{}",
            input.category.as_str(),
            input.spent_on,
            amount.get(),
            note.as_deref().unwrap_or_default()
        );
        // Only when sent, so a key from before methods existed still hashes the same.
        if let Some(method) = method {
            request.push('|');
            request.push_str(method.as_str());
        }
        hash_token(&request)
    });
    let attempt = async || {
        db.scoped(&scope(actor, request_id), async |tx| {
            if let (Some(key), Some(hash)) = (&key, &hash)
                && let Some((row, stored)) = dal::by_key(tx.conn(), key).await?
            {
                if &stored == hash {
                    return Ok((with_bills(tx, vec![row]).await?.remove(0), false));
                }
                return Err(AppError::Conflict(
                    "this Idempotency-Key was used for a different expense",
                ));
            }
            let row = dal::insert(
                tx.conn(),
                &NewExpense {
                    id: ExpenseId::new_v7().uuid(),
                    category_key: input.category.as_str(),
                    spent_on: input.spent_on,
                    amount_paise: amount.get(),
                    note: note.as_deref(),
                    method: method.map(PaymentMethod::as_str),
                    recorded_by: actor.membership_id.uuid(),
                    idempotency_key: key.as_deref(),
                    request_hash: hash.as_deref(),
                },
            )
            .await?
            // Every clinic has the system categories (migration 0300); a missing one is a bug.
            .ok_or(AppError::Internal("expense category missing"))?;
            Ok((view(row), true))
        })
        .await
    };
    match attempt().await {
        // Two requests with the same key at once: the loser finds the winner's expense.
        Err(AppError::Db(error)) if error.constraint() == Some("expenses_idempotency") => {
            attempt().await
        }
        other => other,
    }
}

/// Expenses spent on clinic days `from` to `to` (both included), voided ones too, newest day
/// first; at most `limit` (1 to 500).
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::Invalid`] for a backwards range.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    from: Option<Date>,
    to: Option<Date>,
    limit: i64,
) -> Result<Vec<ExpenseView>, AppError> {
    actor.require(Permission::FinanceView)?;
    if let (Some(from), Some(to)) = (from, to)
        && from > to
    {
        return Err(AppError::invalid("from", "must not be after to"));
    }
    let limit = limit.clamp(1, MAX_LIST);
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::list(tx.conn(), from, to, limit).await?;
        Ok(rows
            .into_iter()
            .map(|(row, bill)| ExpenseView {
                bill: bill.map(BillView::from),
                ..view(row)
            })
            .collect())
    })
    .await
}

/// Voids an expense with a reason; it stops counting in reports.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::Invalid`] without a reason;
/// [`AppError::NotFound`]; [`AppError::Conflict`] when already void or a lab payment's.
pub async fn void(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ExpenseId,
    reason: &str,
    now: OffsetDateTime,
) -> Result<ExpenseView, AppError> {
    actor.require(Permission::FinanceView)?;
    let reason = void_reason(reason)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if let Some(row) = dal::void(
            tx.conn(),
            id.uuid(),
            &reason,
            now,
            actor.membership_id.uuid(),
        )
        .await?
        {
            // A voided expense keeps its bill.
            return Ok(with_bills(tx, vec![row]).await?.remove(0));
        }
        match dal::status(tx.conn(), id.uuid()).await? {
            None => Err(AppError::NotFound("expense")),
            Some(status) if status == ExpenseStatus::Recorded.as_str() => Err(AppError::Conflict(
                "this expense is a lab payment: void the payment instead",
            )),
            Some(_) => Err(AppError::Conflict("this expense is already void")),
        }
    })
    .await
}

/// A bill file to attach.
#[derive(Debug)]
pub struct BillUpload {
    /// The bytes.
    pub bytes: Vec<u8>,
    /// The name the sender's device gave it.
    pub file_name: Option<String>,
}

fn refused_bill(error: ProofError) -> AppError {
    AppError::Invalid {
        field: "file",
        message: error.to_string(),
    }
}

/// Locks a recorded expense, refusing an unknown or voided one.
async fn lock_recorded(
    tx: &mut ScopedTx,
    id: ExpenseId,
    void_message: &'static str,
) -> Result<(), AppError> {
    match dal::lock_status(tx.conn(), id.uuid()).await?.as_deref() {
        None => Err(AppError::NotFound("expense")),
        Some(status) if status != ExpenseStatus::Recorded.as_str() => {
            Err(AppError::Conflict(void_message))
        }
        Some(_) => Ok(()),
    }
}

/// Attaches a bill photo (a JPEG, PNG or PDF of at most 10 MB, judged by its content) to an
/// expense, replacing the current one: that stays as a superseded row, with its bytes. The bytes
/// are stored first and removed again when the row can't be written.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write`; [`AppError::Invalid`] for an empty, too large
/// or unrecognised file; [`AppError::NotFound`] for an unknown expense; [`AppError::Conflict`]
/// when the expense is void.
pub async fn upload_bill(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ExpenseId,
    upload: BillUpload,
) -> Result<ExpenseView, AppError> {
    actor.require(Permission::ExpensesWrite)?;
    let file_type = check_payment_proof(&upload.bytes).map_err(refused_bill)?;
    let size = i64::try_from(upload.bytes.len()).map_err(|_| AppError::Internal("file size"))?;
    let file_name = upload.file_name.as_deref().and_then(tidy_file_name);
    let file_id = AttachmentId::new_v7();
    let key = StorageKey::new(actor.clinic_id, file_id);
    let mut wrote = false;
    let result = db
        .scoped(&scope(actor, request_id), async |tx| {
            lock_recorded(tx, id, "a voided expense takes no new bill").await?;
            files
                .storage()
                .put(key, &upload.bytes)
                .await
                .map_err(|_| AppError::Internal("could not store the file"))?;
            wrote = true;
            dal::supersede_bill(tx.conn(), id.uuid()).await?;
            dal::insert_bill(
                tx.conn(),
                &NewBill {
                    id: file_id.uuid(),
                    expense_id: id.uuid(),
                    mime_type: file_type.mime_type(),
                    size_bytes: size,
                    file_name: file_name.as_deref(),
                },
            )
            .await?;
            expense(tx, id).await
        })
        .await;
    if result.is_err() && wrote {
        let _ = files.storage().delete(key).await;
    }
    result
}

/// Takes the bill off an expense that is not void. The file stays, superseded.
///
/// # Errors
/// [`AppError::Denied`] without `expenses.write`; [`AppError::NotFound`] for an unknown expense
/// or one without a bill; [`AppError::Conflict`] when it is void.
pub async fn remove_bill(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ExpenseId,
) -> Result<ExpenseView, AppError> {
    actor.require(Permission::ExpensesWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        lock_recorded(tx, id, "a voided expense keeps its bill").await?;
        if dal::current_bills(tx.conn(), &[id.uuid()])
            .await?
            .is_empty()
        {
            return Err(AppError::NotFound("bill"));
        }
        dal::supersede_bill(tx.conn(), id.uuid()).await?;
        expense(tx, id).await
    })
    .await
}

/// One expense with its current bill.
async fn expense(tx: &mut ScopedTx, id: ExpenseId) -> Result<ExpenseView, AppError> {
    let row = dal::get(tx.conn(), id.uuid())
        .await?
        .ok_or(AppError::NotFound("expense"))?;
    Ok(with_bills(tx, vec![row]).await?.remove(0))
}

/// A short-lived link to an expense's bill.
#[derive(Debug, Clone)]
pub struct BillLink {
    /// The file.
    pub file_id: AttachmentId,
    /// The signed token, bound to the caller.
    pub token: String,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// Issues a five-minute link to an expense's current bill. A voided expense's bill stays
/// readable.
///
/// # Errors
/// [`AppError::Denied`] without `finance.view`; [`AppError::NotFound`] for an unknown expense or
/// one without a bill; [`AppError::Forbidden`] for Sakalya staff under a support grant.
pub async fn bill_link(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ExpenseId,
    now: OffsetDateTime,
) -> Result<BillLink, AppError> {
    actor.require(Permission::FinanceView)?;
    if actor.support_grant.is_some() {
        return Err(AppError::Forbidden(
            "Support access doesn't download files.",
        ));
    }
    let bill = db
        .scoped(&scope(actor, request_id), async |tx| {
            dal::current_bills(tx.conn(), &[id.uuid()])
                .await?
                .pop()
                .ok_or(AppError::NotFound("bill"))
        })
        .await?;
    let file_id = AttachmentId::from_uuid(bill.id);
    let expires_at = now + LINK_LIFETIME;
    Ok(BillLink {
        file_id,
        token: files.signer().sign_expense_file(
            actor.clinic_id,
            file_id,
            actor.user_id,
            expires_at,
        ),
        expires_at,
    })
}

/// A bill file to send.
#[derive(Debug, Clone)]
pub struct BillDownload {
    /// Its type.
    pub file_type: FileType,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// Opens a bill link on `clinic`'s host: checks the signature and expiry, that the file is this
/// clinic's, and returns it.
///
/// # Errors
/// The [`DownloadRefusal`] that applies.
pub async fn bill_content(
    db: &Db,
    files: &Files,
    clinic: ClinicId,
    request_id: Option<Uuid>,
    file_id: AttachmentId,
    token: &str,
    now: OffsetDateTime,
) -> Result<BillDownload, DownloadRefusal> {
    let grant = files
        .signer()
        .verify_expense_file(clinic, file_id, token, now)
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
                dal::bill_file(tx.conn(), file_id.uuid())
                    .await?
                    .ok_or(AppError::NotFound("bill"))?,
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
    Ok(BillDownload { file_type, bytes })
}
