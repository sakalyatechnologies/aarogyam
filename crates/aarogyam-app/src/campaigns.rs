//! Campaigns (docs/decisions.md, "Campaigns"): saved audiences, a count-only preview whose token
//! the owner must hand back to schedule, and the campaign's life: draft, scheduled, cancelled.
//! Expanding a due campaign into messages is the worker's job (`aarogyam-notify`). All of it
//! needs `campaigns.manage`.

use aarogyam_dal::campaigns::{
    self as dal, AudienceRow, CampaignChanges, CampaignRow, NewCampaign,
};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::campaign::{
    AudienceFilter, COUNT_TOKEN_TTL, CampaignError, MAX_NAME_CHARS, MAX_OFFER_CHARS, one_line,
    schedulable,
};
use aarogyam_domain::ids::{AudienceId, CampaignId};
use aarogyam_domain::messaging::Channel;
use aarogyam_domain::outbox::MessageKind;
use aarogyam_domain::patient::Email;
use aarogyam_domain::permission::Permission;
use aws_lc_rs::constant_time::verify_slices_are_equal;
use sakalya_db::{Db, ScopedTx};
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::outbox::{StaffEmail, enqueue_staff_email};
use crate::scope::staff_scope as scope;
use crate::tokens::hash_token;

/// The only template key a campaign sends.
pub const CAMPAIGN_TEMPLATE_KEY: &str = "promo.offer";

fn invalid(field: &'static str) -> impl FnOnce(CampaignError) -> AppError {
    move |error| AppError::invalid(field, error)
}

fn channel(text: &str) -> Result<Channel, AppError> {
    match Channel::parse(text) {
        Ok(channel @ (Channel::Email | Channel::Whatsapp)) => Ok(channel),
        _ => Err(AppError::invalid("channel", "email or whatsapp")),
    }
}

/// The clinic's audiences.
///
/// # Errors
/// [`AppError::Denied`] without `campaigns.manage`.
pub async fn audiences(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<AudienceRow>, AppError> {
    actor.require(Permission::CampaignsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok::<_, AppError>(dal::audiences(tx.conn()).await?)
    })
    .await
}

/// One audience.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't this clinic's.
pub async fn audience(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: AudienceId,
) -> Result<AudienceRow, AppError> {
    actor.require(Permission::CampaignsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::audience(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("audience"))
    })
    .await
}

/// Saves an audience.
///
/// # Errors
/// [`AppError::Invalid`] for a bad name.
pub async fn create_audience(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    name: &str,
    filter: &AudienceFilter,
) -> Result<AudienceRow, AppError> {
    actor.require(Permission::CampaignsManage)?;
    let name = one_line(name, MAX_NAME_CHARS).map_err(invalid("name"))?;
    let filter = filter.to_json();
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok::<_, AppError>(
            dal::create_audience(tx.conn(), AudienceId::new_v7().uuid(), &name, &filter).await?,
        )
    })
    .await
}

/// Changes an audience's name and/or filter. The filter of an audience a scheduled or sending
/// campaign uses can't change.
///
/// # Errors
/// [`AppError::NotFound`], [`AppError::Conflict`] as above, [`AppError::Invalid`] for a bad name.
pub async fn update_audience(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: AudienceId,
    name: Option<&str>,
    filter: Option<&AudienceFilter>,
) -> Result<AudienceRow, AppError> {
    actor.require(Permission::CampaignsManage)?;
    let name = name
        .map(|text| one_line(text, MAX_NAME_CHARS).map_err(invalid("name")))
        .transpose()?;
    let filter = filter.map(AudienceFilter::to_json);
    db.scoped(
        &scope(actor, request_id),
        async |tx| match dal::update_audience(
            tx.conn(),
            id.uuid(),
            name.as_deref(),
            filter.as_ref(),
        )
        .await?
        {
            None => Err(AppError::NotFound("audience")),
            Some((false, _)) => Err(AppError::Conflict(
                "a scheduled or sending campaign uses this audience's filter",
            )),
            Some((true, row)) => Ok(row),
        },
    )
    .await
}

/// Deletes an audience no campaign uses.
///
/// # Errors
/// [`AppError::NotFound`]; [`AppError::Conflict`] when a campaign uses it.
pub async fn delete_audience(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: AudienceId,
) -> Result<(), AppError> {
    actor.require(Permission::CampaignsManage)?;
    db.scoped(
        &scope(actor, request_id),
        async |tx| match dal::delete_audience(tx.conn(), id.uuid()).await? {
            None => Err(AppError::NotFound("audience")),
            Some(false) => Err(AppError::Conflict("a campaign uses this audience")),
            Some(true) => Ok(()),
        },
    )
    .await
}

/// What a preview tells: how many, never who, and a token that must come back to schedule.
#[derive(Debug, Clone)]
pub struct Preview {
    /// Active patients the filter matches now.
    pub count: i64,
    /// Proof of the filter and the count, for [`schedule`].
    pub count_token: String,
    /// When the token stops working.
    pub expires_at: OffsetDateTime,
}

/// The token for a count: expiry seconds, a dot and the SHA-256 of the clinic, the caller, the
/// filter, the count and the expiry. Scheduling recomputes the count and so the token: a changed
/// audience, another filter, another clinic or user, or a late call all fail.
fn token(actor: &ClinicActor, filter: &Value, count: i64, expires_at: i64) -> String {
    let hash = hash_token(&format!(
        "count-token.v1|{}|{}|{filter}|{count}|{expires_at}",
        actor.clinic_id.uuid(),
        actor.user_id.uuid()
    ));
    format!("{expires_at}.{hash}")
}

/// Counts the patients a filter matches, for the owner to see before scheduling.
///
/// # Errors
/// [`AppError::Denied`] without `campaigns.manage`.
pub async fn preview(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    filter: &AudienceFilter,
    now: OffsetDateTime,
) -> Result<Preview, AppError> {
    actor.require(Permission::CampaignsManage)?;
    let json = filter.to_json();
    let count = db
        .scoped(&scope(actor, request_id), async |tx| {
            Ok::<_, AppError>(dal::count(tx.conn(), &json).await?)
        })
        .await?;
    let expires_at = now + COUNT_TOKEN_TTL;
    Ok(Preview {
        count,
        count_token: token(actor, &json, count, expires_at.unix_timestamp()),
        expires_at,
    })
}

/// A campaign with its counts, from `group by status, skip_reason` over its messages.
#[derive(Debug, Clone)]
pub struct CampaignView {
    /// As stored.
    pub row: CampaignRow,
    /// `(status, skip_reason, count)`.
    pub counts: Vec<(String, Option<String>, i64)>,
}

impl From<CampaignRow> for CampaignView {
    fn from(row: CampaignRow) -> Self {
        let counts = row
            .counts
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|group| {
                Some((
                    group.get("status")?.as_str()?.to_owned(),
                    group
                        .get("skip_reason")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    group.get("count")?.as_i64()?,
                ))
            })
            .collect();
        Self { row, counts }
    }
}

/// The clinic's campaigns, newest first, with counts.
///
/// # Errors
/// [`AppError::Denied`] without `campaigns.manage`.
pub async fn campaigns(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Vec<CampaignView>, AppError> {
    actor.require(Permission::CampaignsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        Ok::<_, AppError>(
            dal::campaigns(tx.conn())
                .await?
                .into_iter()
                .map(CampaignView::from)
                .collect(),
        )
    })
    .await
}

/// One campaign with counts.
///
/// # Errors
/// [`AppError::NotFound`] when it isn't this clinic's.
pub async fn campaign(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: CampaignId,
) -> Result<CampaignView, AppError> {
    actor.require(Permission::CampaignsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::campaign(tx.conn(), id.uuid())
            .await?
            .map(CampaignView::from)
            .ok_or(AppError::NotFound("campaign"))
    })
    .await
}

/// A campaign to save as a draft.
#[derive(Debug, Clone)]
pub struct NewDraft {
    /// Its name; also the email's subject.
    pub name: String,
    /// Its audience.
    pub audience_id: AudienceId,
    /// Its `promo.offer` template for the channel.
    pub template_id: Uuid,
    /// `email` or `whatsapp`.
    pub channel: String,
    /// The offer, filled into `{{offer_text}}` (and the email body).
    pub offer_text: String,
    /// When to send.
    pub scheduled_at: Option<OffsetDateTime>,
}

async fn check_template(
    tx: &mut ScopedTx,
    template_id: Uuid,
    channel: Channel,
) -> Result<aarogyam_dal::campaigns::TemplateInfo, AppError> {
    let info = dal::template(tx.conn(), template_id)
        .await?
        .ok_or(AppError::NotFound("template"))?;
    if info.key != CAMPAIGN_TEMPLATE_KEY {
        return Err(AppError::invalid(
            "template_id",
            "a campaign sends the promo.offer template",
        ));
    }
    if info.channel != channel.as_str() {
        return Err(AppError::invalid(
            "template_id",
            "the template is for another channel",
        ));
    }
    Ok(info)
}

/// Saves a draft campaign.
///
/// # Errors
/// [`AppError::Invalid`] for bad text, channel or template; [`AppError::NotFound`] for an
/// audience or template that isn't this clinic's.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: NewDraft,
) -> Result<CampaignView, AppError> {
    actor.require(Permission::CampaignsManage)?;
    let name = one_line(&input.name, MAX_NAME_CHARS).map_err(invalid("name"))?;
    let offer = one_line(&input.offer_text, MAX_OFFER_CHARS).map_err(invalid("offer_text"))?;
    let channel = channel(&input.channel)?;
    let id = CampaignId::new_v7();
    db.scoped(&scope(actor, request_id), async |tx| {
        check_template(tx, input.template_id, channel).await?;
        let saved = dal::create_campaign(
            tx.conn(),
            &NewCampaign {
                id: id.uuid(),
                name: &name,
                audience_id: input.audience_id.uuid(),
                template_id: input.template_id,
                channel: channel.as_str(),
                offer_text: &offer,
                scheduled_at: input.scheduled_at,
            },
        )
        .await?;
        if !saved {
            return Err(AppError::NotFound("audience"));
        }
        dal::campaign(tx.conn(), id.uuid())
            .await?
            .map(CampaignView::from)
            .ok_or(AppError::NotFound("campaign"))
    })
    .await
}

/// Changes to a draft; absent fields stay.
#[derive(Debug, Clone, Default)]
pub struct DraftPatch {
    /// New name.
    pub name: Option<String>,
    /// New audience.
    pub audience_id: Option<AudienceId>,
    /// New template.
    pub template_id: Option<Uuid>,
    /// New channel.
    pub channel: Option<String>,
    /// New offer text.
    pub offer_text: Option<String>,
    /// New time.
    pub scheduled_at: Option<OffsetDateTime>,
    /// Remove the time.
    pub clear_schedule: bool,
}

/// Changes a draft campaign.
///
/// # Errors
/// [`AppError::Conflict`] when it isn't a draft; [`AppError::NotFound`]; [`AppError::Invalid`].
pub async fn update(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: CampaignId,
    patch: DraftPatch,
) -> Result<CampaignView, AppError> {
    actor.require(Permission::CampaignsManage)?;
    let name = patch
        .name
        .as_deref()
        .map(|text| one_line(text, MAX_NAME_CHARS).map_err(invalid("name")))
        .transpose()?;
    let offer = patch
        .offer_text
        .as_deref()
        .map(|text| one_line(text, MAX_OFFER_CHARS).map_err(invalid("offer_text")))
        .transpose()?;
    let new_channel = patch.channel.as_deref().map(channel).transpose()?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::campaign(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("campaign"))?;
        if current.status != "draft" {
            return Err(AppError::Conflict("only a draft campaign can change"));
        }
        // The template and channel must still agree after the change.
        let final_channel = match new_channel {
            Some(channel) => channel,
            None => Channel::parse(&current.channel)
                .map_err(|_| AppError::Internal("stored channel"))?,
        };
        check_template(
            tx,
            patch.template_id.unwrap_or(current.template_id),
            final_channel,
        )
        .await?;
        if let Some(audience) = patch.audience_id
            && dal::audience(tx.conn(), audience.uuid()).await?.is_none()
        {
            return Err(AppError::NotFound("audience"));
        }
        let changed = dal::update_campaign(
            tx.conn(),
            id.uuid(),
            &CampaignChanges {
                name: name.as_deref(),
                audience_id: patch.audience_id.map(AudienceId::uuid),
                template_id: patch.template_id,
                channel: new_channel.map(Channel::as_str),
                offer_text: offer.as_deref(),
                scheduled_at: patch.scheduled_at,
                clear_schedule: patch.clear_schedule,
            },
        )
        .await?;
        if !changed {
            return Err(AppError::Conflict("only a draft campaign can change"));
        }
        dal::campaign(tx.conn(), id.uuid())
            .await?
            .map(CampaignView::from)
            .ok_or(AppError::NotFound("campaign"))
    })
    .await
}

/// Schedules a draft: its time must be set and not long past, its template approved, and
/// `count_token` must be a preview of this audience's filter whose count still holds and that
/// hasn't expired.
///
/// # Errors
/// [`AppError::Conflict`] for a campaign that isn't a draft or a token that is expired, stale
/// or another filter's; [`AppError::Invalid`] for a malformed token or a missing time or
/// unapproved template; [`AppError::NotFound`].
pub async fn schedule(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: CampaignId,
    count_token: &str,
    now: OffsetDateTime,
) -> Result<CampaignView, AppError> {
    actor.require(Permission::CampaignsManage)?;
    let (expiry, _) = count_token
        .split_once('.')
        .filter(|(expiry, hash)| expiry.parse::<i64>().is_ok() && hash.len() == 64)
        .ok_or_else(|| AppError::invalid("count_token", "not a count token"))?;
    let expiry: i64 = expiry
        .parse()
        .map_err(|_| AppError::Internal("count token"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::campaign(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("campaign"))?;
        if current.status != "draft" {
            return Err(AppError::Conflict("only a draft campaign can be scheduled"));
        }
        let due = current
            .scheduled_at
            .ok_or_else(|| AppError::invalid("scheduled_at", "set a time before scheduling"))?;
        if !schedulable(due, now) {
            return Err(AppError::invalid("scheduled_at", "that time is long past"));
        }
        let template = dal::template(tx.conn(), current.template_id)
            .await?
            .ok_or(AppError::NotFound("template"))?;
        if template.status != "approved" {
            return Err(AppError::invalid(
                "template_id",
                "the template is not approved",
            ));
        }
        let audience = dal::audience(tx.conn(), current.audience_id)
            .await?
            .ok_or(AppError::NotFound("audience"))?;
        if expiry <= now.unix_timestamp() {
            return Err(AppError::Conflict("the count token expired: preview again"));
        }
        let count = dal::count(tx.conn(), &audience.filter).await?;
        let expected = token(actor, &audience.filter, count, expiry);
        if verify_slices_are_equal(expected.as_bytes(), count_token.as_bytes()).is_err() {
            return Err(AppError::Conflict(
                "the count token doesn't match this audience as it is now: preview again",
            ));
        }
        let count = i32::try_from(count).map_err(|_| AppError::Internal("audience too large"))?;
        if !dal::mark_scheduled(tx.conn(), id.uuid(), count).await? {
            return Err(AppError::Conflict("only a draft campaign can be scheduled"));
        }
        dal::campaign(tx.conn(), id.uuid())
            .await?
            .map(CampaignView::from)
            .ok_or(AppError::NotFound("campaign"))
    })
    .await
}

/// Cancels a campaign that hasn't finished; its queued messages are skipped.
///
/// # Errors
/// [`AppError::NotFound`]; [`AppError::Conflict`] when it is already sent or cancelled.
pub async fn cancel(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: CampaignId,
) -> Result<CampaignView, AppError> {
    actor.require(Permission::CampaignsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::cancel(tx.conn(), id.uuid()).await?.is_none() {
            return match dal::campaign(tx.conn(), id.uuid()).await? {
                None => Err(AppError::NotFound("campaign")),
                Some(_) => Err(AppError::Conflict(
                    "the campaign is already sent or cancelled",
                )),
            };
        }
        dal::campaign(tx.conn(), id.uuid())
            .await?
            .map(CampaignView::from)
            .ok_or(AppError::NotFound("campaign"))
    })
    .await
}

/// Emails the campaign as it will read to `own_email`, the caller's own verified sign-in address,
/// (never one from the request), through the staff outbox: no patient, no message row, nothing
/// counted.
///
/// # Errors
/// [`AppError::NotFound`]; [`AppError::Invalid`] when there is no usable email address.
pub async fn test_send(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: CampaignId,
    own_email: Option<&str>,
) -> Result<(), AppError> {
    actor.require(Permission::CampaignsManage)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let current = dal::campaign(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("campaign"))?;
        let address = own_email
            .and_then(|text| Email::parse(text).ok())
            .ok_or_else(|| {
                AppError::invalid("email", "your sign-in has no usable email address")
            })?;
        enqueue_staff_email(
            tx,
            &StaffEmail {
                kind: MessageKind::CampaignTest,
                to: &address,
                payload: json!({
                    "campaign_name": current.name,
                    "offer_text": current.offer_text,
                }),
                secret: None,
            },
        )
        .await?;
        Ok(())
    })
    .await
}
