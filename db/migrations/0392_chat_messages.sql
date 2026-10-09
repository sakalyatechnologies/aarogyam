-- Staff chat messages (0391 has the conversations): plain text of 1 to 4000 characters, at most
-- one patient referenced by id, deleted (body cleared) only by the author. A message with a
-- patient opens an access-record entry when fetched (resource `chat`, once per member, patient,
-- conversation and day). Bodies never reach the change history, logs or the access record.
set local lock_timeout = '5s';

create table aarogyam.chat_messages (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  conversation_id uuid not null,
  author_membership_id uuid not null,
  body text check (char_length(btrim(body)) >= 1 and char_length(body) <= 4000),
  patient_id uuid,
  -- Chosen by the client, so a retried send doesn't post twice.
  client_id uuid not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, author_membership_id, client_id),
  foreign key (org_id, conversation_id) references aarogyam.conversations (org_id, id),
  foreign key (org_id, author_membership_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  check ((deleted_at is null) = (body is not null)),
  check (deleted_at is null or patient_id is null)
);
-- Cursor paging within a conversation (ids are version 7 UUIDs, so they sort by time); also the
-- target of the members' read pointer, which must be in the same conversation.
create unique index chat_messages_conversation on aarogyam.chat_messages (org_id, conversation_id, id);
create index chat_messages_patient on aarogyam.chat_messages (org_id, patient_id)
  where patient_id is not null;
comment on table aarogyam.chat_messages is 'sensitivity=health offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.chat_messages', 'soft_delete');
revoke update on aarogyam.chat_messages from app_user;
grant update (body, patient_id, deleted_at) on aarogyam.chat_messages to app_user;
insert into audit.audit_config (table_name, mask) values ('aarogyam.chat_messages', '{body}');

create policy chat_member on aarogyam.chat_messages as restrictive for select to app_user
  using (conversation_id = any ((select app.chat_conversation_ids())::uuid[]));
create policy chat_member_insert on aarogyam.chat_messages as restrictive for insert to app_user
  with check (conversation_id = any ((select app.chat_conversation_ids())::uuid[])
              and author_membership_id = (select app.chat_member_id()));
-- Only the author deletes, while still in the conversation.
create policy chat_member_update on aarogyam.chat_messages as restrictive for update to app_user
  using (conversation_id = any ((select app.chat_conversation_ids())::uuid[])
         and author_membership_id = (select app.chat_member_id()));

alter table aarogyam.conversation_members
  add constraint conversation_members_last_read_fk
    foreign key (org_id, conversation_id, last_read_message_id)
    references aarogyam.chat_messages (org_id, conversation_id, id);
create index conversation_members_last_read
  on aarogyam.conversation_members (org_id, conversation_id, last_read_message_id)
  where last_read_message_id is not null;

alter table audit.access_log drop constraint access_log_resource_check;
alter table audit.access_log add constraint access_log_resource_check
  check (resource in ('chart', 'visit', 'note', 'attachment', 'prescription', 'invoice', 'export',
                      'appointment', 'chat'));

-- Erasure keeps the message (other staff's conversation) and drops the patient reference. The
-- text may name the patient; it goes with the chat retention (365 days).
insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.chat_messages', 100, 'update', 'patient_id = null', 'staff chat: the patient reference goes');
