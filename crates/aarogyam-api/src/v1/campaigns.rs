//! Audiences and campaigns (docs/decisions.md, "Campaigns"), behind `campaigns.manage`
//! (owners). A preview returns a count and a token, never patients; scheduling needs the token
//! back. Direct sends to a few patients stay on `POST /messages` (`messages.send`).

use aarogyam_app::campaigns::{self as app, CampaignView, DraftPatch, NewDraft};
use aarogyam_dal::campaigns::AudienceRow;
use aarogyam_domain::campaign::{AudienceFilter, FilterParts};
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{AudienceId, CampaignId};
use aarogyam_domain::permission::require::CampaignsManage;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_id, parse_instant, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// One audience filter: `kind` and the fields it takes, nothing else.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
pub struct AudienceFilterBody {
    /// `all_active`, `last_visit`, `birthday_month`, `age_band`, `sex` or `tag`. Balance,
    /// treatment and visit-kind filters don't exist.
    pub kind: String,
    /// `last_visit`: last visit before this date (`YYYY-MM-DD`).
    pub before: Option<String>,
    /// `last_visit`: last visit on or after this date. A patient never seen matches neither.
    pub after: Option<String>,
    /// `birthday_month`: 1 to 12.
    pub month: Option<i32>,
    /// `age_band`: youngest age in whole years.
    pub min: Option<i32>,
    /// `age_band`: oldest age in whole years.
    pub max: Option<i32>,
    /// `sex`: `female`, `male`, `other` or `unknown`.
    pub sex: Option<String>,
    /// `tag`: a patient tag.
    pub tag: Option<String>,
}

impl AudienceFilterBody {
    fn parse(&self) -> Result<AudienceFilter, ApiFailure> {
        AudienceFilter::from_parts(&FilterParts {
            kind: self.kind.clone(),
            before: self.before.clone(),
            after: self.after.clone(),
            month: self.month,
            min: self.min,
            max: self.max,
            sex: self.sex.clone(),
            tag: self.tag.clone(),
        })
        .map_err(|error| bad("filter", &error.to_string()).into())
    }

    fn of(value: &serde_json::Value) -> Self {
        let text = |key: &str| value.get(key).and_then(|v| v.as_str()).map(str::to_owned);
        let number = |key: &str| {
            value
                .get(key)
                .and_then(serde_json::Value::as_i64)
                .and_then(|n| i32::try_from(n).ok())
        };
        Self {
            kind: text("kind").unwrap_or_default(),
            before: text("before"),
            after: text("after"),
            month: number("month"),
            min: number("min"),
            max: number("max"),
            sex: text("sex"),
            tag: text("tag"),
        }
    }
}

/// A saved audience.
#[derive(Debug, Serialize, ToSchema)]
pub struct Audience {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its name.
    pub name: String,
    /// Its filter, evaluated when a campaign sends.
    pub filter: AudienceFilterBody,
    /// When it was made (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
}

impl From<AudienceRow> for Audience {
    fn from(row: AudienceRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            filter: AudienceFilterBody::of(&row.filter),
            created_at: rfc3339(row.created_at),
            updated_at: rfc3339(row.updated_at),
        }
    }
}

/// The clinic's audiences.
#[derive(Debug, Serialize, ToSchema)]
pub struct Audiences {
    /// Newest first, up to 200.
    pub items: Vec<Audience>,
}

/// The clinic's saved audiences.
#[utoipa::path(
    get, path = "/api/v1/audiences", operation_id = "listAudiences", tag = "campaigns",
    security(("bearer" = [])),
    responses((status = 200, body = Audiences), (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"))
)]
pub(crate) async fn list_audiences(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
) -> Result<Json<Audiences>, ApiFailure> {
    let rows = app::audiences(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(Audiences {
        items: rows.into_iter().map(Audience::from).collect(),
    }))
}

/// An audience to save.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveAudience {
    /// One line of 1 to 120 characters.
    pub name: String,
    /// The filter.
    pub filter: AudienceFilterBody,
}

/// Saves an audience.
#[utoipa::path(
    post, path = "/api/v1/audiences", operation_id = "createAudience", tag = "campaigns",
    request_body = SaveAudience, security(("bearer" = [])),
    responses((status = 201, body = Audience), (status = 400, description = "A bad name or filter"),
              (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"))
)]
pub(crate) async fn create_audience(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiJson(body): ApiJson<SaveAudience>,
) -> Result<(StatusCode, Json<Audience>), ApiFailure> {
    let filter = body.filter.parse()?;
    let row = app::create_audience(
        state.db(),
        &request.actor,
        request.request_id,
        &body.name,
        &filter,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

/// One audience.
#[utoipa::path(
    get, path = "/api/v1/audiences/{id}", operation_id = "getAudience", tag = "campaigns",
    params(("id" = String, Path, description = "The audience")), security(("bearer" = [])),
    responses((status = 200, body = Audience), (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such audience in this clinic"))
)]
pub(crate) async fn get_audience(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Audience>, ApiFailure> {
    let row = app::audience(
        state.db(),
        &request.actor,
        request.request_id,
        AudienceId::from_uuid(id),
    )
    .await?;
    Ok(Json(row.into()))
}

/// Changes to an audience; absent fields stay.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchAudience {
    /// New name.
    pub name: Option<String>,
    /// New filter; refused while a scheduled or sending campaign uses the audience.
    pub filter: Option<AudienceFilterBody>,
}

/// Renames an audience or changes its filter.
#[utoipa::path(
    patch, path = "/api/v1/audiences/{id}", operation_id = "updateAudience", tag = "campaigns",
    params(("id" = String, Path, description = "The audience")), request_body = PatchAudience,
    security(("bearer" = [])),
    responses((status = 200, body = Audience), (status = 400, description = "A bad name or filter"),
              (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such audience in this clinic"),
              (status = 409, description = "A scheduled or sending campaign uses its filter"))
)]
pub(crate) async fn update_audience(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PatchAudience>,
) -> Result<Json<Audience>, ApiFailure> {
    let filter = body
        .filter
        .as_ref()
        .map(AudienceFilterBody::parse)
        .transpose()?;
    let row = app::update_audience(
        state.db(),
        &request.actor,
        request.request_id,
        AudienceId::from_uuid(id),
        body.name.as_deref(),
        filter.as_ref(),
    )
    .await?;
    Ok(Json(row.into()))
}

/// Deletes an audience no campaign uses.
#[utoipa::path(
    delete, path = "/api/v1/audiences/{id}", operation_id = "deleteAudience", tag = "campaigns",
    params(("id" = String, Path, description = "The audience")), security(("bearer" = [])),
    responses((status = 204, description = "Deleted"), (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such audience in this clinic"),
              (status = 409, description = "A campaign uses it"))
)]
pub(crate) async fn delete_audience(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete_audience(
        state.db(),
        &request.actor,
        request.request_id,
        AudienceId::from_uuid(id),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A filter to count.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PreviewAudience {
    /// The filter.
    pub filter: AudienceFilterBody,
}

/// How many patients a filter matches, and a token to schedule with.
#[derive(Debug, Serialize, ToSchema)]
pub struct AudiencePreview {
    /// Active patients matching now. Consent, opt-outs and quiet hours apply when each message
    /// is sent, so fewer may be reached.
    pub count: i64,
    /// Hand it back to `POST /campaigns/{id}/schedule`: it proves this filter and this count.
    pub count_token: String,
    /// When the token stops working (RFC 3339).
    pub expires_at: String,
}

/// Counts an audience without naming anyone.
#[utoipa::path(
    post, path = "/api/v1/audiences/preview", operation_id = "previewAudience", tag = "campaigns",
    request_body = PreviewAudience, security(("bearer" = [])),
    responses((status = 200, body = AudiencePreview), (status = 400, description = "A bad filter"),
              (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"))
)]
pub(crate) async fn preview(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiJson(body): ApiJson<PreviewAudience>,
) -> Result<Json<AudiencePreview>, ApiFailure> {
    let filter = body.filter.parse()?;
    let done = app::preview(
        state.db(),
        &request.actor,
        request.request_id,
        &filter,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(AudiencePreview {
        count: done.count,
        count_token: done.count_token,
        expires_at: rfc3339(done.expires_at),
    }))
}

/// One group of a campaign's messages.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessageCount {
    /// `queued`, `sending`, `sent`, `failed` or `skipped`.
    pub status: String,
    /// Why they were skipped: `no_consent`, `consent_withdrawn`, `opted_out`, `frequency_cap`...
    pub skip_reason: Option<String>,
    /// How many.
    pub count: i64,
}

/// A campaign with the outcome of its messages.
#[derive(Debug, Serialize, ToSchema)]
pub struct Campaign {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its name; also the email subject.
    pub name: String,
    /// Its audience.
    #[schema(value_type = String)]
    pub audience_id: Uuid,
    /// Its `promo.offer` template.
    #[schema(value_type = String)]
    pub template_id: Uuid,
    /// `email` or `whatsapp`.
    pub channel: String,
    /// The offer, filled into the template's `{{offer_text}}` and the email body.
    pub offer_text: String,
    /// When it goes (RFC 3339).
    pub scheduled_at: Option<String>,
    /// `draft`, `scheduled`, `sending`, `sent` or `cancelled`.
    pub status: String,
    /// The audience size the owner saw when scheduling.
    pub scheduled_count: Option<i32>,
    /// When recipients began to be queued (RFC 3339).
    pub fan_out_started_at: Option<String>,
    /// When the last recipient was queued (RFC 3339).
    pub fan_out_done_at: Option<String>,
    /// When it was cancelled (RFC 3339).
    pub cancelled_at: Option<String>,
    /// Who made it.
    #[schema(value_type = Option<String>)]
    pub created_by: Option<Uuid>,
    /// When it was made (RFC 3339).
    pub created_at: String,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
    /// Its messages by status and skip reason, counted when asked.
    pub counts: Vec<MessageCount>,
}

impl From<CampaignView> for Campaign {
    fn from(view: CampaignView) -> Self {
        let row = view.row;
        Self {
            id: row.id,
            name: row.name,
            audience_id: row.audience_id,
            template_id: row.template_id,
            channel: row.channel,
            offer_text: row.offer_text,
            scheduled_at: row.scheduled_at.map(rfc3339),
            status: row.status,
            scheduled_count: row.scheduled_count,
            fan_out_started_at: row.fan_out_started_at.map(rfc3339),
            fan_out_done_at: row.fan_out_done_at.map(rfc3339),
            cancelled_at: row.cancelled_at.map(rfc3339),
            created_by: row.created_by,
            created_at: rfc3339(row.created_at),
            updated_at: rfc3339(row.updated_at),
            counts: view
                .counts
                .into_iter()
                .map(|(status, skip_reason, count)| MessageCount {
                    status,
                    skip_reason,
                    count,
                })
                .collect(),
        }
    }
}

/// The clinic's campaigns.
#[derive(Debug, Serialize, ToSchema)]
pub struct Campaigns {
    /// Newest first, up to 100.
    pub items: Vec<Campaign>,
}

/// The clinic's campaigns with counts.
#[utoipa::path(
    get, path = "/api/v1/campaigns", operation_id = "listCampaigns", tag = "campaigns",
    security(("bearer" = [])),
    responses((status = 200, body = Campaigns), (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"))
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
) -> Result<Json<Campaigns>, ApiFailure> {
    let views = app::campaigns(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(Campaigns {
        items: views.into_iter().map(Campaign::from).collect(),
    }))
}

/// A draft campaign to save.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCampaign {
    /// One line of 1 to 120 characters; also the email subject.
    pub name: String,
    /// A saved audience.
    pub audience_id: String,
    /// The clinic's `promo.offer` template for the channel.
    pub template_id: String,
    /// `email` or `whatsapp`.
    pub channel: String,
    /// One line of 1 to 300 characters.
    pub offer_text: String,
    /// When to send (RFC 3339); needed before scheduling.
    pub scheduled_at: Option<String>,
}

/// Saves a draft campaign.
#[utoipa::path(
    post, path = "/api/v1/campaigns", operation_id = "createCampaign", tag = "campaigns",
    request_body = CreateCampaign, security(("bearer" = [])),
    responses((status = 201, body = Campaign), (status = 400, description = "Bad text, channel, time or template"),
              (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "The audience or template isn't this clinic's"))
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiJson(body): ApiJson<CreateCampaign>,
) -> Result<(StatusCode, Json<Campaign>), ApiFailure> {
    let input = NewDraft {
        name: body.name,
        audience_id: AudienceId::from_uuid(parse_id("audience_id", &body.audience_id)?),
        template_id: parse_id("template_id", &body.template_id)?,
        channel: body.channel,
        offer_text: body.offer_text,
        scheduled_at: body
            .scheduled_at
            .as_deref()
            .map(|text| parse_instant("scheduled_at", text))
            .transpose()?,
    };
    let view = app::create(state.db(), &request.actor, request.request_id, input).await?;
    Ok((StatusCode::CREATED, Json(view.into())))
}

/// One campaign with counts.
#[utoipa::path(
    get, path = "/api/v1/campaigns/{id}", operation_id = "getCampaign", tag = "campaigns",
    params(("id" = String, Path, description = "The campaign")), security(("bearer" = [])),
    responses((status = 200, body = Campaign), (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such campaign in this clinic"))
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Campaign>, ApiFailure> {
    let view = app::campaign(
        state.db(),
        &request.actor,
        request.request_id,
        CampaignId::from_uuid(id),
    )
    .await?;
    Ok(Json(view.into()))
}

/// Changes to a draft; absent fields stay.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PatchCampaign {
    /// New name.
    pub name: Option<String>,
    /// New audience.
    pub audience_id: Option<String>,
    /// New template.
    pub template_id: Option<String>,
    /// New channel.
    pub channel: Option<String>,
    /// New offer text.
    pub offer_text: Option<String>,
    /// New time (RFC 3339); an empty string removes it.
    pub scheduled_at: Option<String>,
}

/// Changes a draft campaign.
#[utoipa::path(
    patch, path = "/api/v1/campaigns/{id}", operation_id = "updateCampaign", tag = "campaigns",
    params(("id" = String, Path, description = "The campaign")), request_body = PatchCampaign,
    security(("bearer" = [])),
    responses((status = 200, body = Campaign), (status = 400, description = "Bad text, channel, time or template"),
              (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such campaign, audience or template in this clinic"),
              (status = 409, description = "It isn't a draft"))
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PatchCampaign>,
) -> Result<Json<Campaign>, ApiFailure> {
    let clear = body
        .scheduled_at
        .as_deref()
        .is_some_and(|text| text.trim().is_empty());
    let patch = DraftPatch {
        name: body.name,
        audience_id: body
            .audience_id
            .as_deref()
            .map(|text| parse_id("audience_id", text).map(AudienceId::from_uuid))
            .transpose()?,
        template_id: body
            .template_id
            .as_deref()
            .map(|t| parse_id("template_id", t))
            .transpose()?,
        channel: body.channel,
        offer_text: body.offer_text,
        scheduled_at: body
            .scheduled_at
            .as_deref()
            .filter(|text| !text.trim().is_empty())
            .map(|text| parse_instant("scheduled_at", text))
            .transpose()?,
        clear_schedule: clear,
    };
    let view = app::update(
        state.db(),
        &request.actor,
        request.request_id,
        CampaignId::from_uuid(id),
        patch,
    )
    .await?;
    Ok(Json(view.into()))
}

/// The proof that the owner saw this audience's size.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ScheduleCampaign {
    /// From `POST /audiences/preview` for the campaign's audience filter.
    pub count_token: String,
}

/// Schedules a draft. The token must be a preview of the audience as it is now and unexpired.
#[utoipa::path(
    post, path = "/api/v1/campaigns/{id}/schedule", operation_id = "scheduleCampaign",
    tag = "campaigns", params(("id" = String, Path, description = "The campaign")),
    request_body = ScheduleCampaign, security(("bearer" = [])),
    responses((status = 200, body = Campaign),
              (status = 400, description = "No time set, an unapproved template or a malformed token"),
              (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such campaign in this clinic"),
              (status = 409, description = "Not a draft, or the count token is expired, stale or another filter's"))
)]
pub(crate) async fn schedule(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ScheduleCampaign>,
) -> Result<Json<Campaign>, ApiFailure> {
    let view = app::schedule(
        state.db(),
        &request.actor,
        request.request_id,
        CampaignId::from_uuid(id),
        &body.count_token,
        OffsetDateTime::now_utc(),
    )
    .await?;
    tracing::info!(
        event = Event::CampaignScheduled.as_str(),
        campaign_id = %id,
        count = view.row.scheduled_count,
        "campaign scheduled"
    );
    Ok(Json(view.into()))
}

/// Cancels a campaign that hasn't finished; its queued messages are skipped.
#[utoipa::path(
    post, path = "/api/v1/campaigns/{id}/cancel", operation_id = "cancelCampaign",
    tag = "campaigns", params(("id" = String, Path, description = "The campaign")),
    security(("bearer" = [])),
    responses((status = 200, body = Campaign), (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such campaign in this clinic"),
              (status = 409, description = "Already sent or cancelled"))
)]
pub(crate) async fn cancel(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Campaign>, ApiFailure> {
    let view = app::cancel(
        state.db(),
        &request.actor,
        request.request_id,
        CampaignId::from_uuid(id),
    )
    .await?;
    tracing::info!(event = Event::CampaignCancelled.as_str(), campaign_id = %id, "campaign cancelled");
    Ok(Json(view.into()))
}

/// Emails the campaign to the caller's own address (the verified email of their sign-in, never
/// one from the request), through the staff outbox: no patient is involved and nothing is
/// counted.
#[utoipa::path(
    post, path = "/api/v1/campaigns/{id}/test-send", operation_id = "testSendCampaign",
    tag = "campaigns", params(("id" = String, Path, description = "The campaign")),
    security(("bearer" = [])),
    responses((status = 202, description = "Queued to the caller's own email"),
              (status = 400, description = "The caller's sign-in has no verified email address"),
              (status = 401, description = "Not signed in"),
              (status = 403, description = "The role lacks campaigns.manage"),
              (status = 404, description = "No such campaign in this clinic"))
)]
pub(crate) async fn test_send(
    State(state): State<AppState>,
    Require { request, .. }: Require<CampaignsManage>,
    headers: HeaderMap,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let claims = state.claims(&headers).await?;
    app::test_send(
        state.db(),
        &request.actor,
        request.request_id,
        CampaignId::from_uuid(id),
        claims.email(),
    )
    .await?;
    Ok(StatusCode::ACCEPTED)
}
