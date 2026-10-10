//! Finishing a visit in one step: sign the caller's notes, issue a given draft prescription
//! (with the allergy check), plan the follow-up and the draft bill, and close the visit, all in
//! one clinic transaction. Either everything lands or nothing does. Closing alone
//! ([`close_with`]) takes the same follow-up and fee.

use aarogyam_dal::prescriptions as rx_dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::clinical::{EncounterStatus, fee};
use aarogyam_domain::ids::{ClinicalNoteId, EncounterId, PrescriptionId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::prescription::RxStatus;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::{DraftInvoice, InvoiceView, LineInput};
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::prescriptions::{
    AlertView, AllergySource, IssueOutcome, RxView, Sharing, issue_in, load as load_rx,
    override_text,
};
use crate::recalls::{RecallView, create_in as create_recall};
use crate::scope::staff_scope as scope;
use crate::share::{ShareOptions, SharedLink, share_in};
use crate::visits::{VisitView, close_in, sign_own_drafts};
use aarogyam_dal::visits;

/// What closing a visit also does: the follow-up to plan and the fee to bill, both optional.
#[derive(Debug, Clone, Default)]
pub struct WrapUp {
    /// When the patient should come back; plans a follow-up (needs `patients.write`).
    pub follow_up_on: Option<Date>,
    /// What the visit costs, in paise; starts a draft bill linked to the visit (needs
    /// `billing.write`).
    pub fee_paise: Option<i64>,
    /// The follow-up's reason (1 to 300 characters); with a fee but no follow-up, the note
    /// printed on the draft bill.
    pub note: Option<String>,
}

/// What a wrap-up made.
#[derive(Debug, Clone, Default)]
pub struct WrapUpDone {
    /// The follow-up, when planned.
    pub follow_up: Option<RecallView>,
    /// The draft bill, when started.
    pub invoice: Option<InvoiceView>,
}

/// A wrap-up whose values are checked.
struct Checked {
    follow_up_on: Option<Date>,
    fee: Option<Paise>,
    note: Option<String>,
}

fn check_wrap_up(
    actor: &ClinicActor,
    wrap: &WrapUp,
    now: OffsetDateTime,
) -> Result<Checked, AppError> {
    if wrap.follow_up_on.is_some() {
        actor.require(Permission::PatientsWrite)?;
        if wrap.follow_up_on < Some(clinic_today(&actor.timezone, now)) {
            return Err(AppError::invalid("follow_up_on", "must not be in the past"));
        }
    }
    let fee = match wrap.fee_paise {
        None => None,
        Some(paise) => {
            actor.require(Permission::BillingWrite)?;
            let amount = fee(paise).map_err(|e| AppError::invalid("fee_paise", e))?;
            if amount.get() == 0 {
                return Err(AppError::invalid("fee_paise", "must be more than 0"));
            }
            Some(amount)
        }
    };
    let note = match wrap.note.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(text) if text.chars().count() <= 300 => Some(text.to_owned()),
        Some(_) => return Err(AppError::invalid("note", "must be at most 300 characters")),
    };
    Ok(Checked {
        follow_up_on: wrap.follow_up_on,
        fee,
        note,
    })
}

/// Plans the follow-up and starts the draft bill, inside the caller's transaction.
async fn wrap_up_in(
    tx: &mut ScopedTx,
    visit: &visits::EncounterRow,
    wrap: &Checked,
    reach: Option<Uuid>,
) -> Result<WrapUpDone, AppError> {
    let mut done = WrapUpDone::default();
    if let Some(due_on) = wrap.follow_up_on {
        let reason = wrap
            .note
            .clone()
            .unwrap_or_else(|| format!("Follow-up after visit {}", visit.number));
        done.follow_up = Some(
            create_recall(
                tx,
                aarogyam_domain::ids::PatientId::from_uuid(visit.patient_id),
                due_on,
                &reason,
                "follow_up",
                reach,
            )
            .await?,
        );
    }
    if let Some(amount) = wrap.fee {
        let notes = wrap.note.as_deref().filter(|_| wrap.follow_up_on.is_none());
        done.invoice = Some(
            crate::billing::create_in(
                tx,
                DraftInvoice {
                    patient_id: aarogyam_domain::ids::PatientId::from_uuid(visit.patient_id),
                    encounter_id: Some(visit.id),
                    place_of_supply: None,
                    notes: None,
                    items: vec![LineInput {
                        description: Some("Consultation".to_owned()),
                        quantity: Some(1),
                        unit_price_paise: Some(amount.get()),
                        gst_rate: Some(0),
                        ..LineInput::default()
                    }],
                    replaces_invoice_id: None,
                },
                None,
                notes,
            )
            .await?,
        );
    }
    Ok(done)
}

/// Closes a visit, and with `wrap` plans the follow-up and starts the draft bill in the same
/// transaction.
///
/// # Errors
/// [`AppError::NotFound`] when the visit isn't in this clinic; [`AppError::Conflict`] when it is
/// closed; [`AppError::Denied`] when the follow-up or fee needs a permission the member lacks;
/// [`AppError::Invalid`] for a bad date, fee or note.
pub async fn close_with(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    wrap: WrapUp,
    now: OffsetDateTime,
) -> Result<(VisitView, WrapUpDone), AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let checked = check_wrap_up(actor, &wrap, now)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalWrite);
        let visit = crate::visits::require_open_visit(tx, visit_id, reach).await?;
        let done = wrap_up_in(tx, &visit, &checked, reach.member()).await?;
        let closed = close_in(tx, actor, &visit, now).await?;
        Ok((closed, done))
    })
    .await
}

/// A draft prescription to issue as the visit finishes.
#[derive(Debug, Clone)]
pub struct FinishRx {
    /// The draft: the visit's patient's, and not another visit's.
    pub id: PrescriptionId,
    /// Why to go ahead despite allergy alerts; needed only when there are alerts.
    pub override_reason: Option<String>,
    /// Email the patient a link, when they have an email.
    pub notify_patient: bool,
    /// Also make a link to hand over (and queue a message for `whatsapp` and `sms`).
    pub share: Option<ShareOptions>,
}

/// What to finish.
#[derive(Debug, Clone, Default)]
pub struct Finish {
    /// Sign the caller's own draft notes (the API's default).
    pub sign_notes: bool,
    /// The prescription to issue, if any.
    pub prescription: Option<FinishRx>,
    /// The follow-up and the fee.
    pub wrap_up: WrapUp,
}

/// A prescription issued while finishing.
#[derive(Debug, Clone)]
pub struct IssuedRx {
    /// The prescription.
    pub prescription: Box<RxView>,
    /// What happened to the patient's emailed copy.
    pub sharing: Sharing,
    /// The link made for handing over, when asked.
    pub share: Option<SharedLink>,
}

/// A finished visit.
#[derive(Debug, Clone)]
pub struct Finished {
    /// The closed visit.
    pub visit: VisitView,
    /// The notes signed now.
    pub signed_note_ids: Vec<ClinicalNoteId>,
    /// Drafts left unsigned: other members' (only their author may sign) and empty ones.
    pub unsigned_note_ids: Vec<ClinicalNoteId>,
    /// The prescription issued, when one was given.
    pub prescription: Option<IssuedRx>,
    /// The follow-up and the draft bill.
    pub wrap_up: WrapUpDone,
}

/// What finishing did.
#[derive(Debug, Clone)]
pub enum FinishOutcome {
    /// Everything landed.
    Finished(Box<Finished>),
    /// Nothing changed: the prescription has allergy alerts and no override reason was given.
    NeedsOverride(Vec<AlertView>),
}

/// Finishes a visit in one transaction: issues the given draft prescription (a block for
/// allergy alerts changes nothing), signs the caller's draft notes, plans the follow-up and the
/// draft bill, and closes the visit.
///
/// # Errors
/// [`AppError::VisitClosed`] when the visit is already closed; [`AppError::NotFound`] when it
/// isn't in this clinic; [`AppError::Denied`] when issuing, the follow-up or the fee needs a
/// permission the member lacks (`prescriptions.issue`, `patients.write`, `billing.write`);
/// [`AppError::Invalid`] for a prescription that isn't a draft of this patient or bad values.
pub async fn finish(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    input: Finish,
    allergy_source: &dyn AllergySource,
    now: OffsetDateTime,
) -> Result<FinishOutcome, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    if input.prescription.is_some() {
        actor.require(Permission::PrescriptionsIssue)?;
    }
    let checked = check_wrap_up(actor, &input.wrap_up, now)?;
    let override_reason = match &input.prescription {
        Some(rx) => override_text(rx.override_reason.as_deref())?,
        None => None,
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalWrite);
        let visit = visits::get_encounter(tx.conn(), visit_id.uuid(), true, reach.member())
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        if visit.status != EncounterStatus::Open.as_str() {
            return Err(AppError::VisitClosed);
        }
        let mut issued = None;
        if let Some(rx) = &input.prescription {
            let (status, patient_id) = rx_dal::lock(
                tx.conn(),
                rx.id.uuid(),
                actor.reach(Permission::PrescriptionsIssue).member(),
            )
            .await?
            .ok_or(AppError::NotFound("prescription"))?;
            if patient_id != visit.patient_id {
                return Err(AppError::invalid(
                    "prescription.id",
                    "is not a prescription of this visit's patient",
                ));
            }
            if status != RxStatus::Draft.as_str() {
                return Err(AppError::Conflict(
                    "this prescription is already issued or cancelled",
                ));
            }
            let draft = load_rx(tx, rx.id.uuid(), None).await?;
            if draft.encounter_id.is_some_and(|e| e != visit.id) {
                return Err(AppError::invalid(
                    "prescription.id",
                    "belongs to another visit",
                ));
            }
            match issue_in(
                tx,
                actor,
                request_id,
                rx.id,
                override_reason.as_deref(),
                rx.notify_patient,
                allergy_source,
                now,
            )
            .await?
            {
                IssueOutcome::NeedsOverride(alerts) => {
                    return Ok(FinishOutcome::NeedsOverride(alerts));
                }
                IssueOutcome::Issued(view, sharing) => {
                    let share = match rx.share {
                        Some(options) => Some(
                            share_in(tx, actor, request_id, rx.id, patient_id, options, now)
                                .await?,
                        ),
                        None => None,
                    };
                    issued = Some(IssuedRx {
                        prescription: view,
                        sharing,
                        share,
                    });
                }
            }
        }
        let (signed, left) = if input.sign_notes {
            sign_own_drafts(tx, actor, visit.id, now).await?
        } else {
            (Vec::new(), Vec::new())
        };
        let wrap_up = wrap_up_in(tx, &visit, &checked, reach.member()).await?;
        let closed = close_in(tx, actor, &visit, now).await?;
        Ok(FinishOutcome::Finished(Box::new(Finished {
            visit: closed,
            signed_note_ids: signed,
            unsigned_note_ids: left,
            prescription: issued,
            wrap_up,
        })))
    })
    .await
}
