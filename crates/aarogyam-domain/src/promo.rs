//! Offers and referral codes (docs/plans/visit-story-v2-offers-design.md, Part 2): the code
//! format, who may redeem, the discount and its split over a bill's lines, the clinic's settings
//! and each role's caps. Pure rules; the app does the locking and the writes.

use sakalya_types::Paise;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Crockford base32 without I, L, O and U.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// An 8-symbol code (40 bits), stored without the hyphen. Never logged or put in a URL.
#[derive(Clone, PartialEq, Eq)]
pub struct Code(String);

impl std::fmt::Debug for Code {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Code(****)")
    }
}

impl Code {
    /// A code from 5 random bytes (40 bits, 8 symbols of 5 bits).
    #[must_use]
    pub fn from_random(bytes: [u8; 5]) -> Self {
        let mut bits = bytes
            .iter()
            .fold(0_u64, |acc, byte| (acc << 8) | u64::from(*byte));
        let mut symbols = [0_u8; 8];
        for symbol in symbols.iter_mut().rev() {
            *symbol = ALPHABET[usize::try_from(bits & 31).unwrap_or(0)];
            bits >>= 5;
        }
        Self(symbols.iter().map(|b| char::from(*b)).collect())
    }

    /// Reads what someone typed: case and spaces and hyphens don't matter, and `O` reads as `0`,
    /// `I` and `L` as `1`. `None` unless 8 valid symbols remain.
    #[must_use]
    pub fn parse(input: &str) -> Option<Self> {
        let text: String = input
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .map(|c| match c.to_ascii_uppercase() {
                'O' => '0',
                'I' | 'L' => '1',
                other => other,
            })
            .collect();
        (text.len() == 8 && text.bytes().all(|b| ALPHABET.contains(&b))).then_some(Self(text))
    }

    /// As stored: `K7QM4XRD`.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// As shown: `K7QM-4XRD`.
    #[must_use]
    pub fn display(&self) -> String {
        format!("{}-{}", &self.0[..4], &self.0[4..])
    }
}

macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident { $($(#[$vmeta:meta])* $variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        pub enum $name {
            $($(#[$vmeta])* #[serde(rename = $text)] $variant),+
        }
        impl $name {
            /// The stored text.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }
            /// Parses the stored text.
            #[must_use]
            pub fn parse(text: &str) -> Option<Self> {
                match text { $($text => Some(Self::$variant),)+ _ => None }
            }
        }
    };
}

text_enum!(
    /// A percentage (basis points) or a fixed amount (paise).
    DiscountKind {
        /// `value` is basis points, 1 to 10,000.
        PercentBps => "percent_bps",
        /// `value` is paise.
        Fixed => "fixed",
    }
);

text_enum!(
    /// What a code is for.
    Purpose {
        /// The patient's own offer; only they redeem it.
        PatientOffer => "patient_offer",
        /// The patient's referral code: new patients redeem it, never the owner.
        Referral => "referral",
        /// The referrer's reward for a friend's first bill; only they redeem it.
        ReferrerReward => "referrer_reward",
    }
);

/// Why a code can't be issued, applied, removed or revoked. [`Self::code`] is the problem code;
/// [`Self::status`] the HTTP status class. The message never echoes the code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    /// Past its last day, or not started.
    #[error("This code has expired.")]
    Expired,
    /// Every use is taken (held or final).
    #[error("This code has already been used.")]
    Used,
    /// Revoked.
    #[error("This code was withdrawn.")]
    Revoked,
    /// Someone else's offer or reward, or the owner's own referral code.
    #[error("This code is for another patient.")]
    NotThisPatient,
    /// A referral code on someone who isn't a new patient, or is linked to the owner.
    #[error("Referral codes are for new patients only.")]
    NotNewPatient,
    /// The caller may only apply the bill patient's own offer or reward.
    #[error("Applying this code needs billing access.")]
    NeedsBillingWrite,
    /// The draft has nothing to discount.
    #[error("The bill has no line to discount.")]
    NoEligibleLine,
    /// The code targets a treatment this visit didn't record.
    #[error("This offer is for a treatment not done in this visit.")]
    NotForThisVisit,
    /// The bill is issued or void.
    #[error("Only a draft bill takes a code.")]
    NotDraft,
    /// The bill already has a code.
    #[error("This bill already has a code.")]
    BillHasPromo,
    /// The code is held on another draft, applied by someone else.
    #[error("This code is held on another bill.")]
    HoldElsewhere,
    /// Removing someone else's hold without billing access.
    #[error("Only the person who applied it, or billing, can remove it.")]
    NotApplier,
    /// Revoked already.
    #[error("This code was already withdrawn.")]
    AlreadyRevoked,
    /// The visit is still open.
    #[error("Close the visit first.")]
    VisitOpen,
    /// Over the caller's caps.
    #[error("This offer is over your limit.")]
    OverCap,
    /// The clinic switched this kind of code off.
    #[error("The clinic has switched this off.")]
    Disabled,
    /// A re-bill whose manual discounts include the old bill's offer.
    #[error("The discounts include the old bill's offer; it is applied again by itself.")]
    RebillDiscountIncludesOffer,
}

/// The status class of a [`Refusal`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalStatus {
    /// `400`.
    BadRequest,
    /// `403`.
    Forbidden,
    /// `409`.
    Conflict,
}

impl Refusal {
    /// The problem code clients branch on.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Expired => "promo_expired",
            Self::Used => "promo_used",
            Self::Revoked => "promo_revoked",
            Self::NotThisPatient => "promo_not_this_patient",
            Self::NotNewPatient => "promo_not_new_patient",
            Self::NeedsBillingWrite => "promo_needs_billing_write",
            Self::NoEligibleLine => "promo_no_eligible_line",
            Self::NotForThisVisit => "promo_not_for_this_visit",
            Self::NotDraft => "not_draft",
            Self::BillHasPromo => "bill_has_promo",
            Self::HoldElsewhere => "hold_elsewhere",
            Self::NotApplier => "not_applier",
            Self::AlreadyRevoked => "already_revoked",
            Self::VisitOpen => "visit_open",
            Self::OverCap => "over_cap",
            Self::Disabled => "offer_disabled",
            Self::RebillDiscountIncludesOffer => "rebill_discount_includes_offer",
        }
    }

    /// The HTTP status class.
    #[must_use]
    pub const fn status(self) -> RefusalStatus {
        match self {
            Self::HoldElsewhere | Self::NotApplier => RefusalStatus::Forbidden,
            Self::OverCap | Self::RebillDiscountIncludesOffer => RefusalStatus::BadRequest,
            _ => RefusalStatus::Conflict,
        }
    }
}

/// Whether a code can be used on `today` (the clinic's date).
///
/// # Errors
/// [`Refusal::Revoked`], [`Refusal::Expired`] or [`Refusal::Used`].
pub fn usable(
    today: time::Date,
    valid_from: time::Date,
    valid_to: time::Date,
    revoked: bool,
    used: i32,
    max_uses: i32,
) -> Result<(), Refusal> {
    if revoked {
        return Err(Refusal::Revoked);
    }
    if today < valid_from || today > valid_to {
        return Err(Refusal::Expired);
    }
    if used >= max_uses {
        return Err(Refusal::Used);
    }
    Ok(())
}

/// What the app found about a referral's redeemer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReferralFacts {
    /// The code's owner.
    pub owner: Uuid,
    /// The bill's patient.
    pub redeemer: Uuid,
    /// Shares `phone_e164` or `alt_phone_e164` with the owner.
    pub shares_phone: bool,
    /// Linked to the owner in `patient_relations`.
    pub related: bool,
    /// The redeemer's `referred_by_patient_id`.
    pub referred_by: Option<Uuid>,
    /// The bill is the redeemer's first visit (or, with no visit, nothing before today).
    pub first_visit: bool,
}

/// Who may redeem a code (§2.4): the patient for an offer or reward; for a referral, a new
/// patient who isn't the owner, shares no phone with them and isn't linked to them.
///
/// # Errors
/// [`Refusal::NotThisPatient`] or [`Refusal::NotNewPatient`].
pub fn may_redeem(
    purpose: Purpose,
    code_patient: Uuid,
    redeemer: Uuid,
    referral: Option<&ReferralFacts>,
) -> Result<(), Refusal> {
    match purpose {
        Purpose::PatientOffer | Purpose::ReferrerReward => {
            if code_patient == redeemer {
                Ok(())
            } else {
                Err(Refusal::NotThisPatient)
            }
        }
        Purpose::Referral => {
            if code_patient == redeemer {
                return Err(Refusal::NotThisPatient);
            }
            let facts = referral.ok_or(Refusal::NotNewPatient)?;
            let other_referrer = facts.referred_by.is_some_and(|by| by != facts.owner);
            if facts.shares_phone || facts.related || other_referrer || !facts.first_visit {
                return Err(Refusal::NotNewPatient);
            }
            Ok(())
        }
    }
}

/// D4: a caller with `payments.collect` but no `billing.write` applies only the bill patient's
/// own offer or reward, and never with `override`.
///
/// # Errors
/// [`Refusal::NeedsBillingWrite`].
pub fn collector_may_apply(
    billing_write: bool,
    purpose: Purpose,
    code_patient: Uuid,
    bill_patient: Uuid,
    override_target: bool,
) -> Result<(), Refusal> {
    if billing_write {
        return Ok(());
    }
    let own = matches!(purpose, Purpose::PatientOffer | Purpose::ReferrerReward)
        && code_patient == bill_patient;
    if own && !override_target {
        Ok(())
    } else {
        Err(Refusal::NeedsBillingWrite)
    }
}

/// The discount a code gives on a draft whose lines are worth `bases` (gross less manual
/// discount each): a percentage of the sum, rounded half away from zero, or the fixed amount;
/// never more than the cap or the sum.
///
/// # Errors
/// [`Refusal::NoEligibleLine`] when the sum is zero.
pub fn discount(
    kind: DiscountKind,
    value: i64,
    cap: Option<Paise>,
    bases: &[Paise],
) -> Result<Paise, Refusal> {
    let sum = bases
        .iter()
        .filter(|base| base.get() > 0)
        .fold(0_i64, |acc, base| acc.saturating_add(base.get()));
    if sum <= 0 {
        return Err(Refusal::NoEligibleLine);
    }
    let raw = match kind {
        DiscountKind::PercentBps => {
            let bps = u32::try_from(value.clamp(0, 10_000)).unwrap_or(0);
            Paise::new(sum).share_bps(bps).map_or(sum, Paise::get)
        }
        DiscountKind::Fixed => value.max(0),
    };
    let capped = cap.map_or(raw, |cap| raw.min(cap.get()));
    Ok(Paise::new(capped.min(sum)))
}

/// Splits `total` over lines worth `bases`: floor pro rata, then the leftover paise one each to
/// the largest remainders, ties to the earlier line. Lines worth nothing get nothing; each share
/// is at most its base and the shares add up to `total` (when `total` ≤ the sum of bases).
#[must_use]
pub fn split(bases: &[Paise], total: Paise) -> Vec<Paise> {
    let values: Vec<i128> = bases.iter().map(|b| i128::from(b.get().max(0))).collect();
    let sum: i128 = values.iter().sum();
    let total = i128::from(total.get().max(0)).min(sum);
    if sum == 0 || total == 0 {
        return vec![Paise::ZERO; bases.len()];
    }
    let mut shares: Vec<i128> = values.iter().map(|v| v * total / sum).collect();
    let mut leftover = total - shares.iter().sum::<i128>();
    let mut order: Vec<usize> = (0..values.len()).collect();
    order.sort_by(|a, b| {
        let (ra, rb) = (values[*a] * total % sum, values[*b] * total % sum);
        rb.cmp(&ra).then(a.cmp(b))
    });
    for index in order {
        if leftover == 0 {
            break;
        }
        if values[index] * total % sum > 0 {
            shares[index] += 1;
            leftover -= 1;
        }
    }
    shares
        .into_iter()
        .map(|share| Paise::new(i64::try_from(share).unwrap_or(0)))
        .collect()
}

/// F2: a re-bill of a bill that carried a code may give at most the old bill's manual discounts
/// (Σ `discount_paise − promo_discount_paise` of its issued lines); the code is applied again by
/// itself.
///
/// # Errors
/// [`Refusal::RebillDiscountIncludesOffer`].
pub fn rebill_discounts(new_manual: &[Paise], old_lines: &[(Paise, Paise)]) -> Result<(), Refusal> {
    let new: i64 = new_manual.iter().map(|p| p.get()).sum();
    let old: i64 = old_lines
        .iter()
        .map(|(discount, promo)| (discount.get() - promo.get()).max(0))
        .sum();
    if new > old {
        Err(Refusal::RebillDiscountIncludesOffer)
    } else {
        Ok(())
    }
}

/// A role's limits on the codes it gives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Caps {
    /// Highest percentage, in basis points.
    pub max_percent_bps: i64,
    /// Highest fixed amount, in paise.
    pub max_fixed_paise: i64,
    /// Longest validity, in days.
    pub max_valid_days: i64,
    /// Every percentage code's cap on the discount, in paise (copied onto the code).
    pub max_discount_paise: i64,
}

/// Caps for one role, overriding the default (or the owner's).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoleCaps {
    /// The role.
    pub role_id: Uuid,
    /// Highest percentage, in basis points.
    pub max_percent_bps: i64,
    /// Highest fixed amount, in paise.
    pub max_fixed_paise: i64,
    /// Longest validity, in days.
    pub max_valid_days: i64,
    /// The discount cap, in paise.
    pub max_discount_paise: i64,
}

/// `caps` in the offer settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CapSettings {
    /// Every role without its own row.
    pub default: Caps,
    /// The owner role, when it has no row.
    pub owner: Caps,
    /// Per role, at most 50.
    #[serde(default)]
    pub by_role: Vec<RoleCaps>,
}

impl Default for CapSettings {
    fn default() -> Self {
        Self {
            default: Caps {
                max_percent_bps: 2000,
                max_fixed_paise: 200_000,
                max_valid_days: 90,
                max_discount_paise: 200_000,
            },
            owner: Caps {
                max_percent_bps: 10_000,
                max_fixed_paise: 1_000_000,
                max_valid_days: 365,
                max_discount_paise: 500_000,
            },
            by_role: Vec::new(),
        }
    }
}

fn yes() -> bool {
    true
}
const fn percent() -> DiscountKind {
    DiscountKind::PercentBps
}
const fn ten_percent() -> i64 {
    1000
}
const fn days_30() -> i64 {
    30
}
const fn days_60() -> i64 {
    60
}
const fn days_90() -> i64 {
    90
}
const fn five() -> i64 {
    5
}
const fn three() -> i64 {
    3
}
const fn min_bill() -> i64 {
    50_000
}

/// `patient_offer` in the offer settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatientOfferSettings {
    /// Whether doctors may give one.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// The preset kind.
    #[serde(default = "percent")]
    pub kind: DiscountKind,
    /// The preset value (bps or paise).
    #[serde(default = "ten_percent")]
    pub value: i64,
    /// The preset validity in days.
    #[serde(default = "days_30")]
    pub valid_days: i64,
}

impl Default for PatientOfferSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            kind: DiscountKind::PercentBps,
            value: 1000,
            valid_days: 30,
        }
    }
}

/// `referral.reward` in the offer settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RewardSettings {
    /// Whether a reward is minted.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Its kind.
    #[serde(default = "percent")]
    pub kind: DiscountKind,
    /// Its value.
    #[serde(default = "ten_percent")]
    pub value: i64,
    /// Its validity in days.
    #[serde(default = "days_90")]
    pub valid_days: i64,
    /// Rewards per owner per clinic month.
    #[serde(default = "three")]
    pub max_per_month: i64,
    /// The friend's bill total needed, in paise.
    #[serde(default = "min_bill")]
    pub min_bill_paise: i64,
    /// The reward's own cap, in paise (required).
    pub max_discount_paise: i64,
}

impl Default for RewardSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            kind: DiscountKind::PercentBps,
            value: 1000,
            valid_days: 90,
            max_per_month: 3,
            min_bill_paise: 50_000,
            max_discount_paise: 200_000,
        }
    }
}

/// `referral` in the offer settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReferralSettings {
    /// Whether doctors may give one.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// What the friend gets: kind.
    #[serde(default = "percent")]
    pub friend_kind: DiscountKind,
    /// What the friend gets: value.
    #[serde(default = "ten_percent")]
    pub friend_value: i64,
    /// The cap on the friend's discount, in paise (required).
    pub friend_max_discount_paise: i64,
    /// Validity in days.
    #[serde(default = "days_60")]
    pub valid_days: i64,
    /// How many friends may use it.
    #[serde(default = "five")]
    pub max_uses: i64,
    /// The referrer's reward.
    #[serde(default)]
    pub reward: RewardSettings,
}

impl Default for ReferralSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            friend_kind: DiscountKind::PercentBps,
            friend_value: 1000,
            friend_max_discount_paise: 200_000,
            valid_days: 60,
            max_uses: 5,
            reward: RewardSettings::default(),
        }
    }
}

/// `org_settings.billing.offers`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfferSettings {
    /// The patient's own offer.
    #[serde(default)]
    pub patient_offer: PatientOfferSettings,
    /// Referral codes and rewards.
    #[serde(default)]
    pub referral: ReferralSettings,
    /// Each role's caps.
    #[serde(default)]
    pub caps: CapSettings,
}

/// A setting out of range, by its path.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{field}: {message}")]
pub struct SettingsInvalid {
    /// The field, such as `caps.default.max_percent_bps`.
    pub field: String,
    /// What is wrong.
    pub message: String,
}

fn range(field: &str, value: i64, low: i64, high: i64) -> Result<(), SettingsInvalid> {
    if (low..=high).contains(&value) {
        Ok(())
    } else {
        Err(SettingsInvalid {
            field: field.to_owned(),
            message: format!("must be {low} to {high}"),
        })
    }
}

const BPS: (i64, i64) = (1, 10_000);
const PAISE: (i64, i64) = (100, 10_000_000);
const DAYS: (i64, i64) = (1, 365);

fn value_range(field: &str, kind: DiscountKind, value: i64) -> Result<(), SettingsInvalid> {
    let (low, high) = match kind {
        DiscountKind::PercentBps => BPS,
        DiscountKind::Fixed => PAISE,
    };
    range(field, value, low, high)
}

fn caps_range(path: &str, caps: &Caps) -> Result<(), SettingsInvalid> {
    range(
        &format!("{path}.max_percent_bps"),
        caps.max_percent_bps,
        BPS.0,
        BPS.1,
    )?;
    range(
        &format!("{path}.max_fixed_paise"),
        caps.max_fixed_paise,
        PAISE.0,
        PAISE.1,
    )?;
    range(
        &format!("{path}.max_valid_days"),
        caps.max_valid_days,
        DAYS.0,
        DAYS.1,
    )?;
    range(
        &format!("{path}.max_discount_paise"),
        caps.max_discount_paise,
        PAISE.0,
        PAISE.1,
    )
}

impl OfferSettings {
    /// Reads the stored settings; anything missing or unreadable falls back to the defaults.
    #[must_use]
    pub fn from_stored(value: Option<&serde_json::Value>) -> Self {
        value
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default()
    }

    /// Reads and checks settings sent by a client: an unknown key, a missing
    /// `max_discount_paise` or a value out of range is refused.
    ///
    /// # Errors
    /// [`SettingsInvalid`] naming the field.
    pub fn parse(value: serde_json::Value) -> Result<Self, SettingsInvalid> {
        let settings: Self = serde_json::from_value(value).map_err(|error| SettingsInvalid {
            field: "offers".to_owned(),
            // serde names the field (unknown or missing), never a value.
            message: error.to_string(),
        })?;
        settings.check()?;
        Ok(settings)
    }

    fn check(&self) -> Result<(), SettingsInvalid> {
        let offer = &self.patient_offer;
        value_range("patient_offer.value", offer.kind, offer.value)?;
        range("patient_offer.valid_days", offer.valid_days, DAYS.0, DAYS.1)?;
        let referral = &self.referral;
        value_range(
            "referral.friend_value",
            referral.friend_kind,
            referral.friend_value,
        )?;
        range(
            "referral.friend_max_discount_paise",
            referral.friend_max_discount_paise,
            PAISE.0,
            PAISE.1,
        )?;
        range("referral.valid_days", referral.valid_days, DAYS.0, DAYS.1)?;
        range("referral.max_uses", referral.max_uses, 1, 1000)?;
        let reward = &referral.reward;
        value_range("referral.reward.value", reward.kind, reward.value)?;
        range(
            "referral.reward.valid_days",
            reward.valid_days,
            DAYS.0,
            DAYS.1,
        )?;
        range(
            "referral.reward.max_per_month",
            reward.max_per_month,
            0,
            100,
        )?;
        range(
            "referral.reward.min_bill_paise",
            reward.min_bill_paise,
            0,
            PAISE.1,
        )?;
        range(
            "referral.reward.max_discount_paise",
            reward.max_discount_paise,
            PAISE.0,
            PAISE.1,
        )?;
        caps_range("caps.default", &self.caps.default)?;
        caps_range("caps.owner", &self.caps.owner)?;
        if self.caps.by_role.len() > 50 {
            return Err(SettingsInvalid {
                field: "caps.by_role".to_owned(),
                message: "at most 50 roles".to_owned(),
            });
        }
        for row in &self.caps.by_role {
            caps_range(
                "caps.by_role",
                &Caps {
                    max_percent_bps: row.max_percent_bps,
                    max_fixed_paise: row.max_fixed_paise,
                    max_valid_days: row.max_valid_days,
                    max_discount_paise: row.max_discount_paise,
                },
            )?;
        }
        Ok(())
    }

    /// The caps of a role: its own row, else the owner's for the owner role, else the default.
    #[must_use]
    pub fn caps_for(&self, role_id: Uuid, is_owner: bool) -> Caps {
        self.caps
            .by_role
            .iter()
            .find(|row| row.role_id == role_id)
            .map_or(
                if is_owner {
                    self.caps.owner
                } else {
                    self.caps.default
                },
                |row| Caps {
                    max_percent_bps: row.max_percent_bps,
                    max_fixed_paise: row.max_fixed_paise,
                    max_valid_days: row.max_valid_days,
                    max_discount_paise: row.max_discount_paise,
                },
            )
    }
}

/// A patient offer to issue, after checking it against the caller's caps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OfferTerms {
    /// Kind.
    pub kind: DiscountKind,
    /// Value (bps or paise).
    pub value: i64,
    /// Days from today, counting today.
    pub valid_days: i64,
    /// The cap copied onto a percentage code.
    pub max_discount_paise: Option<i64>,
}

impl Caps {
    /// The highest value of a kind.
    #[must_use]
    pub const fn max_value(&self, kind: DiscountKind) -> i64 {
        match kind {
            DiscountKind::PercentBps => self.max_percent_bps,
            DiscountKind::Fixed => self.max_fixed_paise,
        }
    }

    /// The clinic's preset offer, lowered to these caps.
    #[must_use]
    pub fn preset(&self, offer: &PatientOfferSettings) -> OfferTerms {
        OfferTerms {
            kind: offer.kind,
            value: offer.value.min(self.max_value(offer.kind)),
            valid_days: offer.valid_days.min(self.max_valid_days),
            max_discount_paise: (offer.kind == DiscountKind::PercentBps)
                .then_some(self.max_discount_paise),
        }
    }

    /// Checks a requested offer (missing parts from the preset) against these caps.
    ///
    /// # Errors
    /// [`Refusal::OverCap`] over a cap or under the minimum.
    pub fn terms(
        &self,
        offer: &PatientOfferSettings,
        kind: Option<DiscountKind>,
        value: Option<i64>,
        valid_days: Option<i64>,
    ) -> Result<OfferTerms, Refusal> {
        let preset = self.preset(offer);
        let kind = kind.unwrap_or(preset.kind);
        let value = match value {
            Some(value) => value,
            None if kind == preset.kind => preset.value,
            None => return Err(Refusal::OverCap),
        };
        let valid_days = valid_days.unwrap_or(preset.valid_days);
        let low = match kind {
            DiscountKind::PercentBps => 1,
            DiscountKind::Fixed => 100,
        };
        if value < low
            || value > self.max_value(kind)
            || !(1..=self.max_valid_days).contains(&valid_days)
        {
            return Err(Refusal::OverCap);
        }
        Ok(OfferTerms {
            kind,
            value,
            valid_days,
            max_discount_paise: (kind == DiscountKind::PercentBps)
                .then_some(self.max_discount_paise),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(values: &[i64]) -> Vec<Paise> {
        values.iter().copied().map(Paise::new).collect()
    }

    #[test]
    fn codes_read_back_and_forgive_typing() {
        let code = Code::from_random([0xA5, 0x13, 0xFF, 0x00, 0x7C]);
        assert_eq!(code.as_str().len(), 8);
        assert_eq!(Code::parse(&code.display()), Some(code.clone()));
        assert_eq!(
            Code::parse(" k7qm-4xrd ").map(|c| c.display()),
            Some("K7QM-4XRD".to_owned())
        );
        assert_eq!(
            Code::parse("O1IL-0000").map(|c| c.as_str().to_owned()),
            Some("01110000".to_owned())
        );
        assert_eq!(Code::parse("K7QM-4XRU"), None);
        assert_eq!(Code::parse("K7QM4XR"), None);
        assert_eq!(format!("{code:?}"), "Code(****)");
        assert_eq!(Code::from_random([0; 5]).as_str(), "00000000");
        assert_eq!(Code::from_random([0xFF; 5]).as_str(), "ZZZZZZZZ");
    }

    #[test]
    fn discount_is_capped_and_never_more_than_the_bill() {
        let lines = p(&[100_000, 50_000]);
        let ten = discount(
            DiscountKind::PercentBps,
            1000,
            Some(Paise::new(200_000)),
            &lines,
        );
        assert_eq!(ten, Ok(Paise::new(15_000)));
        let capped = discount(
            DiscountKind::PercentBps,
            5000,
            Some(Paise::new(20_000)),
            &lines,
        );
        assert_eq!(capped, Ok(Paise::new(20_000)));
        let fixed = discount(DiscountKind::Fixed, 900_000, None, &lines);
        assert_eq!(fixed, Ok(Paise::new(150_000)));
        assert_eq!(
            discount(DiscountKind::Fixed, 100, None, &p(&[0, 0])),
            Err(Refusal::NoEligibleLine)
        );
        // Half a paisa rounds away from zero: 10% of 5 paise.
        assert_eq!(
            discount(DiscountKind::PercentBps, 1000, None, &p(&[5])),
            Ok(Paise::new(1))
        );
    }

    #[test]
    fn split_gives_leftovers_to_the_largest_remainders_then_earlier_lines() {
        assert_eq!(split(&p(&[1, 1, 1]), Paise::new(2)), p(&[1, 1, 0]));
        assert_eq!(split(&p(&[300, 0, 700]), Paise::new(101)), p(&[30, 0, 71]));
        assert_eq!(split(&p(&[0, 0]), Paise::new(5)), p(&[0, 0]));
    }

    /// Property: for many pseudo-random bills, every share is between 0 and its base, the shares
    /// add up to the discount, and zero lines get nothing.
    #[test]
    fn split_property() {
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = |bound: u64| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed % bound
        };
        for _ in 0..20_000 {
            let count = usize::try_from(next(8) + 1).unwrap_or(1);
            let bases: Vec<Paise> = (0..count)
                .map(|_| {
                    let zero = next(5) == 0;
                    Paise::new(if zero {
                        0
                    } else {
                        i64::try_from(next(5_000_000)).unwrap_or(0)
                    })
                })
                .collect();
            let sum: i64 = bases.iter().map(|b| b.get()).sum();
            let total =
                Paise::new(i64::try_from(next(u64::try_from(sum).unwrap_or(0) + 1)).unwrap_or(0));
            let shares = split(&bases, total);
            assert_eq!(shares.len(), bases.len());
            assert_eq!(shares.iter().map(|s| s.get()).sum::<i64>(), total.get());
            for (share, base) in shares.iter().zip(&bases) {
                assert!(share.get() >= 0 && share <= base);
            }
        }
    }

    #[test]
    fn who_may_redeem() {
        let (owner, friend) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let facts = ReferralFacts {
            owner,
            redeemer: friend,
            shares_phone: false,
            related: false,
            referred_by: None,
            first_visit: true,
        };
        assert_eq!(
            may_redeem(Purpose::PatientOffer, owner, owner, None),
            Ok(())
        );
        assert_eq!(
            may_redeem(Purpose::ReferrerReward, owner, friend, None),
            Err(Refusal::NotThisPatient)
        );
        assert_eq!(
            may_redeem(Purpose::Referral, owner, friend, Some(&facts)),
            Ok(())
        );
        assert_eq!(
            may_redeem(Purpose::Referral, owner, owner, Some(&facts)),
            Err(Refusal::NotThisPatient)
        );
        for bad in [
            ReferralFacts {
                shares_phone: true,
                ..facts
            },
            ReferralFacts {
                related: true,
                ..facts
            },
            ReferralFacts {
                first_visit: false,
                ..facts
            },
            ReferralFacts {
                referred_by: Some(Uuid::from_u128(9)),
                ..facts
            },
        ] {
            assert_eq!(
                may_redeem(Purpose::Referral, owner, friend, Some(&bad)),
                Err(Refusal::NotNewPatient)
            );
        }
        let same_referrer = ReferralFacts {
            referred_by: Some(owner),
            ..facts
        };
        assert_eq!(
            may_redeem(Purpose::Referral, owner, friend, Some(&same_referrer)),
            Ok(())
        );
    }

    #[test]
    fn collectors_apply_only_the_patients_own_code() {
        let (a, b) = (Uuid::from_u128(1), Uuid::from_u128(2));
        assert_eq!(
            collector_may_apply(false, Purpose::PatientOffer, a, a, false),
            Ok(())
        );
        assert_eq!(
            collector_may_apply(false, Purpose::ReferrerReward, a, a, false),
            Ok(())
        );
        assert_eq!(
            collector_may_apply(false, Purpose::Referral, a, b, false),
            Err(Refusal::NeedsBillingWrite)
        );
        assert_eq!(
            collector_may_apply(false, Purpose::PatientOffer, a, a, true),
            Err(Refusal::NeedsBillingWrite)
        );
        assert_eq!(
            collector_may_apply(true, Purpose::Referral, a, b, true),
            Ok(())
        );
    }

    #[test]
    fn rebill_may_not_carry_the_folded_offer() {
        let old = [
            (Paise::new(15_000), Paise::new(10_000)),
            (Paise::new(0), Paise::new(0)),
        ];
        assert_eq!(rebill_discounts(&p(&[5_000, 0]), &old), Ok(()));
        assert_eq!(
            rebill_discounts(&p(&[15_000]), &old),
            Err(Refusal::RebillDiscountIncludesOffer)
        );
    }

    #[test]
    fn settings_need_every_cap_and_refuse_unknown_keys() {
        let defaults = OfferSettings::default();
        let stored = serde_json::to_value(&defaults).unwrap_or_default();
        assert_eq!(OfferSettings::parse(stored.clone()), Ok(defaults.clone()));
        assert_eq!(OfferSettings::from_stored(None), defaults);
        let missing = serde_json::json!({ "caps": {
            "default": stored["caps"]["default"], "owner": stored["caps"]["owner"],
            "by_role": [{ "role_id": Uuid::from_u128(5), "max_percent_bps": 500,
                          "max_fixed_paise": 10_000, "max_valid_days": 30 }] } });
        assert!(OfferSettings::parse(missing).is_err());
        let unknown = serde_json::json!({ "patient_offer": { "colour": "red" } });
        assert!(OfferSettings::parse(unknown).is_err());
        let wide = serde_json::json!({ "patient_offer": { "valid_days": 400 } });
        assert_eq!(
            OfferSettings::parse(wide).map_err(|e| e.field),
            Err("patient_offer.valid_days".to_owned())
        );
    }

    #[test]
    fn caps_pick_the_role_row_then_owner_then_default() {
        let role = Uuid::from_u128(7);
        let mut settings = OfferSettings::default();
        settings.caps.by_role.push(RoleCaps {
            role_id: role,
            max_percent_bps: 500,
            max_fixed_paise: 10_000,
            max_valid_days: 30,
            max_discount_paise: 5_000,
        });
        assert_eq!(settings.caps_for(role, true).max_percent_bps, 500);
        assert_eq!(settings.caps_for(Uuid::nil(), true).max_percent_bps, 10_000);
        let caps = settings.caps_for(Uuid::nil(), false);
        assert_eq!(caps.max_percent_bps, 2000);
        let offer = PatientOfferSettings::default();
        assert_eq!(
            caps.terms(&offer, None, None, None)
                .map(|t| t.max_discount_paise),
            Ok(Some(200_000))
        );
        assert_eq!(
            caps.terms(&offer, None, Some(2500), None),
            Err(Refusal::OverCap)
        );
        assert_eq!(
            caps.terms(&offer, None, None, Some(91)),
            Err(Refusal::OverCap)
        );
        let small = settings.caps_for(role, false).preset(&offer);
        assert_eq!((small.value, small.valid_days), (500, 30));
    }
}
