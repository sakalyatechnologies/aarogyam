-- Chat attachments (docs/decisions.md, "Chat channels, notices and attachments"): a message may
-- carry one file, an image (JPEG or PNG) or a PDF of at most 5 MB, the type read from its
-- content. The bytes live in the same file storage as patient files, under `<clinic>/<id>`;
-- only members of the conversation get a download link, and the link is bound to the member and
-- checked against their membership again when it is opened. The row names no patient and no
-- file path; the file name is masked in the change history. A message may be attachment-only
-- (`has_attachment`, no text). Kept 365 days like the message (retention class chat_attachments).
set local lock_timeout = '5s';

alter table aarogyam.chat_messages add column has_attachment boolean not null default false;
-- Live: text or a file; deleted: no text.
alter table aarogyam.chat_messages drop constraint chat_messages_check;
alter table aarogyam.chat_messages add constraint chat_messages_text_or_file
  check ((deleted_at is null and (body is not null or has_attachment))
         or (deleted_at is not null and body is null));

create table aarogyam.chat_attachments (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  -- Also the name of the bytes in storage: <org_id>/<id>.
  id uuid not null default app.uuid_v7(),
  conversation_id uuid not null,
  message_id uuid not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- The name the sender's device gave it, tidied; shown, never used as a path.
  file_name text check (char_length(btrim(file_name)) between 1 and 120),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, message_id),
  foreign key (org_id, conversation_id, message_id)
    references aarogyam.chat_messages (org_id, conversation_id, id)
);
-- Also the index of the key to the message (and a conversation's files).
create index chat_attachments_message on aarogyam.chat_attachments (org_id, conversation_id, message_id);
comment on table aarogyam.chat_attachments is 'sensitivity=health offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.chat_attachments', 'soft_delete');
revoke update on aarogyam.chat_attachments from app_user;
grant update (deleted_at) on aarogyam.chat_attachments to app_user;
insert into audit.audit_config (table_name, mask) values ('aarogyam.chat_attachments', '{file_name}');

-- Only members of the conversation see it; only the message's author adds or removes the file.
create policy chat_member on aarogyam.chat_attachments as restrictive for select to app_user
  using (conversation_id = any ((select app.chat_conversation_ids())::uuid[]));
create policy chat_member_insert on aarogyam.chat_attachments as restrictive for insert to app_user
  with check (conversation_id = any ((select app.chat_conversation_ids())::uuid[])
              and exists (select 1 from aarogyam.chat_messages m
                          where m.org_id = chat_attachments.org_id and m.id = chat_attachments.message_id
                            and m.author_membership_id = (select app.chat_member_id())));
create policy chat_member_update on aarogyam.chat_attachments as restrictive for update to app_user
  using (conversation_id = any ((select app.chat_conversation_ids())::uuid[])
         and exists (select 1 from aarogyam.chat_messages m
                     where m.org_id = chat_attachments.org_id and m.id = chat_attachments.message_id
                       and m.author_membership_id = (select app.chat_member_id())));

-- Erasing a patient (0345): a file in a message that names the patient may show them, so its row
-- goes before the message loses its patient reference (step 100, 0392). Its bytes in storage are
-- unreachable from then on; sweeping them is in the backlog, as for patient files.
insert into audit.erasure_steps (table_name, step_order, action, filter, note) values
  ('aarogyam.chat_attachments', 99, 'delete',
   'message_id in (select m.id from aarogyam.chat_messages m where m.patient_id = $2)',
   'files in chat messages about the patient; bytes in storage are swept later (backlog)');
