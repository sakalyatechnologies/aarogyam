-- The owner decides what each role can see and do: a roles.manage permission, which scopes
-- each permission can be narrowed to, custom roles that start from a template and can be
-- removed when nobody uses them, and a record of every change to a role's access.
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('roles.manage', 'roles', 'Choose what each role can see and do');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'roles.manage', 'all' from aarogyam.role_templates t where t.key = 'owner';

-- Clinics that exist already: their owner role gets it too.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, 'roles.manage', 'all'
from aarogyam.roles r
where r.is_template and r.key = 'owner'
on conflict do nothing;

-- How far each permission can be narrowed. 'all' is always allowed.
alter table aarogyam.permissions
  add column scopes text[] not null default '{all}'
    check (scopes <@ array['all', 'own', 'assigned'] and 'all' = any (scopes));
update aarogyam.permissions set scopes = '{all,own,assigned}'
where key in ('patients.read', 'appointments.read', 'appointments.write',
              'clinical.read', 'clinical.write', 'prescriptions.issue');

-- A custom role remembers the template it started from, for "reset to default". Standard
-- roles are their own template (matched by key), so they leave this empty.
alter table aarogyam.roles add column template_id uuid references aarogyam.role_templates (id);
create index roles_template on aarogyam.roles (template_id) where template_id is not null;

-- Custom roles nobody uses can be removed. Removal keeps the row, so the change history and
-- old invitations still point at it, and frees the key for a new role.
alter table aarogyam.roles add column deleted_at timestamptz;
alter table aarogyam.roles drop constraint roles_org_id_key_key;
create unique index roles_key on aarogyam.roles (org_id, key) where deleted_at is null;
alter table aarogyam.roles add constraint roles_standard_stay check (deleted_at is null or not is_template);
comment on table aarogyam.roles is 'sensitivity=internal offline=read_only lifecycle=soft_delete';

-- Who changed a role's access, and what it was before and after: lists of
-- {"key": "patients.read", "scope": "all"}, sorted by key.
create table aarogyam.role_changes (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  role_id uuid not null,
  action text not null check (action in ('created', 'permissions_changed', 'deleted')),
  changed_by uuid not null references aarogyam.users (id),
  before jsonb not null default '[]' check (jsonb_typeof(before) = 'array'),
  after jsonb not null default '[]' check (jsonb_typeof(after) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, role_id) references aarogyam.roles (org_id, id)
);
create index role_changes_role on aarogyam.role_changes (org_id, role_id, created_at desc);
create index role_changes_changed_by on aarogyam.role_changes (changed_by);
comment on table aarogyam.role_changes is 'sensitivity=internal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.role_changes', 'append_only');
