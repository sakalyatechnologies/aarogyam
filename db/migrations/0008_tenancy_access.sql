-- Permissions, roles, memberships and invitations.
set local lock_timeout = '5s';

-- The permission catalogue. Must match aarogyam_domain::Permission (a test checks both).
create table aarogyam.permissions (
  id uuid primary key default app.uuid_v7(),
  key text not null unique check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null check (module ~ '^[a-z_]+$'),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (split_part(key, '.', 1) = module)
);
comment on table aarogyam.permissions is 'sensitivity=internal offline=read_only lifecycle=mutable';

create table aarogyam.role_templates (
  id uuid primary key default app.uuid_v7(),
  key text not null unique check (key ~ '^[a-z_]{2,40}$'),
  name text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table aarogyam.role_templates is 'sensitivity=internal offline=server_only lifecycle=mutable';

create table aarogyam.role_template_permissions (
  role_template_id uuid not null references aarogyam.role_templates (id),
  permission text not null references aarogyam.permissions (key),
  scope text not null default 'all' check (scope in ('all', 'own', 'assigned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role_template_id, permission)
);
create index role_template_permissions_permission on aarogyam.role_template_permissions (permission);
comment on table aarogyam.role_template_permissions is 'sensitivity=internal offline=server_only lifecycle=ephemeral';

do $$
declare
  t text;
begin
  foreach t in array array['permissions', 'role_templates', 'role_template_permissions'] loop
    execute format('alter table aarogyam.%I enable row level security', t);
    execute format('create trigger set_row_times before insert or update on aarogyam.%I
                    for each row execute function app.set_row_times()', t);
    execute format('create trigger audit after insert or update or delete on aarogyam.%I
                    for each row execute function app.audit_row()', t);
    execute format('grant select on aarogyam.%I to app_user', t);
    execute format('create policy readable on aarogyam.%I for select to app_user using (true)', t);
  end loop;
end $$;

insert into aarogyam.permissions (key, module, description) values
  ('patients.read', 'patients', 'See patients and their records'),
  ('patients.write', 'patients', 'Register and edit patients'),
  ('patients.contact', 'patients', 'See full phone numbers and email addresses'),
  ('appointments.read', 'appointments', 'See the calendar and queue'),
  ('appointments.write', 'appointments', 'Book, move and cancel appointments'),
  ('clinical.read', 'clinical', 'See visits, notes, charts and files'),
  ('clinical.write', 'clinical', 'Record visits, notes, charts and files'),
  ('prescriptions.issue', 'prescriptions', 'Issue and cancel prescriptions'),
  ('billing.read', 'billing', 'See bills and payments'),
  ('billing.write', 'billing', 'Create bills and take payments'),
  ('finance.view', 'finance', 'See revenue, expenses and salaries'),
  ('staff.manage', 'staff', 'Invite staff and change their roles'),
  ('settings.manage', 'settings', 'Change clinic settings, branding and templates'),
  ('audit.view', 'audit', 'See the change history and access record'),
  ('reports.export', 'reports', 'Export data to Excel');

insert into aarogyam.role_templates (key, name, description) values
  ('owner', 'Owner', 'Runs the clinic: everything, including finance and staff'),
  ('doctor', 'Doctor', 'Sees patients, records visits and issues prescriptions'),
  ('consultant', 'Consultant', 'A visiting doctor who works on assigned patients'),
  ('front_desk', 'Front desk', 'Registers patients, books appointments, takes payments'),
  ('assistant', 'Assistant', 'Helps in the chair: sees the schedule and visits'),
  ('finance', 'Finance', 'Bills, payments and finance reports');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, p.permission, p.scope
from (values
  ('owner', 'patients.read', 'all'), ('owner', 'patients.write', 'all'), ('owner', 'patients.contact', 'all'),
  ('owner', 'appointments.read', 'all'), ('owner', 'appointments.write', 'all'),
  ('owner', 'clinical.read', 'all'), ('owner', 'clinical.write', 'all'), ('owner', 'prescriptions.issue', 'all'),
  ('owner', 'billing.read', 'all'), ('owner', 'billing.write', 'all'), ('owner', 'finance.view', 'all'),
  ('owner', 'staff.manage', 'all'), ('owner', 'settings.manage', 'all'), ('owner', 'audit.view', 'all'),
  ('owner', 'reports.export', 'all'),
  ('doctor', 'patients.read', 'all'), ('doctor', 'patients.write', 'all'), ('doctor', 'patients.contact', 'all'),
  ('doctor', 'appointments.read', 'all'), ('doctor', 'appointments.write', 'all'),
  ('doctor', 'clinical.read', 'all'), ('doctor', 'clinical.write', 'all'), ('doctor', 'prescriptions.issue', 'all'),
  ('doctor', 'billing.read', 'all'),
  ('consultant', 'patients.read', 'assigned'), ('consultant', 'appointments.read', 'own'),
  ('consultant', 'clinical.read', 'assigned'), ('consultant', 'clinical.write', 'assigned'),
  ('consultant', 'prescriptions.issue', 'assigned'),
  ('front_desk', 'patients.read', 'all'), ('front_desk', 'patients.write', 'all'), ('front_desk', 'patients.contact', 'all'),
  ('front_desk', 'appointments.read', 'all'), ('front_desk', 'appointments.write', 'all'),
  ('front_desk', 'billing.read', 'all'), ('front_desk', 'billing.write', 'all'),
  ('assistant', 'patients.read', 'all'), ('assistant', 'appointments.read', 'all'), ('assistant', 'clinical.read', 'all'),
  ('finance', 'patients.read', 'all'), ('finance', 'billing.read', 'all'), ('finance', 'billing.write', 'all'),
  ('finance', 'finance.view', 'all'), ('finance', 'reports.export', 'all')
) as p(template, permission, scope)
join aarogyam.role_templates t on t.key = p.template;

create table aarogyam.roles (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  key text not null check (key ~ '^[a-z_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  is_template boolean not null default false,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, key)
);
comment on table aarogyam.roles is 'sensitivity=internal offline=read_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.roles', 'mutable');

create table aarogyam.role_permissions (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  role_id uuid not null,
  permission text not null references aarogyam.permissions (key),
  scope text not null default 'all' check (scope in ('all', 'own', 'assigned')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, role_id, permission),
  foreign key (org_id, role_id) references aarogyam.roles (org_id, id)
);
create index role_permissions_permission on aarogyam.role_permissions (permission);
comment on table aarogyam.role_permissions is 'sensitivity=internal offline=read_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.role_permissions', 'ephemeral');

create table aarogyam.memberships (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  user_id uuid not null references aarogyam.users (id),
  role_id uuid not null,
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'left')),
  pin_hash text,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, user_id),
  foreign key (org_id, role_id) references aarogyam.roles (org_id, id)
);
create index memberships_user on aarogyam.memberships (user_id);
create index memberships_role on aarogyam.memberships (org_id, role_id);
comment on table aarogyam.memberships is 'sensitivity=internal offline=read_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.memberships', 'mutable');

create table aarogyam.membership_branches (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  membership_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, membership_id, branch_id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id)
);
create index membership_branches_branch on aarogyam.membership_branches (org_id, branch_id);
comment on table aarogyam.membership_branches is 'sensitivity=internal offline=read_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.membership_branches', 'ephemeral');

create table aarogyam.invitations (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email = lower(email) and email like '_%@_%'),
  role_id uuid not null,
  invited_by uuid references aarogyam.users (id),
  token_hash text not null check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, role_id) references aarogyam.roles (org_id, id),
  check (phone_e164 is not null or email is not null)
);
-- Looked up by token before the clinic is known (accepting an invite); the token is random,
-- so the index needs no uniqueness to be safe.
create index invitations_token on aarogyam.invitations (token_hash);
create index invitations_role on aarogyam.invitations (org_id, role_id);
create index invitations_invited_by on aarogyam.invitations (invited_by) where invited_by is not null;
comment on table aarogyam.invitations is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.invitations', 'mutable');

insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.memberships', '{}', '{pin_hash}'),
  ('aarogyam.invitations', '{}', '{token_hash}');

-- Names of people in the same clinic (columns limited by the grant in 0006).
create policy self_or_same_clinic on aarogyam.users for select to app_user
  using (
    id = (select app.user_id())
    or exists (select 1 from aarogyam.memberships m
               where m.user_id = users.id and m.org_id = (select app.tenant_id()))
  );
