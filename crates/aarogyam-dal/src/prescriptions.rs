//! Prescriptions, the medicine catalogue, safety alerts and patient links. Clinic queries take
//! the connection of an open clinic transaction, so row-level security limits them to that
//! clinic.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// A medicine in the shared catalogue.
#[derive(Debug, Clone)]
pub struct DrugRow {
    /// Identifier.
    pub id: Uuid,
    /// Generic name.
    pub generic_name: String,
    /// Brand, when listed.
    pub brand_name: Option<String>,
    /// Strength, such as `500 mg`.
    pub strength: String,
    /// Form, such as `tablet`.
    pub form: String,
    /// Usual dose.
    pub default_dose: String,
    /// Usual frequency, such as `1-0-1`.
    pub default_frequency: String,
    /// Usual timing.
    pub default_timing: Option<String>,
    /// Usual duration.
    pub default_duration_days: Option<i16>,
    /// Classes for the allergy check.
    pub allergy_classes: Vec<String>,
}

/// Medicines whose name or strength contains every word of `needle` (lower case), names
/// starting with its first word first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn search_drugs(
    conn: &mut PgConnection,
    needle: &str,
    limit: i64,
) -> Result<Vec<DrugRow>, DbError> {
    let escape = |word: &str| {
        word.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    };
    let patterns: Vec<String> = needle
        .split_whitespace()
        .map(|w| format!("%{}%", escape(w)))
        .collect();
    let first = needle.split_whitespace().next().unwrap_or_default();
    let rows = sqlx::query_as!(
        DrugRow,
        r#"select id, generic_name, brand_name, strength, form, default_dose, default_frequency,
                  default_timing, default_duration_days, allergy_classes
           from aarogyam.drug_catalog
           where active and search_text like all ($1)
           order by (search_text ^@ $2) desc, generic_name, strength
           limit $3"#,
        &patterns as &[String],
        first,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Medicines by id.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn drugs(conn: &mut PgConnection, ids: &[Uuid]) -> Result<Vec<DrugRow>, DbError> {
    let rows = sqlx::query_as!(
        DrugRow,
        r#"select id, generic_name, brand_name, strength, form, default_dose, default_frequency,
                  default_timing, default_duration_days, allergy_classes
           from aarogyam.drug_catalog where id = any($1)"#,
        ids
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A prescription with its patient.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RxRow {
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
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// Diagnosis as written.
    pub diagnosis_text: Option<String>,
    /// Advice.
    pub advice: Option<String>,
    /// Follow-up date.
    #[serde(default, deserialize_with = "crate::json::optional_date")]
    pub follow_up_on: Option<Date>,
    /// Language of the instructions.
    pub language: String,
    /// `draft`, `issued` or `cancelled`.
    pub status: String,
    /// When issued.
    #[serde(default, deserialize_with = "crate::json::optional_timestamp")]
    pub issued_at: Option<OffsetDateTime>,
    /// Why alerts were overridden.
    pub override_reason: Option<String>,
    /// The QR's token.
    pub verify_token: Option<String>,
    /// Letterhead snapshot.
    pub letterhead: Option<Value>,
    /// Doctor snapshot.
    pub doctor: Option<Value>,
    /// Patient snapshot.
    pub recipient: Option<Value>,
    /// Footer.
    pub footer: Option<String>,
    /// Why it was cancelled.
    pub cancel_reason: Option<String>,
    /// When it was cancelled.
    #[serde(default, deserialize_with = "crate::json::optional_timestamp")]
    pub cancelled_at: Option<OffsetDateTime>,
    /// The prescription it replaces.
    pub supersedes_id: Option<Uuid>,
    /// The prescription that replaces it.
    pub superseded_by: Option<Uuid>,
    /// When the draft was started.
    #[serde(with = "crate::json::timestamp")]
    pub created_at: OffsetDateTime,
}

/// Which prescriptions to read.
#[derive(Debug, Clone, Copy, Default)]
pub struct RxFilter {
    /// One prescription.
    pub id: Option<Uuid>,
    /// One patient's.
    pub patient_id: Option<Uuid>,
    /// Only issued ones.
    pub issued_only: bool,
    /// Most rows.
    pub limit: i64,
}

/// Prescriptions matching `filter`, newest first (by issue, then start).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn prescriptions(
    conn: &mut PgConnection,
    filter: &RxFilter,
) -> Result<Vec<RxRow>, DbError> {
    let rows = sqlx::query_as!(
        RxRow,
        r#"select r.id, r.number, r.patient_id, p.full_name as patient_name, p.number as patient_number,
                  r.encounter_id, r.diagnosis_text, r.advice, r.follow_up_on, r.language, r.status,
                  r.issued_at, r.override_reason, r.verify_token, r.letterhead, r.doctor, r.recipient,
                  r.footer, r.cancel_reason, r.cancelled_at, r.supersedes_id,
                  (select n.id from aarogyam.prescriptions n
                   where n.org_id = r.org_id and n.supersedes_id = r.id and n.patient_id = r.patient_id) as superseded_by,
                  r.created_at
           from aarogyam.prescriptions r
           join aarogyam.patients p on p.org_id = r.org_id and p.id = r.patient_id
           where ($1::uuid is null or r.id = $1)
             and ($2::uuid is null or r.patient_id = $2)
             and (not $3 or r.status = 'issued')
           order by coalesce(r.issued_at, r.created_at) desc, r.id desc
           limit $4"#,
        filter.id,
        filter.patient_id,
        filter.issued_only,
        filter.limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A listed prescription with its medicines and alerts.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RxEntry {
    /// The prescription.
    #[serde(flatten)]
    pub row: RxRow,
    /// Its medicines in order.
    pub items: Vec<RxItemRow>,
    /// Its alerts, oldest first.
    pub alerts: Vec<AlertRow>,
}

/// A patient's prescriptions, newest first, each with its medicines and alerts, and whether the
/// patient is in this clinic: `None` when not. One statement instead of `2 + 2n`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_for_patient(
    conn: &mut PgConnection,
    patient_id: Uuid,
    issued_only: bool,
    limit: i64,
) -> Result<Option<Vec<RxEntry>>, DbError> {
    let row = sqlx::query!(
        r#"select exists (select 1 from aarogyam.patients where id = $1) as "found!",
                  coalesce((
                    select jsonb_agg(to_jsonb(t) order by coalesce(t.issued_at, t.created_at) desc, t.id desc)
                    from (select r.id, r.number, r.patient_id, p.full_name as patient_name,
                                 p.number as patient_number, r.encounter_id, r.diagnosis_text,
                                 r.advice, r.follow_up_on, r.language, r.status, r.issued_at,
                                 r.override_reason, r.verify_token, r.letterhead, r.doctor,
                                 r.recipient, r.footer, r.cancel_reason, r.cancelled_at,
                                 r.supersedes_id,
                                 (select n.id from aarogyam.prescriptions n
                                  where n.org_id = r.org_id and n.supersedes_id = r.id
                                    and n.patient_id = r.patient_id) as superseded_by,
                                 r.created_at,
                                 coalesce((select jsonb_agg(to_jsonb(i) order by i.line_no)
                                           from (select x.id, x.line_no, x.drug_id, x.drug_name,
                                                        x.strength, x.form, x.dose, x.frequency,
                                                        x.timing, x.duration_days, x.instructions
                                                 from aarogyam.prescription_items x
                                                 where x.prescription_id = r.id) i),
                                          '[]'::jsonb) as items,
                                 coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id)
                                           from (select y.id, y.created_at, y.prescription_item_id,
                                                        y.kind, y.severity, y.message, y.action,
                                                        y.override_reason
                                                 from aarogyam.prescription_alerts y
                                                 where y.prescription_id = r.id) a),
                                          '[]'::jsonb) as alerts
                          from aarogyam.prescriptions r
                          join aarogyam.patients p on p.org_id = r.org_id and p.id = r.patient_id
                          where r.patient_id = $1 and (not $2 or r.status = 'issued')
                          order by coalesce(r.issued_at, r.created_at) desc, r.id desc
                          limit $3) t
                  ), '[]'::jsonb) as "rows!: sqlx::types::Json<Vec<RxEntry>>""#,
        patient_id,
        issued_only,
        limit
    )
    .fetch_one(conn)
    .await?;
    Ok(row.found.then_some(row.rows.0))
}

/// A prescription's header values.
#[derive(Debug, Clone)]
pub struct RxHeader<'a> {
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// Diagnosis.
    pub diagnosis_text: Option<&'a str>,
    /// Advice.
    pub advice: Option<&'a str>,
    /// Follow-up date.
    pub follow_up_on: Option<Date>,
    /// Language.
    pub language: &'a str,
}

/// Starts a draft.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert(
    conn: &mut PgConnection,
    id: Uuid,
    patient_id: Uuid,
    supersedes_id: Option<Uuid>,
    header: &RxHeader<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.prescriptions
             (id, patient_id, supersedes_id, encounter_id, diagnosis_text, advice, follow_up_on, language)
           values ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        id,
        patient_id,
        supersedes_id,
        header.encounter_id,
        header.diagnosis_text,
        header.advice,
        header.follow_up_on,
        header.language
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
    header: &RxHeader<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.prescriptions
           set encounter_id = $2, diagnosis_text = $3, advice = $4, follow_up_on = $5, language = $6
           where id = $1 and status = 'draft'"#,
        id,
        header.encounter_id,
        header.diagnosis_text,
        header.advice,
        header.follow_up_on,
        header.language
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A medicine on a prescription.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RxItemRow {
    /// Identifier.
    pub id: Uuid,
    /// Position.
    pub line_no: i16,
    /// The catalogue entry.
    pub drug_id: Option<Uuid>,
    /// As printed.
    pub drug_name: String,
    /// Strength.
    pub strength: Option<String>,
    /// Form.
    pub form: Option<String>,
    /// Dose.
    pub dose: String,
    /// Frequency.
    pub frequency: String,
    /// Timing.
    pub timing: Option<String>,
    /// Days.
    pub duration_days: Option<i16>,
    /// Instructions.
    pub instructions: Option<String>,
}

/// A prescription's medicines in order.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn items(
    conn: &mut PgConnection,
    prescription_id: Uuid,
) -> Result<Vec<RxItemRow>, DbError> {
    let rows = sqlx::query_as!(
        RxItemRow,
        r#"select id, line_no, drug_id, drug_name, strength, form, dose, frequency, timing,
                  duration_days, instructions
           from aarogyam.prescription_items where prescription_id = $1 order by line_no"#,
        prescription_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// Adds a medicine to a draft.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_item(
    conn: &mut PgConnection,
    prescription_id: Uuid,
    item: &RxItemRow,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.prescription_items
             (id, prescription_id, line_no, drug_id, drug_name, strength, form, dose, frequency, timing,
              duration_days, instructions)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)"#,
        item.id,
        prescription_id,
        item.line_no,
        item.drug_id,
        item.drug_name,
        item.strength,
        item.form,
        item.dose,
        item.frequency,
        item.timing,
        item.duration_days,
        item.instructions
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Removes a draft's medicines (`app.clear_draft_prescription_lines`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clear_draft_lines(
    conn: &mut PgConnection,
    prescription_id: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        "select app.clear_draft_prescription_lines($1) as cleared",
        prescription_id
    )
    .fetch_one(conn)
    .await?;
    Ok(())
}

/// Locks a prescription; returns its status and patient.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn lock(conn: &mut PgConnection, id: Uuid) -> Result<Option<(String, Uuid)>, DbError> {
    let row = sqlx::query!(
        "select status, patient_id from aarogyam.prescriptions where id = $1 for update",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.status, row.patient_id)))
}

/// What issuing writes.
#[derive(Debug, Clone)]
pub struct IssuedRx<'a> {
    /// The number.
    pub number: &'a str,
    /// When.
    pub issued_at: OffsetDateTime,
    /// By whom (membership).
    pub issued_by: Uuid,
    /// Why alerts were overridden.
    pub override_reason: Option<&'a str>,
    /// The QR's token.
    pub verify_token: &'a str,
    /// Letterhead snapshot.
    pub letterhead: Value,
    /// Doctor snapshot.
    pub doctor: Value,
    /// Patient snapshot.
    pub recipient: Value,
    /// Footer.
    pub footer: Option<&'a str>,
}

/// Issues a draft.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn issue(
    conn: &mut PgConnection,
    id: Uuid,
    issued: &IssuedRx<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.prescriptions
           set status = 'issued', number = $2, issued_at = $3, issued_by = $4, override_reason = $5,
               verify_token = $6, letterhead = $7, doctor = $8, recipient = $9, footer = $10
           where id = $1 and status = 'draft'"#,
        id,
        issued.number,
        issued.issued_at,
        issued.issued_by,
        issued.override_reason,
        issued.verify_token,
        issued.letterhead,
        issued.doctor,
        issued.recipient,
        issued.footer
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Cancels an issued prescription.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn cancel(
    conn: &mut PgConnection,
    id: Uuid,
    reason: &str,
    at: OffsetDateTime,
    by: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.prescriptions
           set status = 'cancelled', cancel_reason = $2, cancelled_at = $3, cancelled_by = $4
           where id = $1 and status = 'issued'"#,
        id,
        reason,
        at,
        by
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A safety alert as stored.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AlertRow {
    /// The medicine it concerns.
    pub prescription_item_id: Option<Uuid>,
    /// `allergy`, …
    pub kind: String,
    /// `info`, `caution` or `serious`.
    pub severity: String,
    /// What the doctor was told.
    pub message: String,
    /// `overridden`, …
    pub action: String,
    /// The doctor's reason.
    pub override_reason: Option<String>,
}

/// Records an alert the doctor overrode.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_alert(
    conn: &mut PgConnection,
    prescription_id: Uuid,
    alert: &AlertRow,
    acted_by: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.prescription_alerts
             (prescription_id, prescription_item_id, kind, severity, message, source, action,
              override_reason, acted_by)
           values ($1, $2, $3, $4, $5, 'allergy_record', $6, $7, $8)"#,
        prescription_id,
        alert.prescription_item_id,
        alert.kind,
        alert.severity,
        alert.message,
        alert.action,
        alert.override_reason,
        acted_by
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A prescription's recorded alerts.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn alerts(
    conn: &mut PgConnection,
    prescription_id: Uuid,
) -> Result<Vec<AlertRow>, DbError> {
    let rows = sqlx::query_as!(
        AlertRow,
        r#"select prescription_item_id, kind, severity, message, action, override_reason
           from aarogyam.prescription_alerts where prescription_id = $1 order by created_at, id"#,
        prescription_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A member's name and registration number as a doctor: from their practitioner record, else
/// their display name and the clinic's prescription settings (`registration_numbers`, keyed by
/// membership).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn doctor(
    conn: &mut PgConnection,
    membership_id: Uuid,
) -> Result<Option<(String, Option<String>)>, DbError> {
    let row = sqlx::query!(
        r#"select coalesce(pr.display_name, u.display_name) as "display_name!",
                  coalesce(pr.registration_number,
                           s.prescription -> 'registration_numbers' ->> m.id::text) as registration_number
           from aarogyam.memberships m
           join aarogyam.users u on u.id = m.user_id
           left join aarogyam.practitioners pr
             on pr.org_id = m.org_id and pr.membership_id = m.id and pr.deleted_at is null
           left join aarogyam.org_settings s on s.org_id = m.org_id
           where m.id = $1"#,
        membership_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.display_name, row.registration_number)))
}

/// What the QR page shows: no patient data.
#[derive(Debug, Clone)]
pub struct VerifyRow {
    /// `issued` or `cancelled`.
    pub status: String,
    /// When issued.
    pub issued_at: Option<OffsetDateTime>,
    /// The number.
    pub number: Option<String>,
}

/// The prescription with this verify token in the current clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn verify(conn: &mut PgConnection, token: &str) -> Result<Option<VerifyRow>, DbError> {
    let row = sqlx::query_as!(
        VerifyRow,
        r#"select status, issued_at, number from aarogyam.prescriptions
           where verify_token = $1 and status <> 'draft'"#,
        token
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A new patient link.
#[derive(Debug, Clone)]
pub struct NewShareLink<'a> {
    /// Identifier.
    pub id: Uuid,
    /// SHA-256 of the token.
    pub token_hash: &'a str,
    /// SHA-256 of the token and PIN.
    pub pin_hash: &'a str,
    /// The prescription.
    pub prescription_id: Uuid,
    /// Its patient.
    pub patient_id: Uuid,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
}

/// Records a patient link to a prescription.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_share_link(
    conn: &mut PgConnection,
    link: &NewShareLink<'_>,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"insert into aarogyam.share_links
             (id, token_hash, pin_hash, resource, prescription_id, patient_id, channel, expires_at)
           values ($1, $2, $3, 'prescription', $4, $5, 'whatsapp', $6)"#,
        link.id,
        link.token_hash,
        link.pin_hash,
        link.prescription_id,
        link.patient_id,
        link.expires_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// A patient link as stored.
#[derive(Debug, Clone)]
pub struct ShareLinkRow {
    /// Identifier.
    pub id: Uuid,
    /// SHA-256 of the token and PIN.
    pub pin_hash: String,
    /// `prescription`, …
    pub resource: String,
    /// The prescription.
    pub prescription_id: Option<Uuid>,
    /// Its patient.
    pub patient_id: Uuid,
    /// Wrong PINs so far.
    pub failed_attempts: i32,
    /// When it locked.
    pub locked_at: Option<OffsetDateTime>,
    /// When it stops working.
    pub expires_at: OffsetDateTime,
    /// When the clinic revoked it.
    pub revoked_at: Option<OffsetDateTime>,
}

/// The link with this token hash in the current clinic, locked when `for_update`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn share_link(
    conn: &mut PgConnection,
    token_hash: &str,
) -> Result<Option<ShareLinkRow>, DbError> {
    let row = sqlx::query_as!(
        ShareLinkRow,
        r#"select id, pin_hash, resource, prescription_id, patient_id, failed_attempts, locked_at,
                  expires_at, revoked_at
           from aarogyam.share_links where token_hash = $1
           for update"#,
        token_hash
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Counts a wrong PIN, locking the link at `lock`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn share_link_failed(
    conn: &mut PgConnection,
    id: Uuid,
    attempts: i32,
    locked_at: Option<OffsetDateTime>,
) -> Result<(), DbError> {
    sqlx::query!(
        "update aarogyam.share_links set failed_attempts = $2, locked_at = $3 where id = $1",
        id,
        attempts,
        locked_at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Counts an open.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn share_link_opened(
    conn: &mut PgConnection,
    id: Uuid,
    at: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.share_links
           set open_count = open_count + 1, opened_at = coalesce(opened_at, $2)
           where id = $1"#,
        id,
        at
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// The current clinic's display name and time zone.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn clinic_name(conn: &mut PgConnection) -> Result<Option<(String, String)>, DbError> {
    let row = sqlx::query!(
        "select name, timezone from aarogyam.organizations where id = app.tenant_id()"
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.name, row.timezone)))
}

/// A recorded allergy, as the prescription check reads it.
#[derive(Debug, Clone)]
pub struct AllergyRow {
    /// What the patient reacts to.
    pub substance: String,
    /// `mild`, `moderate` or `severe`.
    pub severity: String,
}

/// The patient's active allergies (`aarogyam.allergies`).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn active_allergies(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<Vec<AllergyRow>, DbError> {
    let rows = sqlx::query_as!(
        AllergyRow,
        r#"select substance, severity from aarogyam.allergies
           where patient_id = $1 and status = 'active'
           order by created_at, id"#,
        patient_id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod entry_tests {
    use super::RxEntry;

    #[test]
    fn reads_a_listed_prescription() {
        let json = serde_json::json!({
            "id": "0198a000-0000-7000-8000-000000000001", "number": "RX-1",
            "patient_id": "0198a000-0000-7000-8000-000000000002", "patient_name": "A",
            "patient_number": "SC-1", "encounter_id": null, "diagnosis_text": null,
            "advice": null, "follow_up_on": null, "language": "en", "status": "issued",
            "issued_at": "2026-10-06T02:30:00.123456+00:00", "override_reason": null,
            "verify_token": "t", "letterhead": {"a": 1}, "doctor": {"b": 2}, "recipient": {},
            "footer": null, "cancel_reason": null, "cancelled_at": null, "supersedes_id": null,
            "superseded_by": null, "created_at": "2026-10-06T02:30:00+00:00",
            "items": [{"id": "0198a000-0000-7000-8000-000000000003", "line_no": 1, "drug_id": null,
                       "drug_name": "X", "strength": null, "form": null, "dose": "1",
                       "frequency": "1-1-1", "timing": null, "duration_days": 3,
                       "instructions": null}],
            "alerts": [{"id": "0198a000-0000-7000-8000-000000000004", "created_at": "2026-10-06T02:30:00+00:00",
                        "prescription_item_id": null, "kind": "allergy", "severity": "info",
                        "message": "m", "action": "overridden", "override_reason": null}]
        });
        let mut dated = json.clone();
        dated["follow_up_on"] = "2026-10-12".into();
        let entry: RxEntry = serde_json::from_value(json).unwrap();
        assert_eq!(entry.items.len(), 1);
        assert!(entry.row.follow_up_on.is_none());
        let entry: RxEntry = serde_json::from_value(dated).unwrap();
        assert!(entry.row.follow_up_on.is_some());
    }
}
