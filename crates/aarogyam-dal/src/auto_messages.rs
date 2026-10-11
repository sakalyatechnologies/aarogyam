//! What the automatic patient messages (BE7) need to know inside the clinic transaction that
//! causes them: the clinic's switches, which channel the patient can be reached on, the clinic's
//! website, and whether a visit already has a live link.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use uuid::Uuid;

/// The clinic's `auto_messages` object, as stored (empty when the clinic has no settings row).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn switches(conn: &mut PgConnection) -> Result<Value, DbError> {
    let value = sqlx::query_scalar!(
        r#"select auto_messages as "auto_messages!" from aarogyam.org_settings
           where org_id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(value.unwrap_or_else(|| Value::Object(serde_json::Map::new())))
}

/// Whether a message of `template_key` and `purpose` may go to the patient on `WhatsApp`: they
/// opted in, haven't opted out of `WhatsApp` for the purpose, have a phone, and the clinic has an
/// approved `WhatsApp` template for the key. Otherwise the message goes by email.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn whatsapp_ready(
    conn: &mut PgConnection,
    patient_id: Uuid,
    template_key: &str,
    purpose: &str,
) -> Result<bool, DbError> {
    let ready = sqlx::query_scalar!(
        r#"select (p.phone_e164 is not null
                   and exists (select 1 from aarogyam.contact_preferences c
                               where c.patient_id = p.id and c.channel = 'whatsapp'
                                 and c.whatsapp_opt_in_at is not null)
                   and not exists (select 1 from aarogyam.contact_preferences c
                                   where c.patient_id = p.id and c.channel = 'whatsapp'
                                     and c.category in ('all', $3) and c.opted_out)
                   and exists (select 1 from aarogyam.message_templates t
                               where t.key = $2 and t.channel = 'whatsapp'
                                 and t.status = 'approved')) as "ready!"
           from aarogyam.patients p where p.id = $1"#,
        patient_id,
        template_key,
        purpose
    )
    .fetch_optional(conn)
    .await?;
    Ok(ready.unwrap_or(false))
}

/// The address of the clinic's own website, when the owner connected a domain that verified.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn website_domain(conn: &mut PgConnection) -> Result<Option<String>, DbError> {
    let domain = sqlx::query_scalar!(
        r#"select custom_domain from aarogyam.clinic_websites
           where org_id = app.tenant_id() and domain_status = 'verified' and published"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(domain.flatten())
}

/// Whether the visit has a link to it that still works (not revoked, not expired).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn has_live_visit_link(
    conn: &mut PgConnection,
    encounter_id: Uuid,
) -> Result<bool, DbError> {
    let live = sqlx::query_scalar!(
        r#"select exists (select 1 from aarogyam.share_links
                          where resource = 'visit' and encounter_id = $1
                            and revoked_at is null and expires_at > now()) as "live!""#,
        encounter_id
    )
    .fetch_one(conn)
    .await?;
    Ok(live)
}

/// What the patient's record and preferences say about reaching them on a channel for a purpose,
/// as `app.message_dispatch` will check again when the message is due.
#[derive(Debug, Clone, Copy)]
pub struct Reach {
    /// Whether consent allows the purpose (`app.may_contact`).
    pub may_contact: bool,
    /// Whether the patient opted out of the channel for the purpose.
    pub opted_out: bool,
    /// Whether the record has an email address (or, for `WhatsApp`, a phone number).
    pub has_address: bool,
}

/// How reachable the patient is on `channel` (`email` or `whatsapp`) for `purpose`; `None` when
/// the patient isn't in the clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn reach(
    conn: &mut PgConnection,
    patient_id: Uuid,
    channel: &str,
    purpose: &str,
) -> Result<Option<Reach>, DbError> {
    let row = sqlx::query!(
        r#"select app.may_contact(p.org_id, p.id, $3) as "may_contact!",
                  exists (select 1 from aarogyam.contact_preferences c
                          where c.patient_id = p.id and c.channel = $2
                            and c.category in ('all', $3) and c.opted_out) as "opted_out!",
                  (case $2 when 'email' then p.email else p.phone_e164 end is not null)
                    as "has_address!"
           from aarogyam.patients p where p.id = $1 and p.deleted_at is null"#,
        patient_id,
        channel,
        purpose
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| Reach {
        may_contact: row.may_contact,
        opted_out: row.opted_out,
        has_address: row.has_address,
    }))
}

/// A message that is not queued to go but recorded as skipped, with the reason, so the clinic
/// can see why the patient got nothing (the message is skipped at once, as the worker would).
#[derive(Debug, Clone)]
pub struct SkippedMessage<'a> {
    /// Identifier (a version 7 UUID).
    pub id: Uuid,
    /// The patient.
    pub patient_id: Uuid,
    /// `email` or `whatsapp`.
    pub channel: &'a str,
    /// The message kind, which is also its template key.
    pub kind: &'a str,
    /// The consent purpose.
    pub purpose: &'a str,
    /// One of `aarogyam_domain::messaging::SkipReason`.
    pub reason: &'a str,
    /// Makes a repeat a no-op.
    pub dedupe_key: &'a str,
}

/// Records a skipped message; false when the dedupe key was used before.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn record_skipped(
    conn: &mut PgConnection,
    message: &SkippedMessage<'_>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.messages (id, patient_id, channel, kind, purpose, template_key,
                                          status, skip_reason, processed_at, dedupe_key)
           values ($1, $2, $3, $4, $5, $4, 'skipped', $6, now(), $7)
           on conflict (org_id, dedupe_key) do nothing"#,
        message.id,
        message.patient_id,
        message.channel,
        message.kind,
        message.purpose,
        message.reason,
        message.dedupe_key
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Skips the follow-up booking message still queued for a recall's visit (`follow_up_resolved`);
/// returns how many. A message already sent or skipped is left as it is.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn cancel_follow_up_of_recall(
    conn: &mut PgConnection,
    recall_id: Uuid,
) -> Result<u64, DbError> {
    let result = sqlx::query!(
        r#"update aarogyam.messages m
             set status = 'skipped', skip_reason = 'follow_up_resolved', processed_at = now(),
                 secret = null
           from aarogyam.recalls r
           where r.id = $1 and r.source_encounter_id is not null
             and m.dedupe_key = 'auto:follow_up:' || r.source_encounter_id::text
             and m.status = 'queued'"#,
        recall_id
    )
    .execute(conn)
    .await?;
    Ok(result.rows_affected())
}

/// Skips the follow-up booking messages still queued for a patient who just booked
/// (`follow_up_resolved`); returns how many.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn cancel_follow_ups_of_patient(
    conn: &mut PgConnection,
    patient_id: Uuid,
) -> Result<u64, DbError> {
    let result = sqlx::query!(
        r#"update aarogyam.messages
             set status = 'skipped', skip_reason = 'follow_up_resolved', processed_at = now(),
                 secret = null
           where patient_id = $1 and kind = 'visit.follow_up_booking' and status = 'queued'"#,
        patient_id
    )
    .execute(conn)
    .await?;
    Ok(result.rows_affected())
}
