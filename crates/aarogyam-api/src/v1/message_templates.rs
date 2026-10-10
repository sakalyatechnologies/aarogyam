//! A clinic's message templates (docs/whatsapp.md), behind `settings.manage`.

use aarogyam_app::message_templates::{self as app, NewTemplate, TemplatePatch};
use aarogyam_dal::message_templates::TemplateRow;
use aarogyam_domain::messaging::Channel;
use aarogyam_domain::permission::require::SettingsManage;
use aarogyam_domain::whatsapp::TemplateCategory;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// One of the clinic's templates.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessageTemplate {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `care.note`, `reminder.follow_up`, `promo.offer`, `appointment.reminder`, `booking.*`...
    pub key: String,
    /// `email` or `whatsapp`.
    pub channel: String,
    /// `en-IN`, `hi-IN`, `mr-IN`...
    pub language: String,
    /// The text, with allow-listed `{{variables}}`.
    pub body: String,
    /// `marketing`, `utility` or `authentication`, as Meta categorises it.
    pub category: String,
    /// The template's name at Meta (`WhatsApp`).
    pub provider_template_ref: Option<String>,
    /// `draft`, `submitted`, `approved`, `rejected` or `paused`. Only approved ones are sent.
    pub status: String,
    /// When it was last submitted (RFC 3339).
    pub submitted_at: Option<String>,
    /// When Meta last reviewed it (RFC 3339).
    pub reviewed_at: Option<String>,
    /// SMS sender header (DLT), for later.
    pub sender_header: Option<String>,
    /// SMS DLT template id, for later.
    pub dlt_template_id: Option<String>,
    /// When it last changed (RFC 3339).
    pub updated_at: String,
}

impl From<TemplateRow> for MessageTemplate {
    fn from(row: TemplateRow) -> Self {
        Self {
            id: row.id,
            key: row.key,
            channel: row.channel,
            language: row.language,
            body: row.body,
            category: row.category,
            provider_template_ref: row.provider_template_ref,
            status: row.status,
            submitted_at: row.submitted_at.map(rfc3339),
            reviewed_at: row.reviewed_at.map(rfc3339),
            sender_header: row.sender_header,
            dlt_template_id: row.dlt_template_id,
            updated_at: rfc3339(row.updated_at),
        }
    }
}

/// The clinic's templates.
#[derive(Debug, Serialize, ToSchema)]
pub struct MessageTemplates {
    /// By key, channel and language.
    pub items: Vec<MessageTemplate>,
}

/// The clinic's message templates: its copies of the platform's defaults and any it added.
#[utoipa::path(
    get,
    path = "/api/v1/templates",
    operation_id = "listMessageTemplates",
    tag = "messages",
    security(("bearer" = [])),
    responses(
        (status = 200, body = MessageTemplates),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<MessageTemplates>, ApiFailure> {
    let rows = app::list(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(MessageTemplates {
        items: rows.into_iter().map(MessageTemplate::from).collect(),
    }))
}

/// A template to add: another language or channel for a known key.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateMessageTemplate {
    /// A known key, such as `appointment.reminder`.
    pub key: String,
    /// `email` or `whatsapp`.
    pub channel: String,
    /// `en-IN`, `hi-IN`, `mr-IN`...
    pub language: String,
    /// The text; only the key's allow-listed `{{variables}}`.
    pub body: String,
    /// `marketing`, `utility` or `authentication`.
    pub category: String,
    /// The template's name at Meta (lower case, digits and `_`).
    pub provider_template_ref: Option<String>,
}

/// Adds a template. Email ones are in use at once; `WhatsApp` ones start as drafts.
#[utoipa::path(
    post,
    path = "/api/v1/templates",
    operation_id = "createMessageTemplate",
    tag = "messages",
    request_body = CreateMessageTemplate,
    security(("bearer" = [])),
    responses(
        (status = 201, body = MessageTemplate),
        (status = 400, description = "Unknown key, channel, category or language, or a variable not on the allow-list"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 409, description = "The clinic has this key, channel and language already")
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<CreateMessageTemplate>,
) -> Result<(StatusCode, Json<MessageTemplate>), ApiFailure> {
    let input = NewTemplate {
        key: body.key,
        channel: Channel::parse(&body.channel).map_err(|_| bad("channel", "unknown value"))?,
        language: body.language,
        body: body.body,
        category: TemplateCategory::parse(&body.category)
            .map_err(|_| bad("category", "unknown value"))?,
        provider_template_ref: body.provider_template_ref,
    };
    let row = app::create(state.db(), &request.actor, request.request_id, input).await?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

/// Changes to the clinic's copy; fields left out stay.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateMessageTemplate {
    /// New text; only the key's allow-listed `{{variables}}`.
    pub body: Option<String>,
    /// `marketing`, `utility` or `authentication`.
    pub category: Option<String>,
    /// The template's name at Meta.
    pub provider_template_ref: Option<String>,
    /// SMS sender header (DLT).
    pub sender_header: Option<String>,
    /// SMS DLT template id.
    pub dlt_template_id: Option<String>,
}

/// Edits the clinic's copy. A `WhatsApp` template whose text, name or category changes goes
/// back to draft until it is submitted and approved again.
#[utoipa::path(
    patch,
    path = "/api/v1/templates/{id}",
    operation_id = "updateMessageTemplate",
    tag = "messages",
    params(("id" = String, Path, description = "The template")),
    request_body = UpdateMessageTemplate,
    security(("bearer" = [])),
    responses(
        (status = 200, body = MessageTemplate),
        (status = 400, description = "A bad body, category or name"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such template in this clinic")
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<UpdateMessageTemplate>,
) -> Result<Json<MessageTemplate>, ApiFailure> {
    let patch = TemplatePatch {
        body: body.body,
        category: body
            .category
            .as_deref()
            .map(TemplateCategory::parse)
            .transpose()
            .map_err(|_| bad("category", "unknown value"))?,
        provider_template_ref: body.provider_template_ref,
        sender_header: body.sender_header,
        dlt_template_id: body.dlt_template_id,
    };
    let row = app::update(state.db(), &request.actor, request.request_id, id, patch).await?;
    Ok(Json(row.into()))
}

/// Records that the clinic's `WhatsApp` template was submitted to Meta for review (submission
/// itself is by hand for the pilot; docs/whatsapp.md). Meta's decision arrives by webhook.
#[utoipa::path(
    post,
    path = "/api/v1/templates/{id}/submit",
    operation_id = "submitMessageTemplate",
    tag = "messages",
    params(("id" = String, Path, description = "The template")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = MessageTemplate),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such template in this clinic"),
        (status = 409, description = "An email template, one without a name at Meta, or one approved already")
    )
)]
pub(crate) async fn submit(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<MessageTemplate>, ApiFailure> {
    let row = app::submit(state.db(), &request.actor, request.request_id, id).await?;
    Ok(Json(row.into()))
}
