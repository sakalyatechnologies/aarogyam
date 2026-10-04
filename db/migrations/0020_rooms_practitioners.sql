-- Chairs and rooms, the doctors who see patients, their weekly hours and their leave.
set local lock_timeout = '5s';

create table aarogyam.rooms (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  branch_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null default 'chair' check (kind in ('chair', 'room', 'lab')),
  active boolean not null default true,
  sort_order smallint not null default 0 check (sort_order between 0 and 999),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id)
);
create unique index rooms_name on aarogyam.rooms (org_id, branch_id, lower(name)) where deleted_at is null;
create index rooms_branch on aarogyam.rooms (org_id, branch_id);
comment on table aarogyam.rooms is 'sensitivity=internal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.rooms', 'soft_delete');

-- A doctor who sees patients. Usually a member of staff; a visiting consultant without a
-- sign-in has no membership.
create table aarogyam.practitioners (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  membership_id uuid,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  registration_number text check (char_length(btrim(registration_number)) between 1 and 40),
  specialty text check (char_length(btrim(specialty)) between 1 and 80),
  calendar_color text not null default '#136650' check (calendar_color ~ '^#[0-9A-F]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id)
);
-- One practitioner per member.
create unique index practitioners_membership on aarogyam.practitioners (org_id, membership_id)
  where membership_id is not null and deleted_at is null;
create index practitioners_membership_fk on aarogyam.practitioners (org_id, membership_id)
  where membership_id is not null;
comment on table aarogyam.practitioners is 'sensitivity=personal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.practitioners', 'soft_delete');

-- Weekly hours. Split shifts are two rows. Replaced as a whole, so rows are ephemeral.
create table aarogyam.working_hours (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  practitioner_id uuid not null,
  branch_id uuid not null,
  -- ISO weekday: 1 Monday to 7 Sunday.
  weekday smallint not null check (weekday between 1 and 7),
  starts time not null,
  ends time not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, practitioner_id) references aarogyam.practitioners (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id),
  check (starts < ends)
);
create index working_hours_practitioner on aarogyam.working_hours (org_id, practitioner_id, weekday);
create index working_hours_branch on aarogyam.working_hours (org_id, branch_id);
comment on table aarogyam.working_hours is 'sensitivity=internal offline=read_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.working_hours', 'ephemeral');

-- Time a doctor is away. Booking into it is allowed with a warning.
create table aarogyam.leave_blocks (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  practitioner_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text check (char_length(btrim(reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, practitioner_id) references aarogyam.practitioners (org_id, id),
  check (starts_at < ends_at),
  check (ends_at - starts_at <= interval '366 days')
);
create index leave_blocks_practitioner on aarogyam.leave_blocks (org_id, practitioner_id, starts_at);
create index leave_blocks_starts on aarogyam.leave_blocks (org_id, starts_at);
comment on table aarogyam.leave_blocks is 'sensitivity=internal offline=read_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.leave_blocks', 'ephemeral');
