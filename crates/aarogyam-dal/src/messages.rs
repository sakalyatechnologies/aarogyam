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
}

/// Queues a message in the current clinic transaction; false when its dedupe key was queued
/// before (nothing changes).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn enqueue(conn: &mut PgConnection, message: &NewMessage<'_>) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.messages (id, patient_id, channel, kind, purpose, template_key,
                                          variables, body, secret, appointment_id, dedupe_key)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        message.dedupe_key
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
    /// Copies queued now; the rest were queued by an earlier try of the same batch.
    pub queued: i64,
}

/// Queues one copy per patient in one statement, all or none: when a patient isn't in the
/// clinic or in reach, nothing is queued and `found` says fewer than asked.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn enqueue_batch(conn: &mut PgConnection, batch: &Batch<'_>) -> Result<Queued, DbError> {
    let row = sqlx::query_as!(
        Queued,
        r#"with found as (
             select p.id from aarogyam.patients p
             where p.id = any($1::uuid[]) and p.deleted_at is null
               and app.patient_in_reach(p.id, $2)
           ),
           queued as (
             insert into aarogyam.messages (patient_id, channel, kind, purpose, template_key,
                                            variables, body, dedupe_key)
             select f.id, $3, 'clinic.message', $4, $5, $6, $7,
                    'manual:' || $8::uuid::text || ':' || f.id::text
             from found f
             where (select count(*) from found) = cardinality($1::uuid[])
             on conflict (org_id, dedupe_key) do nothing
             returning 1
           )
           select (select count(*) from found) as "found!", (select count(*) from queued) as "queued!""#,
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
