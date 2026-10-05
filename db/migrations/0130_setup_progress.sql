-- First-run setup ("Finish setting up"): where the clinic's owner and each member stand in the
-- short onboarding wizard. `steps` maps a step key to `done` or `skipped`; a step with no entry
-- is still to do. The API validates the keys and values, so a new step needs no migration.
-- Clinics that existed before the wizard are marked dismissed so nobody is nagged.
set local lock_timeout = '5s';

create table aarogyam.clinic_setup (
  org_id uuid primary key default app.tenant_id() references aarogyam.organizations (id),
  -- How the clinic practises: `solo`, `team` or `multi` (several doctors).
  practice text check (practice in ('solo', 'team', 'multi')),
  steps jsonb not null default '{}' check (jsonb_typeof(steps) = 'object'),
  dismissed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table aarogyam.clinic_setup is 'sensitivity=internal offline=none lifecycle=mutable';
select app.protect_clinic_table('aarogyam.clinic_setup', 'mutable');

create table aarogyam.member_setup (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  membership_id uuid not null,
  steps jsonb not null default '{}' check (jsonb_typeof(steps) = 'object'),
  dismissed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, membership_id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id)
);
comment on table aarogyam.member_setup is 'sensitivity=internal offline=none lifecycle=mutable';
select app.protect_clinic_table('aarogyam.member_setup', 'mutable');

insert into aarogyam.clinic_setup (org_id, dismissed_at)
select id, now() from aarogyam.organizations;
