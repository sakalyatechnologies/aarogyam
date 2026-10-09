//! Staff chat: conversations (one to one or groups), their members and messages, polled with
//! cursors, and `GET /me/badges` for the minute poll. Every route needs `chat.use`; only a
//! conversation's active members see it (404 for anyone else). Message text is never logged.

use aarogyam_app::chat::{
    self as app, ConversationDetail, ConversationSummary, MessageView, NewChatMessage,
    NewConversation,
};
use aarogyam_domain::chat::Cursor;
use aarogyam_domain::event::Event;
use aarogyam_domain::ids::{ChatMessageId, ConversationId, MembershipId, PatientId};
use aarogyam_domain::permission::require::ChatUse;
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiJson, ApiPath, ApiQuery};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::{bad, parse_id, rfc3339};
use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

/// The other member of a direct conversation.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChatPeer {
    /// Their membership.
    #[schema(value_type = String)]
    pub membership_id: Uuid,
    /// Their display name.
    pub name: String,
}

/// A conversation in the caller's list.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConversationItem {
    /// The conversation.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `direct` or `group`.
    pub kind: String,
    /// A group's title.
    pub title: Option<String>,
    /// When it was archived (RFC 3339).
    pub archived_at: Option<String>,
    /// When it was started (RFC 3339).
    pub created_at: String,
    /// The caller's role: `member` or `admin`.
    pub role: String,
    /// Whether the caller muted it (not counted in the badge).
    pub muted: bool,
    /// The newest message the caller has read.
    #[schema(value_type = Option<String>)]
    pub last_read_message_id: Option<Uuid>,
    /// The newest message; poll with `after` from here.
    #[schema(value_type = Option<String>)]
    pub last_message_id: Option<Uuid>,
    /// When it was posted (RFC 3339).
    pub last_message_at: Option<String>,
    /// Unread messages from others, at most 100 (show "99+" above 99).
    pub unread: i64,
    /// In a direct conversation, the other member.
    pub with: Option<ChatPeer>,
}

impl From<ConversationSummary> for ConversationItem {
    fn from(view: ConversationSummary) -> Self {
        Self {
            id: view.id.uuid(),
            kind: view.kind.as_str().to_owned(),
            title: view.title,
            archived_at: view.archived_at.map(rfc3339),
            created_at: rfc3339(view.created_at),
            role: view.role.as_str().to_owned(),
            muted: view.muted,
            last_read_message_id: view.last_read_message_id.map(ChatMessageId::uuid),
            last_message_id: view.last_message_id.map(ChatMessageId::uuid),
            last_message_at: view.last_message_at.map(rfc3339),
            unread: view.unread,
            with: view.with.map(|(id, name)| ChatPeer {
                membership_id: id.uuid(),
                name,
            }),
        }
    }
}

/// The caller's conversations, most recent activity first.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConversationList {
    /// The conversations.
    pub items: Vec<ConversationItem>,
}

/// Page size for lists.
#[derive(Debug, Deserialize)]
pub struct ListParams {
    /// 1 to 100 (default 50).
    pub limit: Option<u32>,
}

/// The caller's conversations with the newest message time and unread count of each: one
/// statement.
#[utoipa::path(
    get,
    path = "/api/v1/conversations",
    operation_id = "listConversations",
    tag = "chat",
    params(("limit" = Option<u32>, Query, description = "1 to 100 (default 50)")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ConversationList),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use")
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiQuery(params): ApiQuery<ListParams>,
) -> Result<Json<ConversationList>, ApiFailure> {
    let items = app::list(state.db(), &request.actor, request.request_id, params.limit).await?;
    Ok(Json(ConversationList {
        items: items.into_iter().map(ConversationItem::from).collect(),
    }))
}

/// A conversation to start.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewConversationBody {
    /// `direct` (with `membership_id`) or `group` (with `title` and `member_ids`).
    pub kind: String,
    /// Direct: the other member.
    #[schema(value_type = Option<String>)]
    pub membership_id: Option<Uuid>,
    /// Group: 1 to 80 characters.
    pub title: Option<String>,
    /// Group: the other members (the caller is added as admin).
    #[schema(value_type = Option<Vec<String>>)]
    pub member_ids: Option<Vec<Uuid>>,
}

/// The conversation started, or the pair's existing direct conversation.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConversationStarted {
    /// The conversation.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `false` when the direct conversation existed already.
    pub created: bool,
}

/// Starts a conversation. A direct one is idempotent: asking again (from either side) returns
/// the pair's conversation with `200`.
#[utoipa::path(
    post,
    path = "/api/v1/conversations",
    operation_id = "startConversation",
    tag = "chat",
    request_body = NewConversationBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ConversationStarted, description = "Started"),
        (status = 200, body = ConversationStarted, description = "The existing direct conversation"),
        (status = 400, description = "Bad kind or title, oneself, or too many members"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use"),
        (status = 404, description = "A member isn't active staff of this clinic")
    )
)]
pub(crate) async fn start(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiJson(body): ApiJson<NewConversationBody>,
) -> Result<(StatusCode, Json<ConversationStarted>), ApiFailure> {
    let new = match body.kind.as_str() {
        "direct" => NewConversation::Direct {
            with: MembershipId::from_uuid(
                body.membership_id
                    .ok_or_else(|| bad("membership_id", "is required for a direct conversation"))?,
            ),
        },
        "group" => NewConversation::Group {
            title: body.title.unwrap_or_default(),
            members: body
                .member_ids
                .unwrap_or_default()
                .into_iter()
                .map(MembershipId::from_uuid)
                .collect(),
        },
        _ => return Err(bad("kind", "must be direct or group").into()),
    };
    let started = app::start(state.db(), &request.actor, request.request_id, new).await?;
    let status = if started.created {
        tracing::info!(
            event = Event::ConversationStarted.as_str(),
            conversation_id = %started.id.uuid(),
            "conversation started"
        );
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(ConversationStarted {
            id: started.id.uuid(),
            created: started.created,
        }),
    ))
}

/// An active member of a conversation.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConversationMember {
    /// Their membership.
    #[schema(value_type = String)]
    pub membership_id: Uuid,
    /// `member` or `admin`.
    pub role: String,
    /// When they joined (RFC 3339).
    pub joined_at: String,
    /// Their display name.
    pub name: String,
}

/// A conversation with its active members.
#[derive(Debug, Serialize, ToSchema)]
pub struct Conversation {
    /// The conversation.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `direct` or `group`.
    pub kind: String,
    /// A group's title.
    pub title: Option<String>,
    /// When it was archived (RFC 3339).
    pub archived_at: Option<String>,
    /// When it was started (RFC 3339).
    pub created_at: String,
    /// Who is in it, earliest joined first.
    pub members: Vec<ConversationMember>,
}

impl From<ConversationDetail> for Conversation {
    fn from(view: ConversationDetail) -> Self {
        Self {
            id: view.id.uuid(),
            kind: view.kind.as_str().to_owned(),
            title: view.title,
            archived_at: view.archived_at.map(rfc3339),
            created_at: rfc3339(view.created_at),
            members: view
                .members
                .into_iter()
                .map(|member| ConversationMember {
                    membership_id: member.membership_id.uuid(),
                    role: member.role.as_str().to_owned(),
                    joined_at: rfc3339(member.joined_at),
                    name: member.name,
                })
                .collect(),
        }
    }
}

/// A conversation the caller is in, with its members.
#[utoipa::path(
    get,
    path = "/api/v1/conversations/{id}",
    operation_id = "getConversation",
    tag = "chat",
    params(("id" = String, Path, description = "The conversation")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = Conversation),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use"),
        (status = 404, description = "No such conversation the caller is in")
    )
)]
pub(crate) async fn detail(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Conversation>, ApiFailure> {
    let id = ConversationId::from_uuid(id);
    let view = app::detail(state.db(), &request.actor, request.request_id, id).await?;
    Ok(Json(view.into()))
}

/// Members to add to a group.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AddMembers {
    /// 1 to 100 active members of this clinic.
    #[schema(value_type = Vec<String>)]
    pub membership_ids: Vec<Uuid>,
}

/// How many were added.
#[derive(Debug, Serialize, ToSchema)]
pub struct MembersAdded {
    /// Members who weren't in the group (or had left) and now are.
    pub added: i64,
}

/// Adds members to a group the caller administers; someone who left joins again.
#[utoipa::path(
    post,
    path = "/api/v1/conversations/{id}/members",
    operation_id = "addConversationMembers",
    tag = "chat",
    params(("id" = String, Path, description = "The group")),
    request_body = AddMembers,
    security(("bearer" = [])),
    responses(
        (status = 200, body = MembersAdded),
        (status = 400, description = "No members, or too many"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use, or the caller isn't a group admin"),
        (status = 404, description = "No such conversation the caller is in, or a member isn't active staff here"),
        (status = 409, description = "A direct conversation")
    )
)]
pub(crate) async fn add_members(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<AddMembers>,
) -> Result<Json<MembersAdded>, ApiFailure> {
    let members: Vec<MembershipId> = body
        .membership_ids
        .into_iter()
        .map(MembershipId::from_uuid)
        .collect();
    let id = ConversationId::from_uuid(id);
    let added =
        app::add_members(state.db(), &request.actor, request.request_id, id, &members).await?;
    Ok(Json(MembersAdded { added }))
}

/// Takes a member out of a group: anyone, for a group admin; oneself is the same as leaving.
#[utoipa::path(
    delete,
    path = "/api/v1/conversations/{id}/members/{membership_id}",
    operation_id = "removeConversationMember",
    tag = "chat",
    params(
        ("id" = String, Path, description = "The group"),
        ("membership_id" = String, Path, description = "The member to take out")
    ),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use, or the caller isn't a group admin"),
        (status = 404, description = "No such conversation the caller is in, or the member isn't in it"),
        (status = 409, description = "A direct conversation")
    )
)]
pub(crate) async fn remove_member(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath((id, member)): ApiPath<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiFailure> {
    app::remove_member(
        state.db(),
        &request.actor,
        request.request_id,
        ConversationId::from_uuid(id),
        MembershipId::from_uuid(member),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Leaves a group: it disappears for the caller. A last admin hands the role on.
#[utoipa::path(
    post,
    path = "/api/v1/conversations/{id}/leave",
    operation_id = "leaveConversation",
    tag = "chat",
    params(("id" = String, Path, description = "The group")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Left"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use"),
        (status = 404, description = "No such conversation the caller is in"),
        (status = 409, description = "A direct conversation, which can't be left")
    )
)]
pub(crate) async fn leave(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    let me = request.actor.membership_id;
    let id = ConversationId::from_uuid(id);
    app::remove_member(state.db(), &request.actor, request.request_id, id, me).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Whether a conversation is muted.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MuteBody {
    /// `true` leaves its unread messages out of the badge.
    pub muted: bool,
}

/// Mutes or unmutes a conversation for the caller only.
#[utoipa::path(
    put,
    path = "/api/v1/conversations/{id}/mute",
    operation_id = "muteConversation",
    tag = "chat",
    params(("id" = String, Path, description = "The conversation")),
    request_body = MuteBody,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Saved"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use"),
        (status = 404, description = "No such conversation the caller is in")
    )
)]
pub(crate) async fn mute(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<MuteBody>,
) -> Result<StatusCode, ApiFailure> {
    let id = ConversationId::from_uuid(id);
    app::set_muted(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        body.muted,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A chat message.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChatMessage {
    /// The message; a cursor for `after` and `before`.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Its conversation.
    #[schema(value_type = String)]
    pub conversation_id: Uuid,
    /// Who wrote it.
    #[schema(value_type = String)]
    pub author_membership_id: Uuid,
    /// Their display name.
    pub author_name: Option<String>,
    /// Plain text; absent once deleted.
    pub body: Option<String>,
    /// The patient it is about; open `/patients/{id}` (the caller's own reach applies).
    #[schema(value_type = Option<String>)]
    pub patient_id: Option<Uuid>,
    /// The author's idempotency key.
    #[schema(value_type = String)]
    pub client_id: Uuid,
    /// Whether the author deleted it.
    pub deleted: bool,
    /// When it was posted (RFC 3339).
    pub created_at: String,
}

impl From<MessageView> for ChatMessage {
    fn from(view: MessageView) -> Self {
        Self {
            id: view.id.uuid(),
            conversation_id: view.conversation_id.uuid(),
            author_membership_id: view.author.uuid(),
            author_name: view.author_name,
            body: view.body,
            patient_id: view.patient_id.map(PatientId::uuid),
            client_id: view.client_id,
            deleted: view.deleted_at.is_some(),
            created_at: rfc3339(view.created_at),
        }
    }
}

/// A page of messages, oldest first.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChatMessageList {
    /// The messages.
    pub items: Vec<ChatMessage>,
}

/// Which messages to fetch.
#[derive(Debug, Deserialize)]
pub struct PageParams {
    /// Messages newer than this one (polling).
    pub after: Option<String>,
    /// Messages older than this one (scrolling back).
    pub before: Option<String>,
    /// 1 to 100 (default 50).
    pub limit: Option<u32>,
}

/// A page of a conversation, oldest first: the newest messages, those after a message (poll
/// with the last id you have) or those before one (scroll back with the first). One statement.
#[utoipa::path(
    get,
    path = "/api/v1/conversations/{id}/messages",
    operation_id = "listChatMessages",
    tag = "chat",
    params(
        ("id" = String, Path, description = "The conversation"),
        ("after" = Option<String>, Query, description = "Only messages newer than this id"),
        ("before" = Option<String>, Query, description = "Only messages older than this id"),
        ("limit" = Option<u32>, Query, description = "1 to 100 (default 50)")
    ),
    security(("bearer" = [])),
    responses(
        (status = 200, body = ChatMessageList),
        (status = 400, description = "A cursor isn't an id, or both were given"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use"),
        (status = 404, description = "No such conversation the caller is in")
    )
)]
pub(crate) async fn messages(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(params): ApiQuery<PageParams>,
) -> Result<Json<ChatMessageList>, ApiFailure> {
    let cursor_id = |field, text: &str| parse_id(field, text).map(ChatMessageId::from_uuid);
    let cursor = match (params.after.as_deref(), params.before.as_deref()) {
        (None, None) => Cursor::Latest,
        (Some(after), None) => Cursor::After(cursor_id("after", after)?),
        (None, Some(before)) => Cursor::Before(cursor_id("before", before)?),
        (Some(_), Some(_)) => return Err(bad("before", "can't be used with after").into()),
    };
    let id = ConversationId::from_uuid(id);
    let items = app::messages(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        cursor,
        params.limit,
    )
    .await?;
    Ok(Json(ChatMessageList {
        items: items.into_iter().map(ChatMessage::from).collect(),
    }))
}

/// A message to post.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewChatMessageBody {
    /// Chosen by the client (any UUID); posting again with it returns the first message.
    #[schema(value_type = String)]
    pub client_id: Uuid,
    /// Plain text, 1 to 4000 characters.
    pub body: String,
    /// A patient it is about; needs `patients.read` reaching them.
    #[schema(value_type = Option<String>)]
    pub patient_id: Option<Uuid>,
}

/// Posts a message. Idempotent by `client_id`: a retry returns the first message with `200`.
#[utoipa::path(
    post,
    path = "/api/v1/conversations/{id}/messages",
    operation_id = "postChatMessage",
    tag = "chat",
    params(("id" = String, Path, description = "The conversation")),
    request_body = NewChatMessageBody,
    security(("bearer" = [])),
    responses(
        (status = 201, body = ChatMessage, description = "Posted"),
        (status = 200, body = ChatMessage, description = "Posted earlier with this client_id"),
        (status = 400, description = "Empty, too long or not plain text"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use, or patients.read for a patient"),
        (status = 404, description = "No such conversation the caller is in, or the patient is out of reach"),
        (status = 409, description = "Archived, or the client_id was used for another message")
    )
)]
pub(crate) async fn post_message(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<NewChatMessageBody>,
) -> Result<(StatusCode, Json<ChatMessage>), ApiFailure> {
    let new = NewChatMessage {
        client_id: body.client_id,
        body: body.body,
        patient_id: body.patient_id.map(PatientId::from_uuid),
    };
    let id = ConversationId::from_uuid(id);
    let (view, created) =
        app::post(state.db(), &request.actor, request.request_id, id, new).await?;
    if created {
        tracing::info!(
            event = Event::ChatMessagePosted.as_str(),
            conversation_id = %id.uuid(),
            message_id = %view.id.uuid(),
            "chat message posted"
        );
    }
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(view.into())))
}

/// How far the caller has read.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReadUpTo {
    /// The newest message read; the pointer never moves back.
    #[schema(value_type = String)]
    pub message_id: Uuid,
}

/// Marks the conversation read up to a message, for the caller only.
#[utoipa::path(
    post,
    path = "/api/v1/conversations/{id}/read",
    operation_id = "markConversationRead",
    tag = "chat",
    params(("id" = String, Path, description = "The conversation")),
    request_body = ReadUpTo,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Saved"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use"),
        (status = 404, description = "No such conversation the caller is in, or the message isn't in it")
    )
)]
pub(crate) async fn mark_read(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ReadUpTo>,
) -> Result<StatusCode, ApiFailure> {
    let id = ConversationId::from_uuid(id);
    let message = ChatMessageId::from_uuid(body.message_id);
    app::mark_read(state.db(), &request.actor, request.request_id, id, message).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Deletes one of the caller's own messages: its text goes, and members see "deleted".
#[utoipa::path(
    delete,
    path = "/api/v1/conversations/{id}/messages/{message_id}",
    operation_id = "deleteChatMessage",
    tag = "chat",
    params(
        ("id" = String, Path, description = "The conversation"),
        ("message_id" = String, Path, description = "The message")
    ),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use, or the message is someone else's"),
        (status = 404, description = "No such message the caller can see")
    )
)]
pub(crate) async fn delete_message(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
    ApiPath((id, message)): ApiPath<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiFailure> {
    let id = ConversationId::from_uuid(id);
    let message = ChatMessageId::from_uuid(message);
    app::delete(state.db(), &request.actor, request.request_id, id, message).await?;
    tracing::info!(
        event = Event::ChatMessageDeleted.as_str(),
        conversation_id = %id.uuid(),
        message_id = %message.uuid(),
        "chat message deleted"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// The numbers the apps poll every minute.
#[derive(Debug, Serialize, ToSchema)]
pub struct Badges {
    /// Unread chat messages in conversations the caller hasn't muted, at most 100.
    pub chat_unread: i64,
    /// Unread notifications, as `GET /notifications/count` counts them; absent without
    /// `appointments.read`.
    pub notifications_unread: Option<i64>,
}

/// Chat and notification unread counts for the minute poll, in one statement.
#[utoipa::path(
    get,
    path = "/api/v1/me/badges",
    operation_id = "getBadges",
    tag = "chat",
    security(("bearer" = [])),
    responses(
        (status = 200, body = Badges),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks chat.use")
    )
)]
pub(crate) async fn badges(
    State(state): State<AppState>,
    Require { request, .. }: Require<ChatUse>,
) -> Result<Json<Badges>, ApiFailure> {
    let counts = app::badges(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(Badges {
        chat_unread: counts.chat_unread,
        notifications_unread: counts.notifications_unread,
    }))
}
