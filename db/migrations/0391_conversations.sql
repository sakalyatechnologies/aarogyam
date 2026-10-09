-- Staff chat (docs/decisions.md, "Staff chat"): conversations, one to one (`direct`) or in a
-- group, and who is in them. Messages are in 0392. Only a conversation's active members see it:
-- a restrictive policy on every chat table asks app.chat_conversation_ids(), the conversations the
-- caller is in now (active clinic membership, not left). Deactivated staff and leavers lose access.
set local lock_timeout = '5s';

create table aarogyam.conversations (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  kind text not null check (kind in ('direct', 'group')),
  title text check (char_length(btrim(title)) between 1 and 80),
  -- The two memberships of a direct conversation, smaller first: one conversation per pair.
  direct_key text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind = 'group' or title is null)
);
create unique index conversations_direct on aarogyam.conversations (org_id, direct_key)
  where kind = 'direct';
comment on table aarogyam.conversations is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.conversations', 'mutable');
revoke update on aarogyam.conversations from app_user;
grant update (title, archived_at) on aarogyam.conversations to app_user;

create table aarogyam.conversation_members (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  conversation_id uuid not null,
  membership_id uuid not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  muted boolean not null default false,
  -- The newest message this member has read (0392 adds its key); unread counts start after it.
  last_read_message_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, conversation_id, membership_id),
  foreign key (org_id, conversation_id) references aarogyam.conversations (org_id, id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id)
);
-- "My conversations": the list and the policy start here.
create index conversation_members_member on aarogyam.conversation_members (org_id, membership_id)
  where left_at is null;
comment on table aarogyam.conversation_members is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.conversation_members', 'mutable');
revoke update on aarogyam.conversation_members from app_user;
grant update (role, joined_at, left_at, muted, last_read_message_id)
  on aarogyam.conversation_members to app_user;
-- Moving the read pointer is not a change worth a history row.
insert into audit.audit_config (table_name, exclude) values
  ('aarogyam.conversation_members', '{last_read_message_id}');

-- The caller's active membership in the current clinic, if any. A definer so the chat policies
-- can ask without recursing into themselves.
create function app.chat_member_id() returns uuid
  language sql stable security definer set search_path = ''
  as $$
    select m.id from aarogyam.memberships m
    join aarogyam.users u on u.id = m.user_id
    where m.org_id = app.tenant_id() and m.user_id = app.user_id()
      and m.status = 'active' and u.status = 'active'
  $$;

-- The conversations the caller is in now; `admin_only` narrows to those they administer.
-- Policies call it once per statement through `(select ...)`.
create function app.chat_conversation_ids(admin_only boolean default false) returns uuid[]
  language sql stable security definer set search_path = ''
  as $$
    select coalesce(array_agg(cm.conversation_id), '{}')
    from aarogyam.conversation_members cm
    where cm.org_id = app.tenant_id() and cm.membership_id = app.chat_member_id()
      and cm.left_at is null and (not admin_only or cm.role = 'admin')
  $$;

-- Whether the caller may add members to a conversation: they administer it, or they just
-- created it and nobody is in it yet (the creating transaction's first insert).
create function app.chat_may_add(p_conversation_id uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select p_conversation_id = any (app.chat_conversation_ids(true))
        or exists (select 1 from aarogyam.conversations c
                   where c.org_id = app.tenant_id() and c.id = p_conversation_id
                     and c.created_by = app.user_id() and app.chat_member_id() is not null
                     and not exists (select 1 from aarogyam.conversation_members cm
                                     where cm.org_id = c.org_id and cm.conversation_id = c.id))
  $$;
revoke execute on function app.chat_member_id(), app.chat_conversation_ids(boolean),
  app.chat_may_add(uuid) from public;
grant execute on function app.chat_member_id(), app.chat_conversation_ids(boolean),
  app.chat_may_add(uuid) to app_user;

-- Whether a conversation has had any members yet; false only inside the transaction creating it.
create function app.chat_has_members(p_conversation_id uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (select 1 from aarogyam.conversation_members cm
                   where cm.org_id = app.tenant_id() and cm.conversation_id = p_conversation_id)
  $$;
revoke execute on function app.chat_has_members(uuid) from public;
grant execute on function app.chat_has_members(uuid) to app_user;

-- Its creator also sees a conversation before anyone is in it, which the insert's conflict check
-- (one direct conversation per pair) needs.
create policy chat_member on aarogyam.conversations as restrictive for select to app_user
  using (id = any ((select app.chat_conversation_ids())::uuid[])
         or (created_by = (select app.user_id()) and not app.chat_has_members(id)));
create policy chat_member_update on aarogyam.conversations as restrictive for update to app_user
  using (id = any ((select app.chat_conversation_ids())::uuid[]));
create policy chat_member_insert on aarogyam.conversations as restrictive for insert to app_user
  with check ((select app.chat_member_id()) is not null);

create policy chat_member on aarogyam.conversation_members as restrictive for select to app_user
  using (conversation_id = any ((select app.chat_conversation_ids())::uuid[]));
-- A member changes their own row (read pointer, mute, leaving); an admin anyone's.
create policy chat_member_update on aarogyam.conversation_members as restrictive for update
  to app_user
  using (conversation_id = any ((select app.chat_conversation_ids())::uuid[])
         and (membership_id = (select app.chat_member_id())
              or conversation_id = any ((select app.chat_conversation_ids(true))::uuid[])));
create policy chat_member_insert on aarogyam.conversation_members as restrictive for insert
  to app_user
  with check (app.chat_may_add(conversation_id));
