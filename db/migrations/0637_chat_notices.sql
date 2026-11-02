-- Chat notices (docs/decisions.md, "Chat channels, notices and attachments"). A message may be
-- a notice: `is_notice`, posted only by someone whose role has `chat.notice` (the owner; a clinic
-- may give it to another role). The newest live notice of a conversation is pinned: the
-- conversation's detail returns it. The permission is checked in the API and again by an
-- insert policy, so a handler bug can't let anyone else post one.
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('chat.notice', 'chat', 'Post pinned notices in chat conversations');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'chat.notice', 'all' from aarogyam.role_templates t where t.key = 'owner';

-- Clinics that exist already got their standard roles from the templates; give those the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null and tp.permission = 'chat.notice'
on conflict do nothing;

alter table aarogyam.chat_messages add column is_notice boolean not null default false;
-- The pinned notice of a conversation is its newest live one.
create index chat_messages_notice on aarogyam.chat_messages (org_id, conversation_id, id desc)
  where is_notice and deleted_at is null;

-- Whether the caller's role has chat.notice in the current clinic.
create function app.chat_may_post_notice() returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from aarogyam.memberships m
      join aarogyam.role_permissions rp on rp.org_id = m.org_id and rp.role_id = m.role_id
      where m.org_id = app.tenant_id() and m.id = app.chat_member_id()
        and rp.permission = 'chat.notice')
  $$;
revoke execute on function app.chat_may_post_notice() from public;
grant execute on function app.chat_may_post_notice() to app_user;

create policy chat_notice_insert on aarogyam.chat_messages as restrictive for insert to app_user
  with check (not is_notice or (select app.chat_may_post_notice()));
