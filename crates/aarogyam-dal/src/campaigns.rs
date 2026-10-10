//! Audiences and campaigns (migrations 0380 to 0383) inside a clinic transaction, and the
//! worker's fan-out step across clinics. Counts are `group by status, skip_reason` over the
//! campaign's messages: nothing is stored.

use sakalya_db::DbError;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

/// A saved audience.
#[derive(Debug, Clone)]
pub struct AudienceRow {
    /// Identifier.
    pub id: Uuid,
    /// Its name.
    pub name: String,
    /// Its filter, as `AudienceFilter::to_json` wrote it.
    pub filter: Value,
    /// When it was made.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
}

/// The clinic's audiences, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn audiences(conn: &mut PgConnection) -> Result<Vec<AudienceRow>, DbError> {
    let rows = sqlx::query_as!(
        AudienceRow,
        "select id, name, filter, created_at, updated_at from aarogyam.audiences
         order by created_at desc, id desc limit 200"
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One audience; `None` when it isn't the clinic's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn audience(conn: &mut PgConnection, id: Uuid) -> Result<Option<AudienceRow>, DbError> {
    let row = sqlx::query_as!(
        AudienceRow,
        "select id, name, filter, created_at, updated_at from aarogyam.audiences where id = $1",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Saves an audience.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn create_audience(
    conn: &mut PgConnection,
    id: Uuid,
    name: &str,
    filter: &Value,
) -> Result<AudienceRow, DbError> {
    let row = sqlx::query_as!(
        AudienceRow,
        "insert into aarogyam.audiences (id, name, filter) values ($1, $2, $3)
         returning id, name, filter, created_at, updated_at",
        id,
        name,
        filter
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Changes an audience's name and/or filter (absent fields stay), unless a scheduled or sending
/// campaign uses it and the filter would change. `None` when it isn't the clinic's; the flag is
/// false when the change was refused for that reason.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_audience(
    conn: &mut PgConnection,
    id: Uuid,
    name: Option<&str>,
    filter: Option<&Value>,
) -> Result<Option<(bool, AudienceRow)>, DbError> {
    let row = sqlx::query!(
        r#"with locked as (
             select a.id from aarogyam.audiences a where a.id = $1 for update
           ),
           busy as (
             select exists (select 1 from aarogyam.campaigns c
                            where c.audience_id = $1 and c.status in ('scheduled', 'sending')) as yes
           ),
           changed as (
             update aarogyam.audiences a
               set name = coalesce($2, a.name), filter = coalesce($3, a.filter)
             where a.id = $1 and not ((select yes from busy) and $3::jsonb is not null)
             returning a.id
           )
           select (select count(*) from locked) as "found!", (select count(*) from changed) as "changed!""#,
        id,
        name,
        filter
    )
    .fetch_one(&mut *conn)
    .await?;
    if row.found == 0 {
        return Ok(None);
    }
    let Some(current) = audience(conn, id).await? else {
        return Ok(None);
    };
    Ok(Some((row.changed > 0, current)))
}

/// Deletes an audience no campaign uses: `Some(true)` when deleted, `Some(false)` when a
/// campaign uses it, `None` when it isn't the clinic's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete_audience(conn: &mut PgConnection, id: Uuid) -> Result<Option<bool>, DbError> {
    let row = sqlx::query!(
        r#"with used as (
             select exists (select 1 from aarogyam.campaigns c where c.audience_id = $1) as yes
           ),
           gone as (
             delete from aarogyam.audiences a where a.id = $1 and not (select yes from used)
             returning 1
           )
           select exists (select 1 from aarogyam.audiences where id = $1) as "found!",
                  (select count(*) from gone) as "gone!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok(row.found.then_some(row.gone > 0))
}

/// How many active patients a filter matches in the clinic now, never who.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn count(conn: &mut PgConnection, filter: &Value) -> Result<i64, DbError> {
    let count = sqlx::query_scalar!(
        r#"select count(*) as "count!" from app.audience_patients(app.tenant_id(), $1)"#,
        filter
    )
    .fetch_one(conn)
    .await?;
    Ok(count)
}

/// A campaign with its counts.
#[derive(Debug, Clone)]
pub struct CampaignRow {
    /// Identifier.
    pub id: Uuid,
    /// Its name (also the email subject).
    pub name: String,
    /// Its audience.
    pub audience_id: Uuid,
    /// Its template.
    pub template_id: Uuid,
    /// `email` or `whatsapp`.
    pub channel: String,
    /// The offer text.
    pub offer_text: String,
    /// When it is due.
    pub scheduled_at: Option<OffsetDateTime>,
    /// `draft`, `scheduled`, `sending`, `sent` or `cancelled`.
    pub status: String,
    /// The audience size the owner saw when scheduling.
    pub scheduled_count: Option<i32>,
    /// When recipients began to be queued.
    pub fan_out_started_at: Option<OffsetDateTime>,
    /// When the last recipient was queued.
    pub fan_out_done_at: Option<OffsetDateTime>,
    /// When it was cancelled.
    pub cancelled_at: Option<OffsetDateTime>,
    /// Who made it.
    pub created_by: Option<Uuid>,
    /// When it was made.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
    /// `[{status, skip_reason, count}]` from the campaign's messages.
    pub counts: Value,
}

/// The clinic's campaigns with counts, newest first.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn campaigns(conn: &mut PgConnection) -> Result<Vec<CampaignRow>, DbError> {
    let rows = sqlx::query_as!(
        CampaignRow,
        r#"select c.id, c.name, c.audience_id, c.template_id, c.channel, c.offer_text,
                  c.scheduled_at, c.status, c.scheduled_count, c.fan_out_started_at,
                  c.fan_out_done_at, c.cancelled_at, c.created_by, c.created_at, c.updated_at,
                  coalesce((select jsonb_agg(jsonb_build_object('status', g.status,
                                  'skip_reason', g.skip_reason, 'count', g.n)
                                  order by g.status, g.skip_reason)
                            from (select m.status, m.skip_reason, count(*) as n
                                  from aarogyam.messages m where m.campaign_id = c.id
                                  group by m.status, m.skip_reason) g), '[]'::jsonb) as "counts!"
           from aarogyam.campaigns c order by c.created_at desc, c.id desc limit 100"#
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// One campaign with counts; `None` when it isn't the clinic's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn campaign(conn: &mut PgConnection, id: Uuid) -> Result<Option<CampaignRow>, DbError> {
    let row = sqlx::query_as!(
        CampaignRow,
        r#"select c.id, c.name, c.audience_id, c.template_id, c.channel, c.offer_text,
                  c.scheduled_at, c.status, c.scheduled_count, c.fan_out_started_at,
                  c.fan_out_done_at, c.cancelled_at, c.created_by, c.created_at, c.updated_at,
                  coalesce((select jsonb_agg(jsonb_build_object('status', g.status,
                                  'skip_reason', g.skip_reason, 'count', g.n)
                                  order by g.status, g.skip_reason)
                            from (select m.status, m.skip_reason, count(*) as n
                                  from aarogyam.messages m where m.campaign_id = c.id
                                  group by m.status, m.skip_reason) g), '[]'::jsonb) as "counts!"
           from aarogyam.campaigns c where c.id = $1"#,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A template as a campaign needs to know it: its key, channel and status.
#[derive(Debug, Clone)]
pub struct TemplateInfo {
    /// `promo.offer` is the only key a campaign may use.
    pub key: String,
    /// Its channel.
    pub channel: String,
    /// `approved` to be sent.
    pub status: String,
}

/// The clinic's template by id.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn template(conn: &mut PgConnection, id: Uuid) -> Result<Option<TemplateInfo>, DbError> {
    let row = sqlx::query_as!(
        TemplateInfo,
        "select key, channel, status from aarogyam.message_templates where id = $1",
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A campaign to save.
#[derive(Debug, Clone, Copy)]
pub struct NewCampaign<'a> {
    /// Identifier.
    pub id: Uuid,
    /// Its name.
    pub name: &'a str,
    /// Its audience.
    pub audience_id: Uuid,
    /// Its template.
    pub template_id: Uuid,
    /// Its channel.
    pub channel: &'a str,
    /// Its offer text.
    pub offer_text: &'a str,
    /// When it is due.
    pub scheduled_at: Option<OffsetDateTime>,
}

/// Saves a draft campaign; false when the audience or template isn't the clinic's.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn create_campaign(
    conn: &mut PgConnection,
    campaign: &NewCampaign<'_>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "insert into aarogyam.campaigns (id, name, audience_id, template_id, channel, offer_text,
                                         scheduled_at)
         select $1, $2, a.id, t.id, $5, $6, $7
         from aarogyam.audiences a, aarogyam.message_templates t
         where a.id = $3 and t.id = $4",
        campaign.id,
        campaign.name,
        campaign.audience_id,
        campaign.template_id,
        campaign.channel,
        campaign.offer_text,
        campaign.scheduled_at
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Changes to a draft; absent fields stay (`clear_schedule` removes the time).
#[derive(Debug, Clone, Copy, Default)]
pub struct CampaignChanges<'a> {
    /// New name.
    pub name: Option<&'a str>,
    /// New audience.
    pub audience_id: Option<Uuid>,
    /// New template.
    pub template_id: Option<Uuid>,
    /// New channel.
    pub channel: Option<&'a str>,
    /// New offer text.
    pub offer_text: Option<&'a str>,
    /// New time.
    pub scheduled_at: Option<OffsetDateTime>,
    /// Remove the time.
    pub clear_schedule: bool,
}

/// Changes a draft; false when it isn't a draft (or the new audience or template isn't the
/// clinic's, which the foreign keys refuse).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn update_campaign(
    conn: &mut PgConnection,
    id: Uuid,
    changes: &CampaignChanges<'_>,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.campaigns set name = coalesce($2, name),
           audience_id = coalesce($3, audience_id), template_id = coalesce($4, template_id),
           channel = coalesce($5, channel), offer_text = coalesce($6, offer_text),
           scheduled_at = case when $8 then null else coalesce($7, scheduled_at) end
         where id = $1 and status = 'draft'",
        id,
        changes.name,
        changes.audience_id,
        changes.template_id,
        changes.channel,
        changes.offer_text,
        changes.scheduled_at,
        changes.clear_schedule
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Locks a draft and moves it to `scheduled` with the audience size the owner saw; false when
/// it isn't a draft.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_scheduled(
    conn: &mut PgConnection,
    id: Uuid,
    count: i32,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        "update aarogyam.campaigns set status = 'scheduled', scheduled_count = $2
         where id = $1 and status = 'draft' and scheduled_at is not null",
        id,
        count
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Cancels a campaign that hasn't finished and skips its queued messages (`campaign_cancelled`);
/// returns how many messages. `None` when it is already sent or cancelled.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn cancel(conn: &mut PgConnection, id: Uuid) -> Result<Option<i64>, DbError> {
    let row = sqlx::query!(
        r#"with stopped as (
             update aarogyam.campaigns set status = 'cancelled', cancelled_at = now()
             where id = $1 and status in ('draft', 'scheduled', 'sending') returning id
           ),
           skipped as (
             update aarogyam.messages m
               set status = 'skipped', skip_reason = 'campaign_cancelled', processed_at = now(),
                   secret = null
             where m.campaign_id in (select id from stopped) and m.status = 'queued'
             returning 1
           )
           select (select count(*) from stopped) as "stopped!", (select count(*) from skipped) as "skipped!""#,
        id
    )
    .fetch_one(conn)
    .await?;
    Ok((row.stopped > 0).then_some(row.skipped))
}

/// What one fan-out call did.
#[derive(Debug, Clone, Copy)]
pub struct FanOut {
    /// The clinic.
    pub org_id: Uuid,
    /// The campaign.
    pub campaign_id: Uuid,
    /// Messages queued by this call.
    pub queued: i32,
    /// Patients skipped by the weekly cap in this call.
    pub capped: i32,
    /// Whether every recipient is now queued.
    pub finished: bool,
}

/// Expands the next batch (up to `batch` patients) of the campaign that has waited longest, if
/// one is due. Safe to repeat and to run from several workers.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn fan_out_next(pool: &PgPool, batch: i32) -> Result<Option<FanOut>, DbError> {
    let row = sqlx::query_as!(
        FanOut,
        r#"select org_id as "org_id!", campaign_id as "campaign_id!", queued as "queued!",
                  capped as "capped!", finished as "finished!"
           from app.campaigns_fan_out_next($1)"#,
        batch
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
