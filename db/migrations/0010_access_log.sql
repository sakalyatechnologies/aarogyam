-- The access record: who opened which patient's record, why, when and from which device.
-- A record the product shows to clinics and patients, not an application log. Written by
-- the API in the same transaction as the read. No foreign keys, so it never blocks erasure.
set local lock_timeout = '5s';

create table audit.access_log (
  org_id uuid not null default app.tenant_id(),
  at timestamptz not null default now(),
  id uuid not null default app.uuid_v7(),
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('staff', 'patient', 'support')),
  patient_id uuid not null,
  share_link_id uuid,
  resource text not null check (resource in ('chart', 'note', 'attachment', 'prescription', 'invoice', 'export')),
  resource_id uuid,
  action text not null check (action in ('view', 'download', 'print', 'share', 'export')),
  purpose text not null check (purpose in ('care', 'front_desk', 'billing', 'support', 'patient_self', 'export')),
  device_id uuid,
  request_id text,
  primary key (org_id, at, id),
  check (actor_user_id is not null or share_link_id is not null)
) partition by range (at);
create index access_log_patient on audit.access_log (org_id, patient_id, at desc);
comment on table audit.access_log is 'sensitivity=health offline=server_only lifecycle=append_only';

alter table audit.access_log enable row level security;
create policy same_clinic on audit.access_log to app_user
  using (org_id = (select app.tenant_id()))
  with check (org_id = (select app.tenant_id()));
grant select, insert on audit.access_log to app_user;
create trigger forbid_change before update or delete on audit.access_log
  for each row execute function app.forbid_change();

select app.ensure_partitions('audit.access_log');
