//! Staff chat (migrations 0390 to 0392): conversations, members and messages. Row-level
//! security shows a conversation only to its active members, so every query here sees only
//! the caller's own conversations; `me` is the caller's membership. Message text is read and
//! written, never logged.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// One conversation in the caller's list.
#[derive(Debug, Clone)]
pub struct ConversationRow {
    /// The conversation.
    pub id: Uuid,
    /// `direct` or `group`.
    pub kind: String,
    /// A group's title.
    pub title: Option<String>,
    /// When it was archived.
    pub archived_at: Option<OffsetDateTime>,
    /// When it was started.
    pub created_at: OffsetDateTime,
    /// The caller's role: `member` or `admin`.
    pub role: String,
    /// Whether the caller muted it.
    pub muted: bool,
    /// The newest message the caller has read.
    pub last_read_message_id: Option<Uuid>,
    /// The newest message.
    pub last_message_id: Option<Uuid>,
    /// When it was posted.
    pub last_message_at: Option<OffsetDateTime>,
    /// Messages from others after the caller's read pointer, at most the cap.
    pub unread: i64,
    /// In a direct conversation, the other member.
    pub other_membership_id: Option<Uuid>,
    /// Their display name.
    pub other_name: Option<String>,
}

/// The caller's conversations, most recent activity first, with unread counts: one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn conversations(
    conn: &mut PgConnection,
    me: Uuid,
    unread_cap: i64,
    limit: i64,
) -> Result<Vec<ConversationRow>, DbError> {
    let rows = sqlx::query_as!(
        ConversationRow,
        r#"select c.id, c.kind, c.title, c.archived_at, c.created_at, me.role, me.muted,
                  me.last_read_message_id, last.id as "last_message_id?",
                  last.created_at as "last_message_at?",
                  (select count(*) from (
                     select 1 from aarogyam.chat_messages m
                     where m.org_id = c.org_id and m.conversation_id = c.id
                       and m.deleted_at is null and m.author_membership_id <> me.membership_id
                       and (me.last_read_message_id is null or m.id > me.last_read_message_id)
                     limit $2) u) as "unread!",
                  other.membership_id as "other_membership_id?", other.display_name as "other_name?"
           from aarogyam.conversation_members me
           join aarogyam.conversations c on c.org_id = me.org_id and c.id = me.conversation_id
           left join lateral (
             select m.id, m.created_at from aarogyam.chat_messages m
             where m.org_id = c.org_id and m.conversation_id = c.id
             order by m.id desc limit 1) last on true
           left join lateral (
             select o.membership_id, u.display_name from aarogyam.conversation_members o
             join aarogyam.memberships om on om.org_id = o.org_id and om.id = o.membership_id
             join aarogyam.users u on u.id = om.user_id
             where c.kind = 'direct' and o.org_id = c.org_id and o.conversation_id = c.id
               and o.membership_id <> me.membership_id
             limit 1) other on true
           where me.membership_id = $1 and me.left_at is null
           order by coalesce(last.created_at, c.created_at) desc, c.id desc
           limit $3"#,
        me,
        unread_cap,
        limit
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The caller's place in one conversation they are in now.
#[derive(Debug, Clone)]
pub struct Place {
    /// `direct` or `group`.
    pub kind: String,
    /// `member` or `admin`.
    pub role: String,
    /// When it was archived.
    pub archived_at: Option<OffsetDateTime>,
}

/// The caller's place in a conversation; `None` when they aren't in it (or it isn't there).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn place(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    me: Uuid,
) -> Result<Option<Place>, DbError> {
    let row = sqlx::query_as!(
        Place,
        r#"select c.kind, cm.role, c.archived_at from aarogyam.conversations c
           join aarogyam.conversation_members cm on cm.org_id = c.org_id and cm.conversation_id = c.id
           where c.id = $1 and cm.membership_id = $2 and cm.left_at is null"#,
        conversation_id,
        me
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// A conversation with one of its active members, as one row per member.
#[derive(Debug, Clone)]
pub struct MemberRow {
    /// The conversation.
    pub id: Uuid,
    /// `direct` or `group`.
    pub kind: String,
    /// A group's title.
    pub title: Option<String>,
    /// When it was archived.
    pub archived_at: Option<OffsetDateTime>,
    /// When it was started.
    pub created_at: OffsetDateTime,
    /// The member.
    pub membership_id: Uuid,
    /// `member` or `admin`.
    pub role: String,
    /// When they joined.
    pub joined_at: OffsetDateTime,
    /// Their display name.
    pub display_name: String,
}

/// A conversation and its active members, earliest joined first; empty when the caller isn't
/// in it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn conversation(conn: &mut PgConnection, id: Uuid) -> Result<Vec<MemberRow>, DbError> {
    let rows = sqlx::query_as!(
        MemberRow,
        r#"select c.id, c.kind, c.title, c.archived_at, c.created_at, cm.membership_id, cm.role,
                  cm.joined_at, u.display_name
           from aarogyam.conversations c
           join aarogyam.conversation_members cm
             on cm.org_id = c.org_id and cm.conversation_id = c.id and cm.left_at is null
           join aarogyam.memberships m on m.org_id = cm.org_id and m.id = cm.membership_id
           join aarogyam.users u on u.id = m.user_id
           where c.id = $1
           order by cm.joined_at, cm.membership_id"#,
        id
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// The direct conversation with this key, if the caller is in one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn find_direct(conn: &mut PgConnection, key: &str) -> Result<Option<Uuid>, DbError> {
    let id = sqlx::query_scalar!(
        "select id from aarogyam.conversations where kind = 'direct' and direct_key = $1",
        key
    )
    .fetch_optional(conn)
    .await?;
    Ok(id)
}

/// Starts a conversation. A direct one needs `other` to be an active member, and is skipped
/// when the pair has one already (another request won the race); `false` when nothing was
/// written. No `returning`: the caller can't see it until its members are added.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_conversation(
    conn: &mut PgConnection,
    id: Uuid,
    kind: &str,
    title: Option<&str>,
    direct: Option<(&str, Uuid)>,
) -> Result<bool, DbError> {
    let (key, other) = direct.unzip();
    let done = sqlx::query!(
        r#"insert into aarogyam.conversations (id, kind, title, direct_key)
           select $1, $2, $3, $4
           where $5::uuid is null
              or exists (select 1 from aarogyam.memberships m where m.id = $5 and m.status = 'active')
           on conflict (org_id, direct_key) where kind = 'direct' do nothing"#,
        id,
        kind,
        title,
        key,
        other
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Puts the first members into a conversation just started: the active memberships among
/// `members`, `admin` getting the admin role. Returns how many were added.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn insert_members(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    members: &[Uuid],
    admin: Option<Uuid>,
) -> Result<u64, DbError> {
    let done = sqlx::query!(
        r#"insert into aarogyam.conversation_members (conversation_id, membership_id, role)
           select $1, m.id, case when m.id = $3 then 'admin' else 'member' end
           from aarogyam.memberships m where m.id = any($2) and m.status = 'active'"#,
        conversation_id,
        members,
        admin
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected())
}

/// How adding members went: how many of the asked-for ids are active memberships, and how many
/// of those were not in the conversation already (or had left and came back).
#[derive(Debug, Clone, Copy)]
pub struct Added {
    /// Active memberships among those asked for.
    pub found: i64,
    /// Newly in the conversation.
    pub added: i64,
}

/// Adds members to a group the caller administers; someone who left joins again as a member.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn add_members(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    members: &[Uuid],
) -> Result<Added, DbError> {
    let row = sqlx::query_as!(
        Added,
        r#"with wanted as (
             select m.id from aarogyam.memberships m where m.id = any($2) and m.status = 'active'
           ), saved as (
             insert into aarogyam.conversation_members (conversation_id, membership_id)
             select $1, id from wanted
             on conflict (org_id, conversation_id, membership_id) do update
               set left_at = null, joined_at = now(), role = 'member'
               where aarogyam.conversation_members.left_at is not null
             returning 1
           )
           select (select count(*) from wanted) as "found!", (select count(*) from saved) as "added!""#,
        conversation_id,
        members
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}

/// Before `leaving` leaves a group: when nobody else would be admin, the earliest-joined other
/// member becomes one. Changes nothing when another admin remains or nobody else is left.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn keep_an_admin(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    leaving: Uuid,
) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.conversation_members cm set role = 'admin'
           where cm.conversation_id = $1
             and cm.membership_id = (
               select o.membership_id from aarogyam.conversation_members o
               where o.conversation_id = $1 and o.left_at is null and o.membership_id <> $2
               order by o.joined_at, o.membership_id limit 1)
             and not exists (
               select 1 from aarogyam.conversation_members a
               where a.conversation_id = $1 and a.left_at is null and a.role = 'admin'
                 and a.membership_id <> $2)"#,
        conversation_id,
        leaving
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// Takes a member out of a conversation (they keep nothing: the conversation disappears for
/// them). `false` when they weren't in it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn remove_member(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    member: Uuid,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.conversation_members set left_at = now()
           where conversation_id = $1 and membership_id = $2 and left_at is null"#,
        conversation_id,
        member
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// Mutes or unmutes a conversation for the caller. `false` when they aren't in it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn set_muted(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    me: Uuid,
    muted: bool,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.conversation_members set muted = $3
           where conversation_id = $1 and membership_id = $2 and left_at is null"#,
        conversation_id,
        me,
        muted
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// One row of a page of messages: the conversation is always there; the message fields are
/// empty on the single row of a conversation with no messages in the page.
#[derive(Debug, Clone)]
pub struct MessageRow {
    /// The conversation, present whenever the caller is in it.
    pub conversation_id: Uuid,
    /// The message.
    pub id: Option<Uuid>,
    /// Who wrote it.
    pub author_membership_id: Option<Uuid>,
    /// Their display name.
    pub author_name: Option<String>,
    /// The text; empty once deleted.
    pub body: Option<String>,
    /// The patient it is about.
    pub patient_id: Option<Uuid>,
    /// The author's idempotency key.
    pub client_id: Option<Uuid>,
    /// When it was deleted.
    pub deleted_at: Option<OffsetDateTime>,
    /// When it was posted.
    pub created_at: Option<OffsetDateTime>,
}

/// Who is reading, for the access record a message naming a patient leaves.
#[derive(Debug, Clone, Copy)]
pub struct Reader<'a> {
    /// The user.
    pub user_id: Uuid,
    /// `staff`.
    pub actor_kind: &'a str,
    /// `care`, `front_desk` or `billing`.
    pub purpose: &'a str,
    /// The request, for tracing.
    pub request_id: Option<&'a str>,
    /// The clinic's time zone: the access record is written once per clinic day.
    pub timezone: &'a str,
}

/// A page of a conversation, in one statement: messages after `after` (oldest first) when
/// given, else those before `before` (or the newest) newest first. Each patient a message on
/// the page names gets one access-record entry per reader, conversation and clinic day. No
/// rows when the caller isn't in the conversation.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn page(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    after: Option<Uuid>,
    before: Option<Uuid>,
    limit: i64,
    reader: Reader<'_>,
) -> Result<Vec<MessageRow>, DbError> {
    let rows = sqlx::query_as!(
        MessageRow,
        r#"with conv as (
             select c.org_id, c.id from aarogyam.conversations c where c.id = $1
           ), page as (
             (select m.id, m.author_membership_id, m.body, m.patient_id, m.client_id,
                     m.deleted_at, m.created_at
              from aarogyam.chat_messages m join conv on m.org_id = conv.org_id and m.conversation_id = conv.id
              where $2::uuid is not null and m.id > $2
              order by m.id limit $4)
             union all
             (select m.id, m.author_membership_id, m.body, m.patient_id, m.client_id,
                     m.deleted_at, m.created_at
              from aarogyam.chat_messages m join conv on m.org_id = conv.org_id and m.conversation_id = conv.id
              where $2::uuid is null and ($3::uuid is null or m.id < $3)
              order by m.id desc limit $4)
           ), logged as (
             insert into audit.access_log
               (actor_user_id, actor_kind, patient_id, resource, resource_id, action, purpose, request_id)
             select distinct $5::uuid, $6, p.patient_id, 'chat', $1::uuid, 'view', $7, $8
             from page p
             where p.patient_id is not null
               and not exists (
                 select 1 from audit.access_log l
                 where l.org_id = (select app.tenant_id()) and l.patient_id = p.patient_id
                   and l.at >= date_trunc('day', now(), $9) and l.resource = 'chat'
                   and l.resource_id = $1 and l.actor_user_id = $5)
           )
           select conv.id as "conversation_id!", p.id as "id?",
                  p.author_membership_id as "author_membership_id?",
                  u.display_name as "author_name?", p.body as "body?", p.patient_id as "patient_id?",
                  p.client_id as "client_id?", p.deleted_at as "deleted_at?",
                  p.created_at as "created_at?"
           from conv
           left join page p on true
           left join aarogyam.memberships am on am.org_id = conv.org_id and am.id = p.author_membership_id
           left join aarogyam.users u on u.id = am.user_id
           order by p.id"#,
        conversation_id,
        after,
        before,
        limit,
        reader.user_id,
        reader.actor_kind,
        reader.purpose,
        reader.request_id,
        reader.timezone
    )
    .fetch_all(conn)
    .await?;
    Ok(rows)
}

/// A message to post.
#[derive(Debug, Clone, Copy)]
pub struct NewMessage<'a> {
    /// The new message's id.
    pub id: Uuid,
    /// Where.
    pub conversation_id: Uuid,
    /// The caller's membership.
    pub author: Uuid,
    /// The checked text.
    pub body: &'a str,
    /// A patient it is about, which must be within `reach`.
    pub patient_id: Option<Uuid>,
    /// The author's idempotency key.
    pub client_id: Uuid,
    /// The member to narrow the patient to (`own` scope), or `None` for every patient.
    pub reach: Option<Uuid>,
}

/// Posts a message to a conversation the caller is in and that isn't archived, naming a
/// patient only within reach. When-posted on success; `None` when nothing was written (not in
/// it, archived, patient out of reach, or this client id was used already).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn post(
    conn: &mut PgConnection,
    message: NewMessage<'_>,
) -> Result<Option<OffsetDateTime>, DbError> {
    let at = sqlx::query_scalar!(
        r#"insert into aarogyam.chat_messages
             (id, conversation_id, author_membership_id, body, patient_id, client_id)
           select $1, c.id, $3, $4, $5, $6 from aarogyam.conversations c
           where c.id = $2 and c.archived_at is null
             and ($5::uuid is null
                  or exists (select 1 from aarogyam.patients p
                             where p.id = $5 and p.deleted_at is null
                               and app.patient_in_reach(p.id, $7)))
           on conflict (org_id, author_membership_id, client_id) do nothing
           returning created_at"#,
        message.id,
        message.conversation_id,
        message.author,
        message.body,
        message.patient_id,
        message.client_id,
        message.reach
    )
    .fetch_optional(conn)
    .await?;
    Ok(at)
}

/// A message the caller posted earlier with this client id.
#[derive(Debug, Clone)]
pub struct Posted {
    /// The message.
    pub id: Uuid,
    /// Where.
    pub conversation_id: Uuid,
    /// Its text; empty once deleted.
    pub body: Option<String>,
    /// The patient it names.
    pub patient_id: Option<Uuid>,
    /// When.
    pub created_at: OffsetDateTime,
}

/// The message the caller posted with `client_id`, if any.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn by_client_id(
    conn: &mut PgConnection,
    author: Uuid,
    client_id: Uuid,
) -> Result<Option<Posted>, DbError> {
    let row = sqlx::query_as!(
        Posted,
        r#"select id, conversation_id, body, patient_id, created_at from aarogyam.chat_messages
           where author_membership_id = $1 and client_id = $2"#,
        author,
        client_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Moves the caller's read pointer forward to `message` (never back). `false` when the
/// message isn't in that conversation or the caller isn't in it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn mark_read(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    message: Uuid,
    me: Uuid,
) -> Result<bool, DbError> {
    let found = sqlx::query_scalar!(
        r#"with target as (
             select m.id from aarogyam.chat_messages m where m.conversation_id = $1 and m.id = $2
           ), moved as (
             update aarogyam.conversation_members cm set last_read_message_id = t.id
             from target t
             where cm.conversation_id = $1 and cm.membership_id = $3 and cm.left_at is null
               and (cm.last_read_message_id is null or cm.last_read_message_id < t.id)
           )
           select exists (select 1 from target) as "found!""#,
        conversation_id,
        message,
        me
    )
    .fetch_one(conn)
    .await?;
    Ok(found)
}

/// Deletes the caller's own message: the text and patient go, the row stays as "deleted".
/// `false` when nothing changed (not theirs, not there, or deleted already).
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn delete(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    id: Uuid,
    me: Uuid,
) -> Result<bool, DbError> {
    let done = sqlx::query!(
        r#"update aarogyam.chat_messages set deleted_at = now(), body = null, patient_id = null
           where conversation_id = $1 and id = $2 and author_membership_id = $3
             and deleted_at is null"#,
        conversation_id,
        id,
        me
    )
    .execute(conn)
    .await?;
    Ok(done.rows_affected() == 1)
}

/// A message's author and whether it is deleted, if the caller can see it.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn author_of(
    conn: &mut PgConnection,
    conversation_id: Uuid,
    id: Uuid,
) -> Result<Option<(Uuid, bool)>, DbError> {
    let row = sqlx::query!(
        r#"select author_membership_id, deleted_at is not null as "deleted!"
           from aarogyam.chat_messages where conversation_id = $1 and id = $2"#,
        conversation_id,
        id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| (row.author_membership_id, row.deleted)))
}

/// The numbers the apps poll every minute.
#[derive(Debug, Clone, Copy)]
pub struct Badges {
    /// Unread messages from others in conversations the caller hasn't muted, at most the cap.
    pub chat_unread: i64,
    /// Unread notifications, as `notifications::unread_count` counts them; `None` without
    /// `appointments.read`.
    pub notifications_unread: Option<i64>,
}

/// Chat and notification unread counts in one statement. `notifications` is `None` when the
/// caller can't see notifications; otherwise the member to narrow to (`own` scope) or `None`
/// for every appointment, and the notification window in days. The notification count is the
/// same query as [`crate::notifications::unread_count`]; keep the two alike.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn badges(
    conn: &mut PgConnection,
    me: Uuid,
    cap: i64,
    notifications: Option<(Option<Uuid>, i32)>,
) -> Result<Badges, DbError> {
    let (reach, days) = notifications.unwrap_or((None, 0));
    let row = sqlx::query_as!(
        Badges,
        r#"select
             (select count(*) from (
                select 1 from aarogyam.conversation_members me
                join aarogyam.chat_messages m
                  on m.org_id = me.org_id and m.conversation_id = me.conversation_id
                where me.membership_id = $1 and me.left_at is null and not me.muted
                  and m.deleted_at is null and m.author_membership_id <> me.membership_id
                  and (me.last_read_message_id is null or m.id > me.last_read_message_id)
                limit $2) chat) as "chat_unread!",
             case when $3 then (select count(*) from (
                select 1 from aarogyam.staff_notifications n
                join aarogyam.appointments a on a.org_id = n.org_id and a.id = n.appointment_id
                where n.created_at > now() - make_interval(days => $5::int)
                  and app.practitioner_in_reach(a.practitioner_id, $4)
                  and not exists (select 1 from aarogyam.staff_notification_reads r
                                  where r.org_id = n.org_id and r.notification_id = n.id
                                    and r.membership_id = $1)
                limit $2) unread) end as "notifications_unread?""#,
        me,
        cap,
        notifications.is_some(),
        reach,
        days
    )
    .fetch_one(conn)
    .await?;
    Ok(row)
}
