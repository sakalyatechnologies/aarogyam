//! Patient messages inside a clinic transaction (migration 0370): queuing, a patient's message
//! list, withdrawals and contact preferences. The worker's side, across clinics, is
//! [`crate::message_worker`].

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// A message to queue in the current clinic.
#[derive(Debug, Clone)]
pub struct NewMessage<'a> {
    /// Identifier chosen by the caller (a version 7 UUID).
    pub id: Uuid,
    /// The patient; the address is read when the message is sent.
    pub patient_id: Uuid,
    /// `email`, `whatsapp` or `sms`.
    pub channel: &'a str,
    /// What it is about, such as `prescription.shared`.
    pub kind: &'a str,
    /// The consent purpose it needs: `care`, `reminders` or `promotional`.
    pub purpose: &'a str,
    /// Its template.
    pub template_key: &'a str,
    /// Ids and non-patient values the template needs.
    pub variables: &'a Value,
    /// Free text, email only.
    pub body: Option<&'a str>,
    /// A one-time link secret, cleared once the message is processed.
    pub secret: Option<&'a str>,
    /// The appointment it is about.
    pub appointment_id: Option<Uuid>,
    /// Makes a repeat a no-op.
    pub dedupe_key: Option<&'a str>,
    /// When it is due; now when absent.
    pub scheduled_for: Option<OffsetDateTime>,
}

/// Queues a message in the current clinic transaction; false when its dedupe key was queued
/// before (nothing changes).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn enqueue(conn: &mut PgConnection, message: &NewMessage<'_>) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.messages (id, patient_id, channel, kind, purpose, template_key,
                                          variables, body, secret, appointment_id, dedupe_key,
                                          scheduled_for)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, now()))
           on conflict (org_id, dedupe_key) do nothing"#,
        message.id,
        message.patient_id,
        message.channel,
        message.kind,
        message.purpose,
        message.template_key,
        message.variables,
        message.body,
        message.secret,
        message.appointment_id,
        message.dedupe_key,
        message.scheduled_for
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// A message staff send to several patients at once.
#[derive(Debug, Clone)]
pub struct Batch<'a> {
    /// The patients, without repeats.
    pub patient_ids: &'a [Uuid],
    /// Limits the patients to the member's own (`app.patient_in_reach`); `None` for all.
    pub member: Option<Uuid>,
    /// `email`.
    pub channel: &'a str,
    /// The template's consent purpose.
    pub purpose: &'a str,
    /// The template.
    pub template_key: &'a str,
    /// Its checked variables.
    pub variables: &'a Value,
    /// Free text, email only.
    pub body: Option<&'a str>,
    /// The batch, in each copy's dedupe key `manual:<batch>:<patient>`.
    pub batch_id: Uuid,
}

/// What queuing a batch did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Queued {
    /// Patients found in the clinic and in reach.
    pub found: i64,
    /// Copies queued now.
    pub queued: i64,
    /// Patients with no address on the channel (the email column for `email`); not queued.
    pub no_address: i64,
    /// Patients with an address whom `app.may_contact` refuses for the purpose; not queued.
    pub no_consent: i64,
}

/// Queues one copy per reachable patient in one statement. All or none for who is in the clinic
/// and in reach: when one isn't, nothing is queued and `found` says fewer than asked. Patients
/// with no address or no consent are not queued but counted. Quiet hours are the worker's.
/// What is left of `found` after the three counts was queued by an earlier try of the batch.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn enqueue_batch(conn: &mut PgConnection, batch: &Batch<'_>) -> Result<Queued, DbError> {
    let row = sqlx::query_as!(
        Queued,
        r#"with found as (
             select p.id, p.org_id,
                    (case $3 when 'email' then p.email else p.phone_e164 end is not null)
                      as has_address
             from aarogyam.patients p
             where p.id = any($1::uuid[]) and p.deleted_at is null
               and app.patient_in_reach(p.id, $2)
           ),
           sortable as (
             select f.id, f.has_address,
                    f.has_address and app.may_contact(f.org_id, f.id, $4) as allowed
             from found f
           ),
           queued as (
             insert into aarogyam.messages (patient_id, channel, kind, purpose, template_key,
                                            variables, body, dedupe_key)
             select s.id, $3, 'clinic.message', $4, $5, $6, $7,
                    'manual:' || $8::uuid::text || ':' || s.id::text
             from sortable s
             where s.allowed
               and (select count(*) from found) = cardinality($1::uuid[])
             on conflict (org_id, dedupe_key) do nothing
             returning 1
           )
           select (select count(*) from found) as "found!",
                  (select count(*) from queued) as "queued!",
                  (select count(*) from sortable where not has_address) as "no_address!",
                  (select count(*) from sortable where has_address and not allowed) as "no_consent!""#,
        batch.patient_ids,
        batch.member,
        batch.channel,
        batch.purpose,
        batch.template_key,
        batch.variables,
        batch.body,
        batch.batch_id
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// A message as a patient's list shows it: metadata only, never the text, address or secret.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MessageRow {
    /// Identifier.
    pub id: Uuid,
    /// `email`, `whatsapp` or `sms`.
    pub channel: String,
    /// What it is about.
    pub kind: String,
    /// The consent purpose.
    pub purpose: String,
    /// Its template.
    pub template_key: String,
    /// `queued`, `sending`, `sent`, `failed` or `skipped`.
    pub status: String,
    /// Why it was skipped.
    pub skip_reason: Option<String>,
    /// When it is or was due.
    #[serde(with = "crate::json::timestamp")]
    pub scheduled_for: OffsetDateTime,
    /// When it was handed to the provider.
    #[serde(default, deserialize_with = "crate::json::optional_timestamp")]
    pub sent_at: Option<OffsetDateTime>,
    /// What the provider last reported.
    pub delivery: Option<String>,
    /// Delivery attempts.
    pub attempts: i32,
    /// When it was queued.
    #[serde(with = "crate::json::timestamp")]
    pub created_at: OffsetDateTime,
}

/// The patient's newest `limit` messages in one statement; `None` when the patient isn't in
/// the clinic or out of `member`'s reach.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn list_for_patient(
    conn: &mut PgConnection,
    patient_id: Uuid,
    member: Option<Uuid>,
    limit: i64,
) -> Result<Option<Vec<MessageRow>>, DbError> {
    let row = sqlx::query!(
        r#"with patient as (
             select p.id from aarogyam.patients p
             where p.id = $1 and p.deleted_at is null and app.patient_in_reach(p.id, $2)
           )
           select exists (select 1 from patient) as "found!",
                  coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc)
                            from (select m.id, m.channel, m.kind, m.purpose, m.template_key,
                                         m.status, m.skip_reason, m.scheduled_for, m.sent_at,
                                         m.delivery, m.attempts, m.created_at
                                  from aarogyam.messages m
                                  where m.patient_id in (select id from patient)
                                  order by m.created_at desc, m.id desc limit $3) r),
                           '[]'::jsonb) as "items!""#,
        patient_id,
        member,
        limit
    )
    .fetch_one(conn)
    .await?;
    if !row.found {
        return Ok(None);
    }
    let items = serde_json::from_value(row.items)
        .map_err(|error| DbError::from(sqlx::Error::Decode(Box::new(error))))?;
    Ok(Some(items))
}

/// Marks the patient's queued messages for `purpose` skipped with `reason`; returns how many.
/// Used when consent for the purpose is withdrawn.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn skip_queued(
    conn: &mut PgConnection,
    patient_id: Uuid,
    purpose: &str,
    reason: &str,
) -> Result<u64, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.messages
             set status = 'skipped', skip_reason = $3, processed_at = now(), secret = null
           where patient_id = $1 and purpose = $2 and status = 'queued'"#,
        patient_id,
        purpose,
        reason
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected())
}

/// One of a patient's contact preferences.
#[derive(Debug, Clone)]
pub struct PreferenceRow {
    /// `email`, `whatsapp` or `sms`.
    pub channel: String,
    /// `all`, `care`, `reminders` or `promotional`.
    pub category: String,
    /// Whether the patient opted out.
    pub opted_out: bool,
    /// Since when.
    pub opted_out_at: Option<OffsetDateTime>,
    /// When they opted in to `WhatsApp`.
    pub whatsapp_opt_in_at: Option<OffsetDateTime>,
    /// Who recorded it.
    pub source: String,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// A preference to record.
#[derive(Debug, Clone, Copy)]
pub struct SetPreference<'a> {
    /// The patient.
    pub patient_id: Uuid,
    /// The channel.
    pub channel: &'a str,
    /// The category.
    pub category: &'a str,
    /// Opt out (true) or back in (false).
    pub opted_out: bool,
    /// For `WhatsApp`: opted in (true), not (false), or unchanged.
    pub whatsapp_opt_in: Option<bool>,
    /// Who recorded it.
    pub source: &'a str,
}

/// Records a preference for a patient in the clinic and `member`'s reach, skips their queued
/// messages it opts out of, and returns all their preferences; `None` when the patient isn't
/// found. One statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_preference(
    conn: &mut PgConnection,
    member: Option<Uuid>,
    set: &SetPreference<'_>,
) -> Result<Option<Vec<PreferenceRow>>, DbError> {
    let rows = sqlx::query_as!(
        PreferenceRow,
        r#"with patient as (
             select p.id from aarogyam.patients p
             where p.id = $1 and p.deleted_at is null and app.patient_in_reach(p.id, $2)
           ),
           saved as (
             insert into aarogyam.contact_preferences (patient_id, channel, category, opted_out,
                                                       opted_out_at, whatsapp_opt_in_at, source)
             select id, $3, $4, $5, case when $5 then now() end,
                    case when $6 then now() end, $7 from patient
             on conflict (org_id, patient_id, channel, category) do update
               set opted_out = excluded.opted_out,
                   opted_out_at = case when excluded.opted_out
                     then coalesce(aarogyam.contact_preferences.opted_out_at, now()) end,
                   whatsapp_opt_in_at = case when $6::boolean is null
                     then aarogyam.contact_preferences.whatsapp_opt_in_at
                     when $6 then coalesce(aarogyam.contact_preferences.whatsapp_opt_in_at, now())
                     end,
                   source = excluded.source
             returning patient_id, channel, category, opted_out, opted_out_at, whatsapp_opt_in_at,
                       source, updated_at
           ),
           skipped as (
             update aarogyam.messages m
               set status = 'skipped', skip_reason = 'opted_out', processed_at = now(), secret = null
             from saved s
             where s.opted_out and m.patient_id = s.patient_id and m.channel = s.channel
               and m.status = 'queued' and (s.category = 'all' or m.purpose = s.category)
             returning 1
           )
           select s.channel as "channel!", s.category as "category!", s.opted_out as "opted_out!",
                  s.opted_out_at, s.whatsapp_opt_in_at, s.source as "source!",
                  s.updated_at as "updated_at!"
           from saved s
           union all
           select c.channel, c.category, c.opted_out, c.opted_out_at, c.whatsapp_opt_in_at,
                  c.source, c.updated_at
           from aarogyam.contact_preferences c
           where c.patient_id in (select id from patient)
             and (c.channel, c.category) <> ($3, $4)
           order by 1, 2"#,
        set.patient_id,
        member,
        set.channel,
        set.category,
        set.opted_out,
        set.whatsapp_opt_in,
        set.source
    )
    .fetch_all(conn)
    .await?;
    // The patient always has the row just saved, so no rows means no patient.
    Ok((!rows.is_empty()).then_some(rows))
}

/// One channel's numbers since the start of a month.
#[derive(Debug, Clone)]
pub struct ChannelStatsRow {
    /// `email`, `whatsapp` or `sms`.
    pub channel: String,
    /// The start of the month, in the clinic's time zone.
    pub since: OffsetDateTime,
    /// Messages handed to the provider.
    pub sent: i64,
    /// Of those, reported delivered (or read) by the provider.
    pub delivered: i64,
    /// Messages that failed for good, or bounced.
    pub failed: i64,
    /// Messages skipped (no consent, opted out, no address...).
    pub skipped: i64,
    /// Patients who opted out of the channel in the month.
    pub opt_outs: i64,
}

/// The numbers for messages queued, and opt-outs recorded, since the start of the month `now`
/// falls in, by the clinic's calendar: one row per channel, always all three, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn stats(
    conn: &mut PgConnection,
    now: OffsetDateTime,
    timezone: &str,
) -> Result<Vec<ChannelStatsRow>, DbError> {
    let rows = sqlx::query_as!(
        ChannelStatsRow,
        r#"with b as (select date_trunc('month', $1::timestamptz, $2::text) as since),
           ch(channel) as (values ('email'), ('sms'), ('whatsapp')),
           m as (
             select m.channel,
                    count(*) filter (where m.status = 'sent') as sent,
                    count(*) filter (where m.delivery in ('delivered', 'read')) as delivered,
                    count(*) filter (where m.status = 'failed'
                                        or m.delivery in ('bounced', 'failed')) as failed,
                    count(*) filter (where m.status = 'skipped') as skipped
             from aarogyam.messages m, b
             where m.created_at >= b.since
             group by m.channel
           ), o as (
             select p.channel, count(distinct p.patient_id) as opt_outs
             from aarogyam.contact_preferences p, b
             where p.opted_out and p.opted_out_at >= b.since
             group by p.channel
           )
           select ch.channel as "channel!", b.since as "since!",
                  coalesce(m.sent, 0) as "sent!", coalesce(m.delivered, 0) as "delivered!",
                  coalesce(m.failed, 0) as "failed!", coalesce(m.skipped, 0) as "skipped!",
                  coalesce(o.opt_outs, 0) as "opt_outs!"
           from ch cross join b
           left join m on m.channel = ch.channel
           left join o on o.channel = ch.channel
           order by ch.channel"#,
        now,
        timezone
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}
