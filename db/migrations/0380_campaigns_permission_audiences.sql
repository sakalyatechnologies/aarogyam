-- Campaigns (docs/decisions.md, "Campaigns"): campaigns.manage (owners only) lets a clinic save
-- audiences and run campaigns. Direct sends to a few patients keep messages.send. An audience
-- is a name and one typed filter, evaluated when a campaign sends (app.audience_patients, 0382).
-- Only filters a clinic needs to reach patients it already looks after: no balance, treatment
-- or visit-kind filters (purpose limitation: that is health and money data, not marketing).
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('campaigns.manage', 'campaigns', 'Save audiences and run campaigns to patients');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'campaigns.manage', 'all' from aarogyam.role_templates t where t.key = 'owner';

-- Clinics that exist already got their standard roles from the templates; give owners the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null and tp.permission = 'campaigns.manage'
on conflict do nothing;

-- filter, by `kind`: all_active; last_visit {before?, after?} (dates; never visited matches
-- neither); birthday_month {month 1-12}; age_band {min, max} in years; sex {sex}; tag {tag}.
-- The API validates the shape; the table keeps the kind within the list.
create table aarogyam.audiences (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  filter jsonb not null check (
    jsonb_typeof(filter) = 'object' and octet_length(filter::text) <= 500
    and filter->>'kind' in ('all_active', 'last_visit', 'birthday_month', 'age_band', 'sex', 'tag')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id)
);
comment on table aarogyam.audiences is 'sensitivity=internal offline=server_only lifecycle=ephemeral';
-- Ephemeral: an audience no campaign uses can be deleted (the history keeps the deletion).
select app.protect_clinic_table('aarogyam.audiences', 'ephemeral');

-- It holds no patient: a filter and a name. Erasure has nothing to do here.
insert into audit.audit_config (table_name, exclude, mask, metadata_only) values
  ('aarogyam.audiences', '{}', '{}', false);
create policy no_support on aarogyam.audiences as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
