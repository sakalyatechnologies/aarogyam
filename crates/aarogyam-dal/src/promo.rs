//! Offer, referral and reward codes and their uses on bills (migration 0743). Everything here
//! runs in the caller's clinic transaction; the code text never leaves through logs.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A code as stored.
#[derive(Debug, Clone)]
pub struct CodeRow {
    /// Identifier.
    pub id: Uuid,
    /// The 8 symbols, without the hyphen.
    pub code: String,
    /// `patient_offer`, `referral` or `referrer_reward`.
    pub purpose: String,
    /// `percent_bps` or `fixed`.
    pub kind: String,
    /// Basis points or paise.
    pub value: i64,
    /// The cap on a percentage code's discount.
    pub max_discount_paise: Option<i64>,
    /// The redeemer (offer, reward) or the owner (referral).
    pub patient_id: Uuid,
    /// The visit it was given in.
    pub issued_encounter_id: Option<Uuid>,
    /// For a reward: the referral code.
    pub source_code_id: Option<Uuid>,
    /// For a reward: the friend.
    pub source_patient_id: Option<Uuid>,
    /// Who gave it.
    pub issued_by: Uuid,
    /// First clinic day.
    pub valid_from: Date,
    /// Last clinic day.
    pub valid_to: Date,
    /// Uses allowed.
    pub max_uses: i32,
    /// Live uses (held and final).
    pub used_count: i32,
    /// The target label, if any.
    pub applies_to: Option<Value>,
    /// When revoked.
    pub revoked_at: Option<OffsetDateTime>,
    /// Why revoked.
    pub revoke_reason: Option<String>,
}

/// A new code.
#[derive(Debug, Clone)]
pub struct NewCode<'a> {
    /// Identifier.
    pub id: Uuid,
    /// The 8 symbols.
    pub code: &'a str,
    /// Purpose.
    pub purpose: &'a str,
    /// Kind.
    pub kind: &'a str,
    /// Value.
    pub value: i64,
    /// Cap.
    pub max_discount_paise: Option<i64>,
    /// Patient.
    pub patient_id: Uuid,
    /// Visit.
    pub issued_encounter_id: Option<Uuid>,
    /// Reward source code.
    pub source_code_id: Option<Uuid>,
    /// Reward source friend.
    pub source_patient_id: Option<Uuid>,
    /// Issuer.
    pub issued_by: Uuid,
    /// First day.
    pub valid_from: Date,
    /// Last day.
    pub valid_to: Date,
    /// Uses allowed.
    pub max_uses: i32,
    /// Target label.
    pub applies_to: Option<Value>,
}

/// A use of a code on a bill.
#[derive(Debug, Clone)]
pub struct RedemptionRow {
    /// Identifier.
    pub id: Uuid,
    /// The code.
    pub promo_code_id: Uuid,
    /// The redeemer.
    pub patient_id: Uuid,
    /// The bill.
    pub invoice_id: Uuid,
    /// `held`, `final` or `reversed`.
    pub status: String,
    /// The discount it gives now.
    pub discount_paise: i64,
    /// Who applied it.
    pub applied_by: Option<Uuid>,
    /// Applied although the visit didn't record the target.
    pub is_override: bool,
}

/// `org_settings.billing.offers`, if set.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn settings(conn: &mut PgConnection) -> Result<Option<Value>, DbError> {
    let value = sqlx::query_scalar!("select billing -> 'offers' from aarogyam.org_settings")
        .fetch_optional(conn)
        .await?;
    Ok(value.flatten())
}

/// Saves `org_settings.billing.offers`, keeping the other billing keys.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save_settings(conn: &mut PgConnection, offers: &Value) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.org_settings set billing = jsonb_set(coalesce(billing, '{}'), '{offers}', $1)",
        offers
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A visit's patient and status (`open`, `closed`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn visit(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Option<(Uuid, String)>, DbError> {
    let row = sqlx::query!(
        r#"select patient_id, status::text as "status!" from aarogyam.encounters where id = $1"#,
        encounter_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.patient_id, row.status)))
}

/// What a plan item names, for an offer's target: tooth and name, when it is the patient's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn plan_item(
    conn: &mut PgConnection,
    plan_item_id: Uuid,
    patient_id: Uuid,
) -> Result<Option<(Option<i16>, String, Option<String>)>, DbError> {
    let row = sqlx::query!(
        "select tooth, name, code from aarogyam.treatment_plan_items where id = $1 and patient_id = $2",
        plan_item_id,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.tooth, row.name, row.code)))
}

/// Adds a code. `false` when the code text is taken (the caller draws another).
///
/// # Errors
/// [`DbError`] on a database failure or another unique conflict.
pub async fn insert_code(conn: &mut PgConnection, code: &NewCode<'_>) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.promo_codes
             (id, code, purpose, kind, value, max_discount_paise, patient_id, issued_encounter_id,
              source_code_id, source_patient_id, issued_by, valid_from, valid_to, max_uses, applies_to)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           on conflict (org_id, code) do nothing"#,
        code.id,
        code.code,
        code.purpose,
        code.kind,
        code.value,
        code.max_discount_paise,
        code.patient_id,
        code.issued_encounter_id,
        code.source_code_id,
        code.source_patient_id,
        code.issued_by,
        code.valid_from,
        code.valid_to,
        code.max_uses,
        code.applies_to
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// A code by id, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_code(conn: &mut PgConnection, id: Uuid) -> Result<Option<CodeRow>, DbError> {
    let row = sqlx::query_as!(
        CodeRow,
        r#"select id, code, purpose, kind, value, max_discount_paise, patient_id, issued_encounter_id,
                  source_code_id, source_patient_id, issued_by, valid_from, valid_to, max_uses,
                  used_count, applies_to, revoked_at, revoke_reason
           from aarogyam.promo_codes where id = $1 for update"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A code by its text, locked until the transaction ends.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_code_by_text(
    conn: &mut PgConnection,
    code: &str,
) -> Result<Option<CodeRow>, DbError> {
    let row = sqlx::query_as!(
        CodeRow,
        r#"select id, code, purpose, kind, value, max_discount_paise, patient_id, issued_encounter_id,
                  source_code_id, source_patient_id, issued_by, valid_from, valid_to, max_uses,
                  used_count, applies_to, revoked_at, revoke_reason
           from aarogyam.promo_codes where code = $1 for update"#,
        code
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The live (not revoked) codes given in a visit.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn visit_codes(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<Vec<CodeRow>, DbError> {
    let rows = sqlx::query_as!(
        CodeRow,
        r#"select id, code, purpose, kind, value, max_discount_paise, patient_id, issued_encounter_id,
                  source_code_id, source_patient_id, issued_by, valid_from, valid_to, max_uses,
                  used_count, applies_to, revoked_at, revoke_reason
           from aarogyam.promo_codes
           where issued_encounter_id = $1 and revoked_at is null order by id"#,
        encounter_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The patient's live referral code, wherever it was given.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn referral_of(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Option<CodeRow>, DbError> {
    let row = sqlx::query_as!(
        CodeRow,
        r#"select id, code, purpose, kind, value, max_discount_paise, patient_id, issued_encounter_id,
                  source_code_id, source_patient_id, issued_by, valid_from, valid_to, max_uses,
                  used_count, applies_to, revoked_at, revoke_reason
           from aarogyam.promo_codes
           where patient_id = $1 and purpose = 'referral' and revoked_at is null"#,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The patient's own offers and rewards that are live on `today`, with uses left.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn patient_codes(
    conn: &mut PgConnection,
    patient_id: Uuid,
    today: Date,
) -> Result<Vec<CodeRow>, DbError> {
    let rows = sqlx::query_as!(
        CodeRow,
        r#"select id, code, purpose, kind, value, max_discount_paise, patient_id, issued_encounter_id,
                  source_code_id, source_patient_id, issued_by, valid_from, valid_to, max_uses,
                  used_count, applies_to, revoked_at, revoke_reason
           from aarogyam.promo_codes
           where patient_id = $1 and purpose in ('patient_offer', 'referrer_reward')
             and revoked_at is null and valid_from <= $2 and valid_to >= $2
             and used_count < max_uses
           order by valid_to, id"#,
        patient_id,
        today
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Revokes a code.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn revoke_code(
    conn: &mut PgConnection,
    id: Uuid,
    by: Option<Uuid>,
    reason: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.promo_codes
           set revoked_at = now(), revoked_by = $2, revoke_reason = $3 where id = $1"#,
        id,
        by,
        reason
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Takes back a reward revoked because its source bill was voided.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn unrevoke_code(conn: &mut PgConnection, id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.promo_codes
           set revoked_at = null, revoked_by = null, revoke_reason = null
           where id = $1 and revoke_reason = 'source_void'"#,
        id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Adds `delta` (+1 or −1) to a code's live uses.
///
/// # Errors
/// [`DbError`] on a database failure (the check keeps it within 0 to `max_uses`).
pub async fn add_use(conn: &mut PgConnection, id: Uuid, delta: i32) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.promo_codes set used_count = used_count + $2 where id = $1",
        id,
        delta
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The live (held or final) use on a bill, locked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn bill_redemption(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<RedemptionRow>, DbError> {
    let row = sqlx::query_as!(
        RedemptionRow,
        r#"select id, promo_code_id, patient_id, invoice_id, status, discount_paise, applied_by,
                  override as is_override
           from aarogyam.promo_redemptions
           where invoice_id = $1 and status <> 'reversed' for update"#,
        invoice_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The most recent use of any status on a bill (a voided bill's, for re-billing).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn last_bill_redemption(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<RedemptionRow>, DbError> {
    let row = sqlx::query_as!(
        RedemptionRow,
        r#"select id, promo_code_id, patient_id, invoice_id, status, discount_paise, applied_by,
                  override as is_override
           from aarogyam.promo_redemptions
           where invoice_id = $1 order by applied_at desc, id desc limit 1"#,
        invoice_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The live use of a code by a patient, locked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn code_patient_redemption(
    conn: &mut PgConnection,
    code_id: Uuid,
    patient_id: Uuid,
) -> Result<Option<RedemptionRow>, DbError> {
    let row = sqlx::query_as!(
        RedemptionRow,
        r#"select id, promo_code_id, patient_id, invoice_id, status, discount_paise, applied_by,
                  override as is_override
           from aarogyam.promo_redemptions
           where promo_code_id = $1 and patient_id = $2 and status <> 'reversed' for update"#,
        code_id,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Every held use of a code, locked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn held_redemptions(
    conn: &mut PgConnection,
    code_id: Uuid,
) -> Result<Vec<RedemptionRow>, DbError> {
    let rows = sqlx::query_as!(
        RedemptionRow,
        r#"select id, promo_code_id, patient_id, invoice_id, status, discount_paise, applied_by,
                  override as is_override
           from aarogyam.promo_redemptions
           where promo_code_id = $1 and status = 'held' order by id for update"#,
        code_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Holds a code on a draft.
///
/// # Errors
/// [`DbError`] on a database failure or a unique conflict.
pub async fn insert_redemption(
    conn: &mut PgConnection,
    code_id: Uuid,
    patient_id: Uuid,
    invoice_id: Uuid,
    applied_by: Uuid,
    is_override: bool,
) -> Result<Uuid, DbError> {
    let id = sqlx::query_scalar!(
        r#"insert into aarogyam.promo_redemptions
             (promo_code_id, patient_id, invoice_id, status, applied_by, override)
           values ($1, $2, $3, 'held', $4, $5) returning id"#,
        code_id,
        patient_id,
        invoice_id,
        applied_by,
        is_override
    )
    .fetch_one(conn)
    .await?;
    Ok(id)
}

/// Reverses a use.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn reverse_redemption(
    conn: &mut PgConnection,
    id: Uuid,
    by: Option<Uuid>,
    reason: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.promo_redemptions
           set status = 'reversed', reversed_at = now(), reversed_by = $2, reverse_reason = $3,
               discount_paise = case when status = 'held' then 0 else discount_paise end
           where id = $1"#,
        id,
        by,
        reason
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Sets a held use's discount after a recompute.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_redemption_discount(
    conn: &mut PgConnection,
    id: Uuid,
    discount_paise: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.promo_redemptions set discount_paise = $2 where id = $1",
        id,
        discount_paise
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Makes a held use final at issue, with its frozen discount.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn finalize_redemption(
    conn: &mut PgConnection,
    id: Uuid,
    discount_paise: i64,
    now: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.promo_redemptions
           set status = 'final', redeemed_at = $3, discount_paise = $2 where id = $1"#,
        id,
        discount_paise,
        now
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Writes a draft line's code share.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_line_promo(
    conn: &mut PgConnection,
    line_id: Uuid,
    promo_paise: i64,
) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.invoice_items set promo_discount_paise = $2 where id = $1",
        line_id,
        promo_paise
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// At issue: folds the code's share into the line's discount (`discount = manual + promo`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn fold_line_promo(conn: &mut PgConnection, line_id: Uuid) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.invoice_items
           set discount_paise = discount_paise + promo_discount_paise
           where id = $1 and promo_discount_paise > 0"#,
        line_id
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// What decides whether a patient may use someone's referral code.
#[derive(Debug, Clone, Copy)]
pub struct ReferralFacts {
    /// Shares a phone number with the owner.
    pub shares_phone: bool,
    /// Linked to the owner as family.
    pub related: bool,
    /// Who referred the patient, if recorded.
    pub referred_by: Option<Uuid>,
    /// The bill's visit is the patient's earliest (or, with no visit, none before `today_start`).
    pub first_visit: bool,
}

/// Reads [`ReferralFacts`] for `redeemer` against the code's `owner`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn referral_facts(
    conn: &mut PgConnection,
    owner: Uuid,
    redeemer: Uuid,
    encounter_id: Option<Uuid>,
    today_start: OffsetDateTime,
) -> Result<ReferralFacts, DbError> {
    let row = sqlx::query!(
        r#"select
             exists (select 1 from aarogyam.patients o, aarogyam.patients f
                     where o.id = $1 and f.id = $2
                       and ((o.phone_e164 is not null and o.phone_e164 in (f.phone_e164, f.alt_phone_e164))
                         or (o.alt_phone_e164 is not null
                             and o.alt_phone_e164 in (f.phone_e164, f.alt_phone_e164)))) as "shares_phone!",
             exists (select 1 from aarogyam.patient_relations r
                     where (r.patient_id = $1 and r.related_patient_id = $2)
                        or (r.patient_id = $2 and r.related_patient_id = $1)) as "related!",
             (select p.referred_by_patient_id from aarogyam.patients p where p.id = $2) as referred_by,
             case when $3::uuid is not null then
               not exists (select 1 from aarogyam.encounters e, aarogyam.encounters b
                           where b.id = $3 and e.patient_id = $2 and e.id <> b.id
                             and e.started_at < b.started_at)
             else
               not exists (select 1 from aarogyam.encounters e
                           where e.patient_id = $2 and e.started_at < $4)
             end as "first_visit!""#,
        owner,
        redeemer,
        encounter_id,
        today_start
    )
    .fetch_one(conn)
    .await?;
    Ok(ReferralFacts {
        shares_phone: row.shares_phone,
        related: row.related,
        referred_by: row.referred_by,
        first_visit: row.first_visit,
    })
}

/// Whether the visit recorded an offer's target (§2.4, R2, F3): a live procedure with the plan
/// item or procedure id, or a tooth chart entry with the procedure term that is current, or
/// superseded by a correction keeping the same term.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn visit_recorded(
    conn: &mut PgConnection,
    encounter_id: Uuid,
    plan_item_id: Option<Uuid>,
    procedure_id: Option<Uuid>,
    tooth: Option<i16>,
    procedure_term: Option<&str>,
) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"select exists (
             select 1 from aarogyam.procedures p
             where p.encounter_id = $1 and p.status::text <> 'entered_in_error'
               and (($2::uuid is not null and p.treatment_plan_item_id = $2)
                 or ($3::uuid is not null and p.id = $3)))
           or exists (
             select 1 from aarogyam.specialty_records s
             where s.encounter_id = $1 and s.kind = 'tooth'
               and $4::smallint is not null and s.tooth = $4
               and $5::text is not null and s.data ->> 'procedure' = $5
               and (s.status::text = 'current'
                 or (s.status::text = 'superseded' and exists (
                       select 1 from aarogyam.specialty_records n
                       where n.supersedes_id = s.id and n.status::text <> 'entered_in_error'
                         and n.data ->> 'procedure' = $5)))) as "found!""#,
        encounter_id,
        plan_item_id,
        procedure_id,
        tooth,
        procedure_term
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// Records who referred a patient, only when nobody is recorded yet.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_referred_by(
    conn: &mut PgConnection,
    patient_id: Uuid,
    owner: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.patients set referred_by_patient_id = $2
           where id = $1 and referred_by_patient_id is null"#,
        patient_id,
        owner
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Whether a patient can still receive a reward: not erased, merged or deleted.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn patient_active(conn: &mut PgConnection, patient_id: Uuid) -> Result<bool, DbError> {
    let active = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.patients
                          where id = $1 and status::text <> 'erased' and merged_into_id is null
                            and deleted_at is null) as "active!""#,
        patient_id
    )
    .fetch_one(conn)
    .await?;
    Ok(active)
}

/// Rewards an owner got from `from` to `to` (clinic dates of issue, both included).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn rewards_between(
    conn: &mut PgConnection,
    owner: Uuid,
    from: Date,
    to: Date,
) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(
        r#"select count(*) as "count!" from aarogyam.promo_codes
           where patient_id = $1 and purpose = 'referrer_reward'
             and valid_from between $2 and $3
             and (revoke_reason is null or revoke_reason <> 'source_void')"#,
        owner,
        from,
        to
    )
    .fetch_one(conn)
    .await?;
    Ok(count)
}

/// The reward minted for a friend through a referral code, of any state, locked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock_reward(
    conn: &mut PgConnection,
    source_code_id: Uuid,
    source_patient_id: Uuid,
) -> Result<Option<CodeRow>, DbError> {
    let row = sqlx::query_as!(
        CodeRow,
        r#"select id, code, purpose, kind, value, max_discount_paise, patient_id, issued_encounter_id,
                  source_code_id, source_patient_id, issued_by, valid_from, valid_to, max_uses,
                  used_count, applies_to, revoked_at, revoke_reason
           from aarogyam.promo_codes
           where source_code_id = $1 and source_patient_id = $2 for update"#,
        source_code_id,
        source_patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Opens a savepoint (minting a reward must never fail the issue around it).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn savepoint(conn: &mut PgConnection) -> Result<(), DbError> {
    sqlx::query("savepoint promo_reward").execute(conn).await?;
    Ok(())
}

/// Releases a savepoint.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn release(conn: &mut PgConnection) -> Result<(), DbError> {
    sqlx::query("release savepoint promo_reward")
        .execute(conn)
        .await?;
    Ok(())
}

/// Rolls back to a savepoint.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn rollback_to(conn: &mut PgConnection) -> Result<(), DbError> {
    sqlx::query("rollback to savepoint promo_reward")
        .execute(conn)
        .await?;
    Ok(())
}

/// One clinic's count of released holds.
#[derive(Debug, Clone, Copy)]
pub struct Released {
    /// The clinic.
    pub org_id: Uuid,
    /// Holds released.
    pub released: i32,
}

/// Releases holds on drafts left past their code's last day + 7 (`app.promo_release_stale_holds`,
/// across clinics, as the system actor).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn release_stale_holds(pool: &PgPool, batch: i32) -> Result<Vec<Released>, DbError> {
    let rows = sqlx::query_as!(
        Released,
        r#"select org_id as "org_id!", released as "released!"
           from app.promo_release_stale_holds($1)"#,
        batch
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// A member's role.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn member_role(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<Option<Uuid>, DbError> {
    let role = sqlx::query_scalar!(
        "select role_id from aarogyam.memberships where id = $1",
        membership_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(role)
}

/// A bill's visit, if it has one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn invoice_encounter(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<Uuid>, DbError> {
    let encounter = sqlx::query_scalar!(
        "select encounter_id from aarogyam.invoices where id = $1",
        invoice_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(encounter.flatten())
}

/// A bill's live code use, as the bill shows it.
#[derive(Debug, Clone)]
pub struct BillPromoRow {
    /// The code.
    pub promo_code_id: Uuid,
    /// Its purpose.
    pub purpose: String,
    /// `held` or `final`.
    pub status: String,
    /// The discount.
    pub discount_paise: i64,
}

/// Reads a bill's live code use without locking (bill views).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn bill_promo(
    conn: &mut PgConnection,
    invoice_id: Uuid,
) -> Result<Option<BillPromoRow>, DbError> {
    let row = sqlx::query_as!(
        BillPromoRow,
        r#"select r.promo_code_id, c.purpose, r.status, r.discount_paise
           from aarogyam.promo_redemptions r
           join aarogyam.promo_codes c on c.org_id = r.org_id and c.id = r.promo_code_id
           where r.invoice_id = $1 and r.status <> 'reversed'"#,
        invoice_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}
