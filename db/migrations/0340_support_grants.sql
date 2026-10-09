-- Support grants (docs/decisions.md, "Support grants"): a clinic owner lets one named Sakalya
-- staff member read the clinic's records, for a stated reason, from now until an end at most
-- 7 days away. The owner can revoke it early; it ends by itself. Platform staff can't hold
-- clinic memberships (0172), so this is the only way for staff to look inside a clinic.
--
-- support.grant (owner by default) creates, lists and revokes grants. Every request made under
-- a grant is recorded in audit.support_actions with the grant's id (0341 writes it).
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('support.grant', 'support', 'Let a named Sakalya staff member read the clinic''s records for up to 7 days');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'support.grant', 'all' from aarogyam.role_templates t where t.key = 'owner';

-- Owners of clinics that exist already get it too.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null and tp.permission = 'support.grant'
on conflict do nothing;

create table aarogyam.support_grants (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- The staff member, by their platform record: a grant names one person, never "any agent".
  platform_user_id uuid not null references aarogyam.platform_users (id),
  -- What the grant allows. Only reading for now (docs/decisions.md).
  access text not null default 'read' check (access in ('read')),
  reason text not null check (char_length(reason) between 3 and 500 and reason = btrim(reason)),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  granted_by uuid not null,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, granted_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, revoked_by) references aarogyam.memberships (org_id, id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '7 days'),
  check ((revoked_at is null) = (revoked_by is null))
);
create index support_grants_staff on aarogyam.support_grants (platform_user_id, ends_at desc);
create index support_grants_recent on aarogyam.support_grants (org_id, created_at desc);
create index support_grants_granted_by on aarogyam.support_grants (org_id, granted_by);
create index support_grants_revoked_by on aarogyam.support_grants (org_id, revoked_by)
  where revoked_by is not null;
comment on table aarogyam.support_grants is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.support_grants', 'mutable');

-- A grant changes once, when it is revoked: nothing else about it ever changes.
create function app.guard_support_grant() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if old.revoked_at is null and new.revoked_at is not null
       and (to_jsonb(new) - array['revoked_at', 'revoked_by', 'updated_at', 'updated_by'])
         = (to_jsonb(old) - array['revoked_at', 'revoked_by', 'updated_at', 'updated_by']) then
      return new;
    end if;
    raise exception 'a support grant only changes when it is revoked'
      using errcode = 'insufficient_privilege';
  end
  $$;
create trigger guard before update on aarogyam.support_grants
  for each row execute function app.guard_support_grant();

-- What staff did under a grant: one row per request, with the method and the route template
-- (never a value from the path or body). Written by app.support_authorize only; the clinic
-- reads its own rows.
create table audit.support_actions (
  org_id uuid not null,
  at timestamptz not null default now(),
  id uuid not null default app.uuid_v7(),
  grant_id uuid not null,
  user_id uuid not null,
  method text not null check (method ~ '^[A-Z]{3,7}$'),
  route text not null check (char_length(route) between 1 and 200),
  request_id text,
  primary key (org_id, at, id)
) partition by range (at);
create index support_actions_grant on audit.support_actions (org_id, grant_id, at desc);
comment on table audit.support_actions is 'sensitivity=internal offline=server_only lifecycle=append_only';
alter table audit.support_actions enable row level security;
create policy same_clinic on audit.support_actions for select to app_user
  using (org_id = (select app.tenant_id()));
create policy patient_account on audit.support_actions as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'patient_account');
grant select on audit.support_actions to app_user;
create trigger forbid_change before update or delete on audit.support_actions
  for each row execute function app.forbid_change();
select app.ensure_partitions('audit.support_actions');
