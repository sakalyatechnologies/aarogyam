//! Staff chat: one-to-one and group conversations between members of a clinic. Every use case
//! needs `chat.use`; row-level security also shows a conversation only to its active members, so
//! a member who left, or whose membership is no longer active, gets nothing (404). A message may
//! name one patient within the author's reach; reading it leaves an access-record entry. Text is
//! never logged.

use aarogyam_dal::chat::{self as dal, ConversationRow, MemberRow, MessageRow, NewMessage, Reader};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::chat::{
    ConversationKind, Cursor, MAX_GROUP_MEMBERS, MemberRole, UNREAD_CAP, direct_key, group_title,
    message_body, page_size,
};
use aarogyam_domain::ids::{ChatMessageId, ConversationId, MembershipId, PatientId};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::scope::{actor_kind, staff_scope as scope};

fn unknown(_: aarogyam_domain::UnknownValue) -> AppError {
    AppError::Internal("unknown chat value")
}

/// A conversation in the caller's list.
#[derive(Debug, Clone)]
pub struct ConversationSummary {
    /// The conversation.
    pub id: ConversationId,
    /// Direct or group.
    pub kind: ConversationKind,
    /// A group's title.
    pub title: Option<String>,
    /// When it was archived.
    pub archived_at: Option<OffsetDateTime>,
    /// When it was started.
    pub created_at: OffsetDateTime,
    /// The caller's role in it.
    pub role: MemberRole,
    /// Whether the caller muted it (left out of the badge).
    pub muted: bool,
    /// The newest message the caller has read.
    pub last_read_message_id: Option<ChatMessageId>,
    /// The newest message.
    pub last_message_id: Option<ChatMessageId>,
    /// When it was posted.
    pub last_message_at: Option<OffsetDateTime>,
    /// Unread messages from others, at most 100.
    pub unread: i64,
    /// In a direct conversation, the other member and their name.
    pub with: Option<(MembershipId, String)>,
}

fn summary(row: ConversationRow) -> Result<ConversationSummary, AppError> {
    Ok(ConversationSummary {
        id: ConversationId::from_uuid(row.id),
        kind: ConversationKind::parse(&row.kind).map_err(unknown)?,
        title: row.title,
        archived_at: row.archived_at,
        created_at: row.created_at,
        role: MemberRole::parse(&row.role).map_err(unknown)?,
        muted: row.muted,
        last_read_message_id: row.last_read_message_id.map(ChatMessageId::from_uuid),
        last_message_id: row.last_message_id.map(ChatMessageId::from_uuid),
        last_message_at: row.last_message_at,
        unread: row.unread,
        with: row
            .other_membership_id
            .map(MembershipId::from_uuid)
            .zip(row.other_name),
    })
}

/// The caller's conversations, most recent activity first, with unread counts. One statement.
///
/// # Errors
/// [`AppError::Denied`] without `chat.use`; [`AppError::Db`] on database failures.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    limit: Option<u32>,
) -> Result<Vec<ConversationSummary>, AppError> {
    actor.require(Permission::ChatUse)?;
    let me = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::conversations(tx.conn(), me, UNREAD_CAP, page_size(limit)).await?;
        rows.into_iter().map(summary).collect()
    })
    .await
}

/// A conversation to start.
#[derive(Debug, Clone)]
pub enum NewConversation {
    /// With one other member; returns the pair's conversation when there is one.
    Direct {
        /// The other member.
        with: MembershipId,
    },
    /// A named group; the caller is its admin.
    Group {
        /// 1 to 80 characters.
        title: String,
        /// The other members (the caller is added anyway).
        members: Vec<MembershipId>,
    },
}

/// The conversation, and whether this call started it.
#[derive(Debug, Clone, Copy)]
pub struct Started {
    /// The conversation.
    pub id: ConversationId,
    /// `false` when the direct conversation existed already.
    pub created: bool,
}

/// Starts a conversation. Direct ones are idempotent: the pair's existing conversation is
/// returned, also when two requests race.
///
/// # Errors
/// [`AppError::Invalid`] for a bad title, a conversation with oneself or too many members;
/// [`AppError::NotFound`] when a member isn't active staff of this clinic.
pub async fn start(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    new: NewConversation,
) -> Result<Started, AppError> {
    actor.require(Permission::ChatUse)?;
    let me = actor.membership_id;
    let id = ConversationId::new_v7();
    match new {
        NewConversation::Direct { with } => {
            if with == me {
                return Err(AppError::Invalid {
                    field: "membership_id",
                    message: "must be someone else".into(),
                });
            }
            let key = direct_key(me, with);
            db.scoped(&scope(actor, request_id), async |tx| {
                if let Some(found) = dal::find_direct(tx.conn(), &key).await? {
                    return Ok(Started {
                        id: ConversationId::from_uuid(found),
                        created: false,
                    });
                }
                refuse_without_chat(tx, &[with.uuid()]).await?;
                let kind = ConversationKind::Direct.as_str();
                let direct = Some((key.as_str(), with.uuid()));
                if dal::insert_conversation(tx.conn(), id.uuid(), kind, None, direct).await? {
                    let pair = [me.uuid(), with.uuid()];
                    dal::insert_members(tx.conn(), id.uuid(), &pair, None).await?;
                    return Ok(Started { id, created: true });
                }
                // Another request started it meanwhile, or the other member isn't active.
                match dal::find_direct(tx.conn(), &key).await? {
                    Some(found) => Ok(Started {
                        id: ConversationId::from_uuid(found),
                        created: false,
                    }),
                    None => Err(AppError::NotFound("membership")),
                }
            })
            .await
        }
        NewConversation::Group { title, members } => {
            let title = group_title(&title).map_err(|message| AppError::Invalid {
                field: "title",
                message: message.into(),
            })?;
            let mut ids: Vec<Uuid> = members.iter().map(|m| m.uuid()).collect();
            ids.push(me.uuid());
            ids.sort_unstable();
            ids.dedup();
            if ids.len() > MAX_GROUP_MEMBERS {
                return Err(AppError::Invalid {
                    field: "member_ids",
                    message: format!("at most {MAX_GROUP_MEMBERS} members"),
                });
            }
            db.scoped(&scope(actor, request_id), async |tx| {
                refuse_without_chat(tx, &ids).await?;
                let kind = ConversationKind::Group.as_str();
                dal::insert_conversation(tx.conn(), id.uuid(), kind, Some(&title), None).await?;
                let added =
                    dal::insert_members(tx.conn(), id.uuid(), &ids, Some(me.uuid())).await?;
                if usize::try_from(added).ok() != Some(ids.len()) {
                    return Err(AppError::NotFound("membership"));
                }
                Ok(Started { id, created: true })
            })
            .await
        }
    }
}

/// Chat is for people whose role has `chat.use`: starting or adding someone without it is refused.
async fn refuse_without_chat(
    tx: &mut sakalya_db::ScopedTx,
    members: &[Uuid],
) -> Result<(), AppError> {
    if dal::without_chat(tx.conn(), members).await? > 0 {
        return Err(AppError::Forbidden("that person's role can't use chat"));
    }
    Ok(())
}

/// An active member of a conversation.
#[derive(Debug, Clone)]
pub struct MemberView {
    /// Their membership.
    pub membership_id: MembershipId,
    /// Member or admin.
    pub role: MemberRole,
    /// When they joined.
    pub joined_at: OffsetDateTime,
    /// Their display name.
    pub name: String,
}

/// A conversation with its active members.
#[derive(Debug, Clone)]
pub struct ConversationDetail {
    /// The conversation.
    pub id: ConversationId,
    /// Direct or group.
    pub kind: ConversationKind,
    /// A group's title.
    pub title: Option<String>,
    /// When it was archived.
    pub archived_at: Option<OffsetDateTime>,
    /// When it was started.
    pub created_at: OffsetDateTime,
    /// Who is in it, earliest joined first.
    pub members: Vec<MemberView>,
}

fn detail_of(rows: Vec<MemberRow>) -> Result<ConversationDetail, AppError> {
    let first = rows.first().ok_or(AppError::NotFound("conversation"))?;
    let mut detail = ConversationDetail {
        id: ConversationId::from_uuid(first.id),
        kind: ConversationKind::parse(&first.kind).map_err(unknown)?,
        title: first.title.clone(),
        archived_at: first.archived_at,
        created_at: first.created_at,
        members: Vec::with_capacity(rows.len()),
    };
    for row in rows {
        detail.members.push(MemberView {
            membership_id: MembershipId::from_uuid(row.membership_id),
            role: MemberRole::parse(&row.role).map_err(unknown)?,
            joined_at: row.joined_at,
            name: row.display_name,
        });
    }
    Ok(detail)
}

/// A conversation the caller is in, with its members. One statement.
///
/// # Errors
/// [`AppError::NotFound`] when the caller isn't in it.
pub async fn detail(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
) -> Result<ConversationDetail, AppError> {
    actor.require(Permission::ChatUse)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        detail_of(dal::conversation(tx.conn(), id.uuid()).await?)
    })
    .await
}

/// Checks the caller may change who is in a group: they are in it, it is a group, and (unless
/// `self_only`) they administer it.
async fn group_place(
    tx: &mut sakalya_db::ScopedTx,
    id: ConversationId,
    me: MembershipId,
    self_only: bool,
) -> Result<(), AppError> {
    let place = dal::place(tx.conn(), id.uuid(), me.uuid())
        .await?
        .ok_or(AppError::NotFound("conversation"))?;
    if place.kind != ConversationKind::Group.as_str() {
        return Err(AppError::Conflict(
            "a direct conversation has no members to change",
        ));
    }
    if !self_only && place.role != MemberRole::Admin.as_str() {
        return Err(AppError::Forbidden(
            "only a group admin changes its members",
        ));
    }
    Ok(())
}

/// Adds members to a group the caller administers; returns how many were new.
///
/// # Errors
/// [`AppError::NotFound`] when the caller isn't in it or a member isn't active staff here;
/// [`AppError::Forbidden`] for a non-admin; [`AppError::Conflict`] for a direct conversation.
pub async fn add_members(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
    members: &[MembershipId],
) -> Result<i64, AppError> {
    actor.require(Permission::ChatUse)?;
    let mut ids: Vec<Uuid> = members.iter().map(|m| m.uuid()).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() || ids.len() > MAX_GROUP_MEMBERS {
        return Err(AppError::Invalid {
            field: "membership_ids",
            message: format!("must name 1 to {MAX_GROUP_MEMBERS} members"),
        });
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        group_place(tx, id, actor.membership_id, false).await?;
        refuse_without_chat(tx, &ids).await?;
        let added = dal::add_members(tx.conn(), id.uuid(), &ids).await?;
        if usize::try_from(added.found).ok() != Some(ids.len()) {
            return Err(AppError::NotFound("membership"));
        }
        Ok(added.added)
    })
    .await
}

/// Takes `member` out of a group: the caller themselves (leaving), or anyone when the caller
/// administers it. A last admin who leaves hands the role to the earliest-joined member.
///
/// # Errors
/// As [`add_members`]; [`AppError::NotFound`] when `member` isn't in it.
pub async fn remove_member(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
    member: MembershipId,
) -> Result<(), AppError> {
    actor.require(Permission::ChatUse)?;
    let me = actor.membership_id;
    db.scoped(&scope(actor, request_id), async |tx| {
        group_place(tx, id, me, member == me).await?;
        dal::keep_an_admin(tx.conn(), id.uuid(), member.uuid()).await?;
        if dal::remove_member(tx.conn(), id.uuid(), member.uuid()).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("member"))
        }
    })
    .await
}

/// Mutes or unmutes a conversation for the caller: a muted one still counts its unread
/// messages in the list, but not in the badge.
///
/// # Errors
/// [`AppError::NotFound`] when the caller isn't in it.
pub async fn set_muted(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
    muted: bool,
) -> Result<(), AppError> {
    actor.require(Permission::ChatUse)?;
    let me = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::set_muted(tx.conn(), id.uuid(), me, muted).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("conversation"))
        }
    })
    .await
}

/// A message as members see it.
#[derive(Debug, Clone)]
pub struct MessageView {
    /// The message.
    pub id: ChatMessageId,
    /// Its conversation.
    pub conversation_id: ConversationId,
    /// Who wrote it.
    pub author: MembershipId,
    /// Their display name.
    pub author_name: Option<String>,
    /// The text; `None` once deleted.
    pub body: Option<String>,
    /// The patient it is about.
    pub patient_id: Option<PatientId>,
    /// The author's idempotency key.
    pub client_id: Uuid,
    /// When it was deleted.
    pub deleted_at: Option<OffsetDateTime>,
    /// When it was posted.
    pub created_at: OffsetDateTime,
}

fn message_of(row: MessageRow) -> Option<MessageView> {
    Some(MessageView {
        id: ChatMessageId::from_uuid(row.id?),
        conversation_id: ConversationId::from_uuid(row.conversation_id),
        author: MembershipId::from_uuid(row.author_membership_id?),
        author_name: row.author_name,
        body: row.body,
        patient_id: row.patient_id.map(PatientId::from_uuid),
        client_id: row.client_id?,
        deleted_at: row.deleted_at,
        created_at: row.created_at?,
    })
}

/// A page of a conversation, oldest first: the newest page, the messages after a cursor (a
/// poll) or before one (scrolling back). Messages naming a patient leave one access-record
/// entry per reader, patient, conversation and day. One statement.
///
/// # Errors
/// [`AppError::NotFound`] when the caller isn't in it.
pub async fn messages(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
    cursor: Cursor,
    limit: Option<u32>,
) -> Result<Vec<MessageView>, AppError> {
    actor.require(Permission::ChatUse)?;
    let (after, before) = match cursor {
        Cursor::Latest => (None, None),
        Cursor::After(at) => (Some(at.uuid()), None),
        Cursor::Before(at) => (None, Some(at.uuid())),
    };
    let request_text = request_id.map(|id| id.to_string());
    let reader = Reader {
        user_id: actor.user_id.uuid(),
        actor_kind: actor_kind(actor).as_str(),
        purpose: actor.access_purpose(),
        request_id: request_text.as_deref(),
        timezone: &actor.timezone,
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::page(
            tx.conn(),
            id.uuid(),
            after,
            before,
            page_size(limit),
            reader,
        )
        .await?;
        if rows.is_empty() {
            return Err(AppError::NotFound("conversation"));
        }
        Ok(rows.into_iter().filter_map(message_of).collect())
    })
    .await
}

/// A message to post.
#[derive(Debug, Clone)]
pub struct NewChatMessage {
    /// The client's key: posting again with it returns the first message.
    pub client_id: Uuid,
    /// Plain text, 1 to 4000 characters.
    pub body: String,
    /// A patient it is about, within the caller's `patients.read` reach.
    pub patient_id: Option<PatientId>,
}

/// Posts a message; returns it and whether this call wrote it (`false` for a retry).
///
/// # Errors
/// [`AppError::Invalid`] for bad text; [`AppError::Denied`] naming a patient without
/// `patients.read`; [`AppError::NotFound`] when the caller isn't in the conversation or the
/// patient is out of reach; [`AppError::Conflict`] when it is archived; [`AppError::IdConflict`]
/// when the client id was used for another message.
pub async fn post(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
    new: NewChatMessage,
) -> Result<(MessageView, bool), AppError> {
    actor.require(Permission::ChatUse)?;
    let body = message_body(&new.body).map_err(|message| AppError::Invalid {
        field: "body",
        message: message.into(),
    })?;
    if new.patient_id.is_some() {
        actor.require(Permission::PatientsRead)?;
    }
    let me = actor.membership_id;
    let message = NewMessage {
        id: ChatMessageId::new_v7().uuid(),
        conversation_id: id.uuid(),
        author: me.uuid(),
        body,
        patient_id: new.patient_id.map(PatientId::uuid),
        client_id: new.client_id,
        reach: actor.reach(Permission::PatientsRead).member(),
    };
    let view = |message_id: Uuid, body: Option<String>, patient: Option<Uuid>, at| MessageView {
        id: ChatMessageId::from_uuid(message_id),
        conversation_id: id,
        author: me,
        author_name: None,
        body,
        patient_id: patient.map(PatientId::from_uuid),
        client_id: new.client_id,
        deleted_at: None,
        created_at: at,
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        if let Some(at) = dal::post(tx.conn(), message).await? {
            return Ok((
                view(message.id, Some(body.to_owned()), message.patient_id, at),
                true,
            ));
        }
        if let Some(earlier) = dal::by_client_id(tx.conn(), me.uuid(), new.client_id).await? {
            let same = earlier.conversation_id == id.uuid()
                && earlier.body.as_deref() == Some(body)
                && earlier.patient_id == message.patient_id;
            return if same {
                Ok((
                    view(
                        earlier.id,
                        earlier.body,
                        earlier.patient_id,
                        earlier.created_at,
                    ),
                    false,
                ))
            } else {
                Err(AppError::IdConflict)
            };
        }
        let place = dal::place(tx.conn(), id.uuid(), me.uuid())
            .await?
            .ok_or(AppError::NotFound("conversation"))?;
        if place.archived_at.is_some() {
            return Err(AppError::Conflict("the conversation is archived"));
        }
        Err(AppError::NotFound("patient"))
    })
    .await
}

/// Marks the conversation read up to `message` for the caller (never moves back).
///
/// # Errors
/// [`AppError::NotFound`] when the caller isn't in it or the message isn't in it.
pub async fn mark_read(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
    message: ChatMessageId,
) -> Result<(), AppError> {
    actor.require(Permission::ChatUse)?;
    let me = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::mark_read(tx.conn(), id.uuid(), message.uuid(), me).await? {
            Ok(())
        } else {
            Err(AppError::NotFound("message"))
        }
    })
    .await
}

/// Deletes one of the caller's own messages: its text and patient are cleared, and members see
/// it as deleted. Deleting it again changes nothing.
///
/// # Errors
/// [`AppError::NotFound`] when the caller can't see it; [`AppError::Forbidden`] when it is
/// someone else's.
pub async fn delete(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: ConversationId,
    message: ChatMessageId,
) -> Result<(), AppError> {
    actor.require(Permission::ChatUse)?;
    let me = actor.membership_id.uuid();
    db.scoped(&scope(actor, request_id), async |tx| {
        if dal::delete(tx.conn(), id.uuid(), message.uuid(), me).await? {
            return Ok(());
        }
        match dal::author_of(tx.conn(), id.uuid(), message.uuid()).await? {
            None => Err(AppError::NotFound("message")),
            Some((author, _)) if author != me => {
                Err(AppError::Forbidden("only the author deletes a message"))
            }
            Some(_) => Ok(()),
        }
    })
    .await
}

/// The numbers the apps poll every minute.
#[derive(Debug, Clone, Copy)]
pub struct BadgeCounts {
    /// Unread chat messages in conversations the caller hasn't muted, at most 100.
    pub chat_unread: i64,
    /// Unread notifications (as `GET /notifications/count`); `None` without `appointments.read`.
    pub notifications_unread: Option<i64>,
}

/// Chat and notification unread counts, in one statement.
///
/// # Errors
/// [`AppError::Denied`] without `chat.use`.
pub async fn badges(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<BadgeCounts, AppError> {
    actor.require(Permission::ChatUse)?;
    let me = actor.membership_id.uuid();
    let notifications = crate::notifications::viewer(actor);
    db.scoped(&scope(actor, request_id), async |tx| {
        let counts = dal::badges(tx.conn(), me, UNREAD_CAP, notifications).await?;
        Ok(BadgeCounts {
            chat_unread: counts.chat_unread,
            notifications_unread: counts.notifications_unread,
        })
    })
    .await
}
