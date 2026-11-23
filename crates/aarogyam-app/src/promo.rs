//! Offers and referral codes (docs/plans/visit-story-v2-offers-design.md, Part 2): giving them at
//! the end of a visit, applying them to a draft bill, and what issue, edit, re-bill and void do
//! to a code's use. The code text is never logged; logs carry ids only.
//!
//! Lock order everywhere: the bill, then the code, then the code's use, then the bill's lines.
//! The stale-hold sweep (`app.promo_release_stale_holds`) takes the code then the use, so it
//! never waits in a cycle with these.

use aarogyam_dal::promo::{self as dal, CodeRow, RedemptionRow};
use aarogyam_dal::{billing as bills, patients};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{EncounterId, InvoiceId, PatientId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::promo::{
    self, Code, DiscountKind, OfferSettings, OfferTerms, Purpose, Refusal,
};
use aarogyam_domain::visit_message as message;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::Paise;
use serde_json::{Value, json};
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::billing::{self, InvoiceView};
use crate::clock::{clinic_today, day_range};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// A code as staff see it. `code` is shown only to staff who give or apply it.
#[derive(Debug, Clone)]
pub struct IssuedCode {
    /// Identifier.
    pub id: Uuid,
    /// Display form, `K7QM-4XRD`.
    pub code: String,
    /// What it is for.
    pub purpose: Purpose,
    /// Percentage or fixed.
    pub kind: DiscountKind,
    /// Basis points or paise.
    pub value: i64,
    /// The cap on a percentage code's discount.
    pub max_discount_paise: Option<i64>,
    /// Last clinic day.
    pub valid_to: Date,
    /// The target label, if any.
    pub applies_to: Option<Value>,
}

impl IssuedCode {
    fn of(row: &CodeRow) -> Self {
        Self {
            id: row.id,
            code: Code::parse(&row.code).map_or_else(String::new, |code| code.display()),
            purpose: Purpose::parse(&row.purpose).unwrap_or(Purpose::PatientOffer),
            kind: DiscountKind::parse(&row.kind).unwrap_or(DiscountKind::Fixed),
            value: row.value,
            max_discount_paise: row.max_discount_paise,
            valid_to: row.valid_to,
            applies_to: row.applies_to.clone(),
        }
    }
}

impl IssuedCode {
    /// What it gives, for the words ([`aarogyam_domain::visit_message::discount_words`]).
    #[must_use]
    pub fn discount(&self) -> message::Discount {
        message::Discount {
            kind: self.kind,
            value: self.value,
            max_discount_paise: self.max_discount_paise,
        }
    }

    /// The treatment it is for, from `applies_to`; none means the next treatment.
    #[must_use]
    pub fn target(&self) -> Option<message::OfferTarget<'_>> {
        let target = self.applies_to.as_ref()?;
        Some(message::OfferTarget {
            name: target.get("words")?.as_str()?,
            tooth: target
                .get("tooth")
                .and_then(Value::as_u64)
                .and_then(|n| u8::try_from(n).ok()),
        })
    }
}

/// A patient's live codes for the visit message and the visit page. Never read from a route
/// that logs bodies; the code text only goes into the message and the page.
#[derive(Debug, Clone, Default)]
pub struct MessageCodes {
    /// The patient's own offers and rewards that can still be used.
    pub offers: Vec<IssuedCode>,
    /// The patient's live referral code.
    pub referral: Option<IssuedCode>,
}

/// The codes the visit's message states: the offer given in this visit, the patient's live
/// rewards, and the live referral code given in this visit.
///
/// # Errors
/// [`AppError`] on a database failure.
pub(crate) async fn message_codes(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
    patient_id: Uuid,
    today: Date,
) -> Result<MessageCodes, AppError> {
    let usable = |row: &&CodeRow| row.valid_to >= today && row.used_count < row.max_uses;
    let visit = dal::visit_codes(tx.conn(), encounter_id).await?;
    let mut offers: Vec<IssuedCode> = visit
        .iter()
        .filter(|row| row.purpose == Purpose::PatientOffer.as_str())
        .filter(usable)
        .map(IssuedCode::of)
        .collect();
    for row in dal::patient_codes(tx.conn(), patient_id, today).await? {
        if row.purpose == Purpose::ReferrerReward.as_str() {
            offers.push(IssuedCode::of(&row));
        }
    }
    let referral = visit
        .iter()
        .filter(|row| row.purpose == Purpose::Referral.as_str())
        .find(usable)
        .map(IssuedCode::of);
    Ok(MessageCodes { offers, referral })
}

/// The codes the visit page shows: every live offer and reward of the patient, and their
/// referral code.
///
/// # Errors
/// [`AppError`] on a database failure.
pub(crate) async fn page_codes(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    today: Date,
) -> Result<MessageCodes, AppError> {
    let offers = dal::patient_codes(tx.conn(), patient_id, today)
        .await?
        .iter()
        .map(IssuedCode::of)
        .collect();
    let referral = dal::referral_of(tx.conn(), patient_id)
        .await?
        .filter(|row| row.valid_to >= today && row.valid_from <= today)
        .map(|row| IssuedCode::of(&row));
    Ok(MessageCodes { offers, referral })
}

/// The clinic's presets, lowered to the caller's caps.
#[derive(Debug, Clone)]
pub struct Presets {
    /// Whether the clinic gives patient offers.
    pub offer_enabled: bool,
    /// The one-tap offer.
    pub offer: OfferTerms,
    /// Whether the clinic gives referral codes.
    pub referral_enabled: bool,
    /// What a friend gets: kind.
    pub referral_kind: DiscountKind,
    /// What a friend gets: value.
    pub referral_value: i64,
    /// The friend's cap.
    pub referral_max_discount_paise: i64,
    /// The referral code's validity in days.
    pub referral_valid_days: i64,
    /// The caller's caps.
    pub caps: promo::Caps,
}

/// A visit's live codes and the presets.
#[derive(Debug, Clone)]
pub struct VisitOffers {
    /// The patient's offer from this visit.
    pub patient_offer: Option<IssuedCode>,
    /// The patient's referral code.
    pub referral: Option<IssuedCode>,
    /// The presets.
    pub presets: Presets,
}

/// What to issue for a visit.
#[derive(Debug, Clone, Default)]
pub struct NewVisitOffers {
    /// An offer, with parts left to the presets.
    pub patient_offer: Option<NewPatientOffer>,
    /// A referral code.
    pub referral: bool,
}

/// An offer's requested terms.
#[derive(Debug, Clone, Default)]
pub struct NewPatientOffer {
    /// Kind.
    pub kind: Option<DiscountKind>,
    /// Value.
    pub value: Option<i64>,
    /// Validity in days.
    pub valid_days: Option<i64>,
    /// The plan item it targets.
    pub plan_item_id: Option<Uuid>,
}

/// One of a patient's codes at the desk.
#[derive(Debug, Clone)]
pub struct PatientCode {
    /// The code.
    pub code: IssuedCode,
    /// Passes the visit check on the bill asked about (true without a bill or a target).
    pub eligible: bool,
    /// Why not, when not eligible.
    pub reason: Option<&'static str>,
}

/// The use of a code on a bill, as the bill shows it (never the code text).
#[derive(Debug, Clone)]
pub struct PromoView {
    /// The code's id.
    pub code_id: Uuid,
    /// Its purpose.
    pub purpose: Purpose,
    /// `held` or `final`.
    pub status: String,
    /// The discount it gives.
    pub discount: Paise,
}

/// The bill's live code use, for the invoice response.
pub(crate) async fn bill_promo(
    tx: &mut ScopedTx,
    invoice_id: Uuid,
) -> Result<Option<PromoView>, AppError> {
    Ok(dal::bill_promo(tx.conn(), invoice_id)
        .await?
        .map(|row| PromoView {
            code_id: row.promo_code_id,
            purpose: Purpose::parse(&row.purpose).unwrap_or(Purpose::PatientOffer),
            status: row.status,
            discount: Paise::new(row.discount_paise),
        }))
}

fn refused(refusal: Refusal) -> AppError {
    AppError::Promo(refusal)
}

async fn settings_in(tx: &mut ScopedTx) -> Result<OfferSettings, AppError> {
    Ok(OfferSettings::from_stored(
        dal::settings(tx.conn()).await?.as_ref(),
    ))
}

async fn caps_of(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    settings: &OfferSettings,
) -> Result<promo::Caps, AppError> {
    let role = dal::member_role(tx.conn(), actor.membership_id.uuid())
        .await?
        .unwrap_or_default();
    Ok(settings.caps_for(role, actor.role_key == "owner"))
}

fn presets(settings: &OfferSettings, caps: promo::Caps) -> Presets {
    Presets {
        offer_enabled: settings.patient_offer.enabled,
        offer: caps.preset(&settings.patient_offer),
        referral_enabled: settings.referral.enabled,
        referral_kind: settings.referral.friend_kind,
        referral_value: settings.referral.friend_value,
        referral_max_discount_paise: settings.referral.friend_max_discount_paise,
        referral_valid_days: settings.referral.valid_days,
        caps,
    }
}

/// The offer settings.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage` or `offers.give`.
pub async fn settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<OfferSettings, AppError> {
    if actor.require(Permission::SettingsManage).is_err() {
        actor.require(Permission::OffersGive)?;
    }
    db.scoped(&scope(actor, request_id), async |tx| settings_in(tx).await)
        .await
}

/// Replaces the offer settings, after checking them.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] naming the field.
pub async fn save_settings(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    value: Value,
) -> Result<OfferSettings, AppError> {
    actor.require(Permission::SettingsManage)?;
    let settings = OfferSettings::parse(value).map_err(|error| AppError::Invalid {
        field: "offers",
        message: error.to_string(),
    })?;
    let stored = serde_json::to_value(&settings).map_err(|_| AppError::Internal("settings"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::save_settings(tx.conn(), &stored).await?;
        Ok(settings)
    })
    .await
}

async fn visit_offers_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    encounter_id: Uuid,
    patient_id: Uuid,
) -> Result<VisitOffers, AppError> {
    let settings = settings_in(tx).await?;
    let caps = caps_of(tx, actor, &settings).await?;
    let codes = dal::visit_codes(tx.conn(), encounter_id).await?;
    let patient_offer = codes
        .iter()
        .find(|code| code.purpose == Purpose::PatientOffer.as_str())
        .map(IssuedCode::of);
    let referral = dal::referral_of(tx.conn(), patient_id)
        .await?
        .map(|code| IssuedCode::of(&code));
    Ok(VisitOffers {
        patient_offer,
        referral,
        presets: presets(&settings, caps),
    })
}

async fn visit_of(tx: &mut ScopedTx, encounter_id: Uuid) -> Result<(Uuid, String), AppError> {
    dal::visit(tx.conn(), encounter_id)
        .await?
        .ok_or(AppError::NotFound("visit"))
}

/// A visit's live codes and the caller's presets.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`; [`AppError::NotFound`].
pub async fn visit_offers(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    encounter_id: EncounterId,
) -> Result<VisitOffers, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let (patient_id, _) = visit_of(tx, encounter_id.uuid()).await?;
        patients::get(tx.conn(), patient_id, None)
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        visit_offers_in(tx, actor, encounter_id.uuid(), patient_id).await
    })
    .await
}

fn random_code() -> Result<Code, AppError> {
    let mut bytes = [0_u8; 5];
    aws_lc_rs::rand::fill(&mut bytes)
        .map_err(|_| AppError::Internal("random number generator failed"))?;
    Ok(Code::from_random(bytes))
}

/// Inserts a code with a fresh random text, drawing again when the text is taken.
async fn insert_new(tx: &mut ScopedTx, code: dal::NewCode<'_>) -> Result<Uuid, AppError> {
    for _ in 0..5 {
        let text = random_code()?;
        let attempt = dal::NewCode {
            id: Uuid::now_v7(),
            code: text.as_str(),
            applies_to: code.applies_to.clone(),
            ..code
        };
        if dal::insert_code(tx.conn(), &attempt).await? {
            return Ok(attempt.id);
        }
    }
    Err(AppError::Internal("could not draw a free code"))
}

fn last_day(today: Date, valid_days: i64) -> Date {
    today
        .checked_add(Duration::days(valid_days.max(1) - 1))
        .unwrap_or(today)
}

async fn applies_to(
    tx: &mut ScopedTx,
    plan_item_id: Option<Uuid>,
    patient_id: Uuid,
) -> Result<Option<Value>, AppError> {
    let Some(item) = plan_item_id else {
        return Ok(None);
    };
    let (tooth, name, term) =
        dal::plan_item(tx.conn(), item, patient_id)
            .await?
            .ok_or(AppError::invalid(
                "patient_offer.plan_item_id",
                "is not a plan item of this patient",
            ))?;
    Ok(Some(json!({
        "plan_item_id": item,
        "tooth": tooth,
        "procedure_term": term,
        "words": name,
    })))
}

/// Gives the visit's patient an offer and/or a referral code. Asking again returns the live
/// ones: `true` when something was created.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read` and `offers.give`; [`AppError::NotFound`];
/// [`AppError::Promo`] `visit_open`, `offer_disabled` or `over_cap` (400).
pub async fn issue_visit_offers(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    encounter_id: EncounterId,
    input: NewVisitOffers,
    now: OffsetDateTime,
) -> Result<(VisitOffers, bool), AppError> {
    actor.require(Permission::ClinicalRead)?;
    actor.require(Permission::OffersGive)?;
    let today = clinic_today(&actor.timezone, now);
    db.scoped(&scope(actor, request_id), async |tx| {
        let (patient_id, status) = visit_of(tx, encounter_id.uuid()).await?;
        patients::get(tx.conn(), patient_id, None)
            .await?
            .ok_or(AppError::NotFound("visit"))?;
        if status == "open" {
            return Err(refused(Refusal::VisitOpen));
        }
        let settings = settings_in(tx).await?;
        let caps = caps_of(tx, actor, &settings).await?;
        let current = visit_offers_in(tx, actor, encounter_id.uuid(), patient_id).await?;
        let mut created = false;
        if let Some(offer) = &input.patient_offer
            && current.patient_offer.is_none()
        {
            if !settings.patient_offer.enabled {
                return Err(refused(Refusal::Disabled));
            }
            let terms = caps
                .terms(&settings.patient_offer, offer.kind, offer.value, offer.valid_days)
                .map_err(refused)?;
            let target = applies_to(tx, offer.plan_item_id, patient_id).await?;
            let id = insert_new(
                tx,
                dal::NewCode {
                    id: Uuid::nil(),
                    code: "",
                    purpose: Purpose::PatientOffer.as_str(),
                    kind: terms.kind.as_str(),
                    value: terms.value,
                    max_discount_paise: terms.max_discount_paise,
                    patient_id,
                    issued_encounter_id: Some(encounter_id.uuid()),
                    source_code_id: None,
                    source_patient_id: None,
                    issued_by: actor.membership_id.uuid(),
                    valid_from: today,
                    valid_to: last_day(today, terms.valid_days),
                    max_uses: 1,
                    applies_to: target,
                },
            )
            .await?;
            tracing::info!(event = Event::OfferIssued.as_str(), promo_code_id = %id,
                           purpose = "patient_offer", visit_id = %encounter_id.uuid(), "offer issued");
            created = true;
        }
        if input.referral && current.referral.is_none() {
            let referral = &settings.referral;
            if !referral.enabled {
                return Err(refused(Refusal::Disabled));
            }
            let id = insert_new(
                tx,
                dal::NewCode {
                    id: Uuid::nil(),
                    code: "",
                    purpose: Purpose::Referral.as_str(),
                    kind: referral.friend_kind.as_str(),
                    value: referral.friend_value,
                    max_discount_paise: (referral.friend_kind == DiscountKind::PercentBps)
                        .then_some(referral.friend_max_discount_paise),
                    patient_id,
                    issued_encounter_id: Some(encounter_id.uuid()),
                    source_code_id: None,
                    source_patient_id: None,
                    issued_by: actor.membership_id.uuid(),
                    valid_from: today,
                    valid_to: last_day(today, referral.valid_days),
                    max_uses: i32::try_from(referral.max_uses).unwrap_or(1),
                    applies_to: None,
                },
            )
            .await?;
            tracing::info!(event = Event::OfferIssued.as_str(), promo_code_id = %id,
                           purpose = "referral", visit_id = %encounter_id.uuid(), "offer issued");
            created = true;
        }
        let offers = visit_offers_in(tx, actor, encounter_id.uuid(), patient_id).await?;
        Ok((offers, created))
    })
    .await
}

/// Zeroes a draft's code shares.
async fn zero_lines(tx: &mut ScopedTx, invoice_id: Uuid) -> Result<(), AppError> {
    for line in bills::invoice_lines(tx.conn(), invoice_id).await? {
        if line.promo_discount_paise != 0 {
            dal::set_line_promo(tx.conn(), line.id, 0).await?;
        }
    }
    Ok(())
}

/// Reverses a held use: its lines lose the share and the code gets the use back.
async fn release_hold(
    tx: &mut ScopedTx,
    actor: Option<&ClinicActor>,
    hold: &RedemptionRow,
    reason: &str,
) -> Result<(), AppError> {
    dal::reverse_redemption(
        tx.conn(),
        hold.id,
        actor.map(|actor| actor.membership_id.uuid()),
        reason,
    )
    .await?;
    zero_lines(tx, hold.invoice_id).await?;
    dal::add_use(tx.conn(), hold.promo_code_id, -1).await?;
    tracing::info!(event = Event::OfferReversed.as_str(), promo_code_id = %hold.promo_code_id,
                   invoice_id = %hold.invoice_id, reason, "offer use reversed");
    Ok(())
}

/// Revokes a code. Held uses are reversed and their drafts lose the discount; final uses stay.
///
/// # Errors
/// [`AppError::Denied`] without `offers.give` (own codes only) or `settings.manage`;
/// [`AppError::NotFound`]; [`AppError::Promo`] `already_revoked`.
pub async fn revoke(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    code_id: Uuid,
    reason: &str,
) -> Result<(), AppError> {
    let manager = actor.require(Permission::SettingsManage).is_ok();
    if !manager {
        actor.require(Permission::OffersGive)?;
    }
    if !matches!(reason, "undo" | "staff") {
        return Err(AppError::invalid("reason", "must be undo or staff"));
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let code = dal::lock_code(tx.conn(), code_id)
            .await?
            .ok_or(AppError::NotFound("promo code"))?;
        if !manager && code.issued_by != actor.membership_id.uuid() {
            return Err(AppError::Denied(
                aarogyam_domain::access::Denied::MissingPermission(Permission::SettingsManage),
            ));
        }
        if code.revoked_at.is_some() {
            return Err(refused(Refusal::AlreadyRevoked));
        }
        for hold in dal::held_redemptions(tx.conn(), code.id).await? {
            release_hold(tx, Some(actor), &hold, "revoked").await?;
        }
        dal::revoke_code(tx.conn(), code.id, Some(actor.membership_id.uuid()), reason).await?;
        Ok(())
    })
    .await
}

/// The bill's encounter, read for the visit check.
async fn passes_visit_check(
    tx: &mut ScopedTx,
    encounter_id: Option<Uuid>,
    target: Option<&Value>,
) -> Result<bool, AppError> {
    let Some(target) = target.filter(|t| t.is_object()) else {
        return Ok(true);
    };
    let Some(encounter_id) = encounter_id else {
        return Ok(false);
    };
    let uuid = |key: &str| {
        target
            .get(key)
            .and_then(Value::as_str)
            .and_then(|text| Uuid::parse_str(text).ok())
    };
    let tooth = target
        .get("tooth")
        .and_then(Value::as_i64)
        .and_then(|t| i16::try_from(t).ok());
    let term = target.get("procedure_term").and_then(Value::as_str);
    Ok(dal::visit_recorded(
        tx.conn(),
        encounter_id,
        uuid("plan_item_id"),
        uuid("procedure_id"),
        tooth,
        term,
    )
    .await?)
}

/// A patient's live offers and rewards; with a bill, each says whether it passes the visit check.
///
/// # Errors
/// [`AppError::Denied`] without `billing.read` or `payments.collect`; [`AppError::NotFound`]
/// for an unknown patient, or a bill that isn't theirs.
pub async fn patient_offers(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    invoice_id: Option<InvoiceId>,
    now: OffsetDateTime,
) -> Result<Vec<PatientCode>, AppError> {
    if actor.require(Permission::BillingRead).is_err() {
        actor.require(Permission::PaymentsCollect)?;
    }
    let today = clinic_today(&actor.timezone, now);
    db.scoped(&scope(actor, request_id), async |tx| {
        patients::get(tx.conn(), patient_id.uuid(), None)
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let encounter = match invoice_id {
            Some(id) => {
                let bill = bills::lock_invoices(tx.conn(), &[id.uuid()])
                    .await?
                    .into_iter()
                    .next()
                    .filter(|bill| bill.patient_id == patient_id.uuid())
                    .ok_or(AppError::NotFound("invoice"))?;
                Some(dal::invoice_encounter(tx.conn(), bill.id).await?)
            }
            None => None,
        };
        let mut out = Vec::new();
        for row in dal::patient_codes(tx.conn(), patient_id.uuid(), today).await? {
            let eligible = match &encounter {
                Some(encounter) => {
                    passes_visit_check(tx, *encounter, row.applies_to.as_ref()).await?
                }
                None => true,
            };
            out.push(PatientCode {
                code: IssuedCode::of(&row),
                eligible,
                reason: (!eligible).then_some(Refusal::NotForThisVisit.code()),
            });
        }
        Ok(out)
    })
    .await
}

/// Writes the draft's code shares from its live hold, and the hold's discount. Nothing without a
/// hold. A draft left with nothing to discount keeps the hold at zero.
pub(crate) async fn recompute_in(tx: &mut ScopedTx, invoice_id: Uuid) -> Result<Paise, AppError> {
    let Some(hold) = dal::bill_redemption(tx.conn(), invoice_id).await? else {
        return Ok(Paise::ZERO);
    };
    if hold.status != "held" {
        return Ok(Paise::new(hold.discount_paise));
    }
    let code = dal::lock_code(tx.conn(), hold.promo_code_id)
        .await?
        .ok_or(AppError::Internal("held code missing"))?;
    let lines = bills::invoice_lines(tx.conn(), invoice_id).await?;
    let bases = bases_of(&lines);
    let kind = DiscountKind::parse(&code.kind).unwrap_or(DiscountKind::Fixed);
    let total = promo::discount(
        kind,
        code.value,
        code.max_discount_paise.map(Paise::new),
        &bases,
    )
    .unwrap_or(Paise::ZERO);
    let shares = promo::split(&bases, total);
    for (line, share) in lines.iter().zip(&shares) {
        if line.promo_discount_paise != share.get() {
            dal::set_line_promo(tx.conn(), line.id, share.get()).await?;
        }
    }
    dal::set_redemption_discount(tx.conn(), hold.id, total.get()).await?;
    Ok(total)
}

/// Locks the bill's live use and its code, in the code-then-use order, before the bill's lines
/// are touched (edit, issue, void).
pub(crate) async fn lock_hold(
    tx: &mut ScopedTx,
    invoice_id: Uuid,
) -> Result<Option<(CodeRow, RedemptionRow)>, AppError> {
    let Some(found) = dal::last_bill_redemption(tx.conn(), invoice_id).await? else {
        return Ok(None);
    };
    let Some(code) = dal::lock_code(tx.conn(), found.promo_code_id).await? else {
        return Ok(None);
    };
    let live = dal::bill_redemption(tx.conn(), invoice_id).await?;
    Ok(live.map(|live| (code, live)))
}

/// Who may redeem (§2.4); returns the bill's visit for the target check.
async fn check_redeemer(
    tx: &mut ScopedTx,
    code: &CodeRow,
    purpose: Purpose,
    bill: &bills::InvoiceLock,
    today_start: OffsetDateTime,
) -> Result<Option<Uuid>, AppError> {
    let encounter = dal::invoice_encounter(tx.conn(), bill.id).await?;
    let facts = if purpose == Purpose::Referral {
        let found = dal::referral_facts(
            tx.conn(),
            code.patient_id,
            bill.patient_id,
            encounter,
            today_start,
        )
        .await?;
        Some(promo::ReferralFacts {
            owner: code.patient_id,
            redeemer: bill.patient_id,
            shares_phone: found.shares_phone,
            related: found.related,
            referred_by: found.referred_by,
            first_visit: found.first_visit,
        })
    } else {
        None
    };
    promo::may_redeem(purpose, code.patient_id, bill.patient_id, facts.as_ref())
        .map_err(refused)?;
    Ok(encounter)
}

/// Each line's value before the code: gross less the manual discount.
fn bases_of(lines: &[bills::InvoiceLineRow]) -> Vec<Paise> {
    lines
        .iter()
        .map(|line| {
            let gross = line
                .unit_price_paise
                .saturating_mul(i64::from(line.quantity));
            Paise::new((gross - line.discount_paise).max(0))
        })
        .collect()
}

/// Applies a code to a draft bill: checks it, holds it (or moves the patient's hold from
/// another draft) and splits the discount over the lines.
///
/// # Errors
/// [`AppError::Denied`] without `billing.write` or `payments.collect`; [`AppError::NotFound`]
/// for an unknown bill or code (or another clinic's); [`AppError::Promo`] with the reason.
pub async fn apply(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    invoice_id: InvoiceId,
    code_text: &str,
    override_target: bool,
    now: OffsetDateTime,
) -> Result<InvoiceView, AppError> {
    let billing_write = actor.require(Permission::BillingWrite).is_ok();
    if !billing_write {
        actor.require(Permission::PaymentsCollect)?;
    }
    let today = clinic_today(&actor.timezone, now);
    let (today_start, _) = day_range(&actor.timezone, today, today);
    db.scoped(&scope(actor, request_id), async |tx| {
        let bill = bills::lock_invoices(tx.conn(), &[invoice_id.uuid()])
            .await?
            .into_iter()
            .next()
            .ok_or(AppError::NotFound("invoice"))?;
        if bill.status != "draft" {
            return Err(refused(Refusal::NotDraft));
        }
        let text = Code::parse(code_text).ok_or(AppError::NotFound("promo code"))?;
        let code = dal::lock_code_by_text(tx.conn(), text.as_str())
            .await?
            .ok_or(AppError::NotFound("promo code"))?;
        if dal::bill_redemption(tx.conn(), bill.id).await?.is_some() {
            return Err(refused(Refusal::BillHasPromo));
        }
        let purpose = Purpose::parse(&code.purpose).unwrap_or(Purpose::Referral);
        promo::collector_may_apply(
            billing_write,
            purpose,
            code.patient_id,
            bill.patient_id,
            override_target,
        )
        .map_err(refused)?;
        // The patient's live use of this code elsewhere: a hold on another draft moves here.
        let elsewhere = dal::code_patient_redemption(tx.conn(), code.id, bill.patient_id).await?;
        let moving = match &elsewhere {
            Some(old) if old.status == "held" => {
                if !billing_write && old.applied_by != Some(actor.membership_id.uuid()) {
                    return Err(refused(Refusal::HoldElsewhere));
                }
                true
            }
            Some(_) => return Err(refused(Refusal::Used)),
            None => false,
        };
        let used = if moving {
            code.used_count - 1
        } else {
            code.used_count
        };
        promo::usable(
            today,
            code.valid_from,
            code.valid_to,
            code.revoked_at.is_some(),
            used,
            code.max_uses,
        )
        .map_err(refused)?;
        let encounter = check_redeemer(tx, &code, purpose, &bill, today_start).await?;
        let recorded = passes_visit_check(tx, encounter, code.applies_to.as_ref()).await?;
        if !recorded && !override_target {
            return Err(refused(Refusal::NotForThisVisit));
        }
        let lines = bills::invoice_lines(tx.conn(), bill.id).await?;
        let bases = bases_of(&lines);
        let kind = DiscountKind::parse(&code.kind).unwrap_or(DiscountKind::Fixed);
        promo::discount(
            kind,
            code.value,
            code.max_discount_paise.map(Paise::new),
            &bases,
        )
        .map_err(refused)?;
        if let Some(old) = &elsewhere {
            dal::reverse_redemption(tx.conn(), old.id, Some(actor.membership_id.uuid()), "moved")
                .await?;
            zero_lines(tx, old.invoice_id).await?;
            tracing::info!(event = Event::OfferReversed.as_str(), promo_code_id = %code.id,
                           invoice_id = %old.invoice_id, reason = "moved", "offer use reversed");
        } else {
            dal::add_use(tx.conn(), code.id, 1).await?;
        }
        dal::insert_redemption(
            tx.conn(),
            code.id,
            bill.patient_id,
            bill.id,
            actor.membership_id.uuid(),
            override_target && !recorded,
        )
        .await?;
        recompute_in(tx, bill.id).await?;
        tracing::info!(event = Event::OfferRedeemed.as_str(), promo_code_id = %code.id,
                       invoice_id = %bill.id, status = "held", "offer applied");
        billing::load_view(tx, bill.id).await
    })
    .await
}

/// Removes the code from a draft: the use is reversed and the code can be used again.
///
/// # Errors
/// [`AppError::Denied`] without `billing.write` or `payments.collect`; [`AppError::NotFound`]
/// for an unknown bill or a bill with no code; [`AppError::Promo`] `not_applier` (403) or
/// `not_draft`.
pub async fn remove(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    invoice_id: InvoiceId,
) -> Result<InvoiceView, AppError> {
    let billing_write = actor.require(Permission::BillingWrite).is_ok();
    if !billing_write {
        actor.require(Permission::PaymentsCollect)?;
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let bill = bills::lock_invoices(tx.conn(), &[invoice_id.uuid()])
            .await?
            .into_iter()
            .next()
            .ok_or(AppError::NotFound("invoice"))?;
        if bill.status != "draft" {
            return Err(refused(Refusal::NotDraft));
        }
        let (_, hold) = lock_hold(tx, bill.id)
            .await?
            .ok_or(AppError::NotFound("promo code"))?;
        if !billing_write && hold.applied_by != Some(actor.membership_id.uuid()) {
            return Err(refused(Refusal::NotApplier));
        }
        release_hold(tx, Some(actor), &hold, "removed").await?;
        billing::load_view(tx, bill.id).await
    })
    .await
}

/// What the issue of a bill with a hold must finish, after the totals are stored.
pub(crate) struct IssuedHold {
    code: CodeRow,
    hold: RedemptionRow,
}

/// Before issue: locks the hold and recomputes the shares on the draft's final lines.
pub(crate) async fn before_issue(
    tx: &mut ScopedTx,
    invoice_id: Uuid,
) -> Result<Option<IssuedHold>, AppError> {
    let Some((code, hold)) = lock_hold(tx, invoice_id).await? else {
        return Ok(None);
    };
    if hold.status != "held" {
        return Ok(None);
    }
    recompute_in(tx, invoice_id).await?;
    Ok(Some(IssuedHold { code, hold }))
}

/// After issue: the use becomes final; a referral records who referred the patient and mints
/// the owner's reward. Minting runs in a savepoint and never fails the issue.
pub(crate) async fn after_issue(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    issued: IssuedHold,
    bill_total: Paise,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let IssuedHold { code, hold } = issued;
    let discount = dal::bill_redemption(tx.conn(), hold.invoice_id)
        .await?
        .map_or(0, |live| live.discount_paise);
    dal::finalize_redemption(tx.conn(), hold.id, discount, now).await?;
    tracing::info!(event = Event::OfferRedeemed.as_str(), promo_code_id = %code.id,
                   invoice_id = %hold.invoice_id, status = "final", "offer redeemed");
    if code.purpose != Purpose::Referral.as_str() {
        return Ok(());
    }
    dal::set_referred_by(tx.conn(), hold.patient_id, code.patient_id).await?;
    dal::savepoint(tx.conn()).await?;
    if mint_reward(tx, actor, &code, hold.patient_id, bill_total, now)
        .await
        .is_ok()
    {
        dal::release(tx.conn()).await?;
    } else {
        {
            dal::rollback_to(tx.conn()).await?;
            tracing::warn!(referral_code_id = %code.id, invoice_id = %hold.invoice_id,
                           owner_patient_id = %code.patient_id, "referral reward skipped");
        }
    }
    Ok(())
}

async fn mint_reward(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    referral: &CodeRow,
    friend: Uuid,
    bill_total: Paise,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let settings = settings_in(tx).await?;
    let reward = &settings.referral.reward;
    if !reward.enabled || bill_total.get() < reward.min_bill_paise {
        return Ok(());
    }
    if let Some(existing) = dal::lock_reward(tx.conn(), referral.id, friend).await? {
        if existing.revoke_reason.as_deref() == Some("source_void") {
            dal::unrevoke_code(tx.conn(), existing.id).await?;
        }
        return Ok(());
    }
    if !dal::patient_active(tx.conn(), referral.patient_id).await? {
        return Ok(());
    }
    let today = clinic_today(&actor.timezone, now);
    let month_start = today.replace_day(1).unwrap_or(today);
    let next_month = month_start
        .checked_add(Duration::days(32))
        .and_then(|d| d.replace_day(1).ok())
        .unwrap_or(today);
    let month_end = next_month.previous_day().unwrap_or(today);
    let got = dal::rewards_between(tx.conn(), referral.patient_id, month_start, month_end).await?;
    if got >= reward.max_per_month {
        return Ok(());
    }
    let id = insert_new(
        tx,
        dal::NewCode {
            id: Uuid::nil(),
            code: "",
            purpose: Purpose::ReferrerReward.as_str(),
            kind: reward.kind.as_str(),
            value: reward.value,
            max_discount_paise: (reward.kind == DiscountKind::PercentBps)
                .then_some(reward.max_discount_paise),
            patient_id: referral.patient_id,
            issued_encounter_id: None,
            source_code_id: Some(referral.id),
            source_patient_id: Some(friend),
            issued_by: actor.membership_id.uuid(),
            valid_from: today,
            valid_to: last_day(today, reward.valid_days),
            max_uses: 1,
            applies_to: None,
        },
    )
    .await?;
    tracing::info!(event = Event::ReferralRewardIssued.as_str(), promo_code_id = %id,
                   referral_code_id = %referral.id, "referral reward issued");
    Ok(())
}

/// On void (draft or issued): the use is reversed and the code gets it back; a referral's
/// unredeemed reward is revoked (`source_void`).
pub(crate) async fn on_void(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    invoice_id: Uuid,
) -> Result<(), AppError> {
    let Some((code, live)) = lock_hold(tx, invoice_id).await? else {
        return Ok(());
    };
    dal::reverse_redemption(tx.conn(), live.id, Some(actor.membership_id.uuid()), "void").await?;
    dal::add_use(tx.conn(), code.id, -1).await?;
    tracing::info!(event = Event::OfferReversed.as_str(), promo_code_id = %code.id,
                   invoice_id = %invoice_id, reason = "void", "offer use reversed");
    if live.status == "final"
        && code.purpose == Purpose::Referral.as_str()
        && let Some(reward) = dal::lock_reward(tx.conn(), code.id, live.patient_id).await?
        && reward.revoked_at.is_none()
        && reward.used_count == 0
    {
        dal::revoke_code(
            tx.conn(),
            reward.id,
            Some(actor.membership_id.uuid()),
            "source_void",
        )
        .await?;
    }
    Ok(())
}

/// F2 before a re-bill's lines are written: when the voided bill carried a code, the new manual
/// discounts may not exceed its manual ones.
pub(crate) async fn check_rebill(
    tx: &mut ScopedTx,
    replaced: Uuid,
    new_manual: &[Paise],
) -> Result<bool, AppError> {
    if dal::last_bill_redemption(tx.conn(), replaced)
        .await?
        .is_none()
    {
        return Ok(false);
    }
    let old: Vec<(Paise, Paise)> = bills::invoice_lines(tx.conn(), replaced)
        .await?
        .iter()
        .map(|line| {
            (
                Paise::new(line.discount_paise),
                Paise::new(line.promo_discount_paise),
            )
        })
        .collect();
    promo::rebill_discounts(new_manual, &old).map_err(refused)?;
    Ok(true)
}

/// After a re-bill's lines are written: the voided bill's code is held again when the patient
/// still qualifies; otherwise the new draft simply has none.
pub(crate) async fn rehold(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    replaced: Uuid,
    new_invoice: Uuid,
    patient_id: Uuid,
    now: OffsetDateTime,
) -> Result<(), AppError> {
    let Some(old) = dal::last_bill_redemption(tx.conn(), replaced).await? else {
        return Ok(());
    };
    let Some(code) = dal::lock_code(tx.conn(), old.promo_code_id).await? else {
        return Ok(());
    };
    let today = clinic_today(&actor.timezone, now);
    let live_elsewhere = dal::code_patient_redemption(tx.conn(), code.id, patient_id).await?;
    if live_elsewhere.is_some()
        || promo::usable(
            today,
            code.valid_from,
            code.valid_to,
            code.revoked_at.is_some(),
            code.used_count,
            code.max_uses,
        )
        .is_err()
    {
        return Ok(());
    }
    dal::add_use(tx.conn(), code.id, 1).await?;
    dal::insert_redemption(
        tx.conn(),
        code.id,
        patient_id,
        new_invoice,
        actor.membership_id.uuid(),
        old.is_override,
    )
    .await?;
    recompute_in(tx, new_invoice).await?;
    tracing::info!(event = Event::OfferRedeemed.as_str(), promo_code_id = %code.id,
                   invoice_id = %new_invoice, status = "held", "offer held again on re-bill");
    Ok(())
}
