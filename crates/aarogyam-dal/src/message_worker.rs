//! The patient message worker's queries, across clinics on the API's own connection, through
//! the definer functions of migrations 0371 to 0373. It never reads `patients` itself:
//! [`dispatch`] reports everything a send needs.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// A due message the claim returned.
#[derive(Debug, Clone, Copy)]
pub struct ClaimedMessage {
    /// Its clinic.
    pub org_id: Uuid,
    /// The message.
    pub id: Uuid,
    /// Attempts so far, this one included.
    pub attempts: i32,
    /// True when the daily budget was spent and the message moved to tomorrow instead.
    pub deferred: bool,
}

/// Claims up to `limit` due messages on `channel` for `provider`, within `daily_budget` sends a
/// day for that provider across the platform. With `campaigns_enabled` false (the platform kill
/// switch) campaign messages stay queued.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn claim(
    pool: &PgPool,
    channel: &str,
    provider: &str,
    daily_budget: i32,
    limit: i32,
    lease_seconds: i32,
    campaigns_enabled: bool,
) -> Result<Vec<ClaimedMessage>, DbError> {
    let rows = sqlx::query_as!(
        ClaimedMessage,
        r#"select org_id as "org_id!", id as "id!", attempts as "attempts!", deferred as "deferred!"
           from app.messages_claim($1, $2, $3, $4, $5, $6)"#,
        channel,
        provider,
        daily_budget,
        limit,
        lease_seconds,
        campaigns_enabled
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// What a send needs, read when the message is due (`app.message_dispatch`).
#[derive(Clone)]
pub struct Dispatch {
    /// `sending` while claimed.
    pub status: String,
    /// The channel.
    pub channel: String,
    /// What it is about.
    pub kind: String,
    /// The consent purpose it needs.
    pub purpose: String,
    /// Its template.
    pub template_key: String,
    /// Template values stored with it.
    pub variables: Value,
    /// Free text, email only.
    pub body: Option<String>,
    /// A one-time link secret.
    pub secret: Option<String>,
    /// The patient's address on the channel, now.
    pub address: Option<String>,
    /// Whether consent allows its purpose now.
    pub may_contact: bool,
    /// Whether the patient opted out of the channel for its purpose.
    pub opted_out: bool,
    /// `active`, `erased`, `merged`, `deleted` or `deceased`.
    pub patient_state: String,
    /// When the clinic's quiet hours end, if they are on now.
    pub quiet_until: Option<OffsetDateTime>,
    /// The clinic's name.
    pub clinic_name: String,
    /// The clinic's time zone.
    pub timezone: String,
    /// The clinic's portal host, once it works.
    pub portal_host: Option<String>,
    /// For a reminder: the appointment's status.
    pub appointment_status: Option<String>,
    /// For a reminder: when the appointment starts.
    pub appointment_starts_at: Option<OffsetDateTime>,
    /// For a reminder: the doctor's name.
    pub doctor_name: Option<String>,
    /// Whether the patient opted in to `WhatsApp`.
    pub whatsapp_opted_in: bool,
    /// The clinic's template for the message on its channel: its status...
    pub template_status: Option<String>,
    /// ...its name at the provider (`WhatsApp`)...
    pub template_ref: Option<String>,
    /// ...language (`en-IN`)...
    pub template_language: Option<String>,
    /// ...category (`utility`, `marketing`, `authentication`)...
    pub template_category: Option<String>,
    /// ...and text, with `{{variables}}`.
    pub template_body: Option<String>,
}

impl std::fmt::Debug for Dispatch {
    /// Ids and states only: the address, text and secret stay out of logs.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Dispatch")
            .field("kind", &self.kind)
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}

/// Reads one message for sending; `None` when it doesn't exist in that clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn dispatch(pool: &PgPool, org_id: Uuid, id: Uuid) -> Result<Option<Dispatch>, DbError> {
    let row = sqlx::query_as!(
        Dispatch,
        r#"select status as "status!", channel as "channel!", kind as "kind!", purpose as "purpose!",
                  template_key as "template_key!", variables as "variables!", body, secret, address,
                  may_contact as "may_contact!", opted_out as "opted_out!",
                  patient_state as "patient_state!", quiet_until, clinic_name as "clinic_name!",
                  timezone as "timezone!", portal_host, appointment_status, appointment_starts_at,
                  doctor_name, whatsapp_opted_in as "whatsapp_opted_in!", template_status,
                  template_ref, template_language, template_category, template_body
           from app.message_dispatch($1, $2)"#,
        org_id,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Stores the hash of the unsubscribe token the email will carry.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_unsubscribe_hash(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    hash: &str,
) -> Result<(), DbError> {
    sqlx::query!(
        "select app.message_unsubscribe_hash($1, $2, $3)",
        org_id,
        id,
        hash
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Records a send.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_sent(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    provider: &str,
    provider_message_id: Option<&str>,
    cost_paise: Option<i64>,
) -> Result<(), DbError> {
    sqlx::query!(
        "select app.message_sent($1, $2, $3, $4, $5)",
        org_id,
        id,
        provider,
        provider_message_id,
        cost_paise
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Records that the message won't be sent, for `reason`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_skipped(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    reason: &str,
) -> Result<(), DbError> {
    sqlx::query!("select app.message_skipped($1, $2, $3)", org_id, id, reason)
        .execute(pool)
        .await?;
    Ok(())
}

/// Puts the message back until `at`; not counted as an attempt.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn reschedule(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    at: OffsetDateTime,
) -> Result<(), DbError> {
    sqlx::query!("select app.message_rescheduled($1, $2, $3)", org_id, id, at)
        .execute(pool)
        .await?;
    Ok(())
}

/// Records a failed attempt: retried at `retry_at`, or abandoned when it is `None`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_failed(
    pool: &PgPool,
    org_id: Uuid,
    id: Uuid,
    error: &str,
    retry_at: Option<OffsetDateTime>,
) -> Result<(), DbError> {
    sqlx::query!(
        "select app.message_failed($1, $2, $3, $4)",
        org_id,
        id,
        error,
        retry_at
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Queues reminders for appointments starting 1 to 26 hours after `now`; returns how many.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn queue_reminders(
    pool: &PgPool,
    now: OffsetDateTime,
    limit: i32,
) -> Result<i32, DbError> {
    let queued = sqlx::query_scalar!(
        r#"select app.queue_appointment_reminders($1, $2) as "queued!""#,
        now,
        limit
    )
    .fetch_one(pool)
    .await?;
    Ok(queued)
}

/// Applies an unsubscribe token's hash; false when it names no message.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn unsubscribe(pool: &PgPool, hash: &str) -> Result<bool, DbError> {
    let done = sqlx::query_scalar!(r#"select app.message_unsubscribe($1) as "done!""#, hash)
        .fetch_one(pool)
        .await?;
    Ok(done)
}

/// A provider's report about a message it sent.
#[derive(Debug, Clone, Copy)]
pub struct ProviderEvent<'a> {
    /// `resend`.
    pub provider: &'a str,
    /// The provider's id for the message.
    pub provider_message_id: &'a str,
    /// The provider's id for the event, so a repeat counts once.
    pub event_id: &'a str,
    /// `delivered`, `bounced`, `complained`...
    pub kind: &'a str,
    /// When it happened, by the provider.
    pub occurred_at: OffsetDateTime,
}

/// Records a provider event: `recorded`, `repeat` or `unknown`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn provider_event(pool: &PgPool, event: &ProviderEvent<'_>) -> Result<String, DbError> {
    let outcome = sqlx::query_scalar!(
        r#"select app.message_provider_event($1, $2, $3, $4, $5) as "outcome!""#,
        event.provider,
        event.provider_message_id,
        event.event_id,
        event.kind,
        event.occurred_at
    )
    .fetch_one(pool)
    .await?;
    Ok(outcome)
}

/// Records a `WhatsApp` status (`sent`, `delivered`, `read`, `failed`) of the message Meta knows
/// by `wamid`: `recorded`, `repeat` or `unknown`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn whatsapp_status(
    pool: &PgPool,
    wamid: &str,
    status: &str,
    occurred_at: OffsetDateTime,
) -> Result<String, DbError> {
    let outcome = sqlx::query_scalar!(
        r#"select app.whatsapp_status($1, $2, $3) as "outcome!""#,
        wamid,
        status,
        occurred_at
    )
    .fetch_one(pool)
    .await?;
    Ok(outcome)
}

/// Opts a phone (E.164) out of `WhatsApp` after a STOP reply, at the clinic the reply is for
/// (see migration 0377); returns how many clinics.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn whatsapp_stop(
    pool: &PgPool,
    phone_e164: &str,
    context_wamid: Option<&str>,
) -> Result<i32, DbError> {
    let clinics = sqlx::query_scalar!(
        r#"select app.whatsapp_stop($1, $2) as "clinics!""#,
        phone_e164,
        context_wamid
    )
    .fetch_one(pool)
    .await?;
    Ok(clinics)
}

/// Applies Meta's review of a template name and language to the clinic copies submitted for it;
/// returns how many changed.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn whatsapp_template_reviewed(
    pool: &PgPool,
    name: &str,
    language: &str,
    status: &str,
) -> Result<i32, DbError> {
    let changed = sqlx::query_scalar!(
        r#"select app.whatsapp_template_reviewed($1, $2, $3) as "changed!""#,
        name,
        language,
        status
    )
    .fetch_one(pool)
    .await?;
    Ok(changed)
}
