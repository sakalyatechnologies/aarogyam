-- People who sign in, their devices and sessions. One user can belong to many clinics.
-- Supabase Auth owns credentials; `auth_uid` links to it.
set local lock_timeout = '5s';

create table aarogyam.users (
  id uuid primary key default app.uuid_v7(),
  auth_uid uuid not null unique,
  phone_e164 text unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email = lower(email) and email like '_%@_%'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  locale text not null default 'en-IN' check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table aarogyam.users is 'sensitivity=personal offline=server_only lifecycle=mutable';

create table aarogyam.devices (
  id uuid primary key default app.uuid_v7(),
  user_id uuid not null references aarogyam.users (id),
  platform text not null check (platform in ('android', 'ios', 'web')),
  model text,
  app_version text,
  push_token text,
  push_token_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index devices_user on aarogyam.devices (user_id);
comment on table aarogyam.devices is 'sensitivity=personal offline=server_only lifecycle=mutable';

create table aarogyam.sessions (
  id uuid primary key default app.uuid_v7(),
  user_id uuid not null references aarogyam.users (id),
  provider_session_id uuid not null unique,
  device_id uuid references aarogyam.devices (id),
  audience text not null check (audience in ('clinic', 'patient', 'platform')),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index sessions_user on aarogyam.sessions (user_id);
create index sessions_device on aarogyam.sessions (device_id) where device_id is not null;
comment on table aarogyam.sessions is 'sensitivity=personal offline=server_only lifecycle=ephemeral';

do $$
declare
  t text;
begin
  foreach t in array array['users', 'devices', 'sessions'] loop
    execute format('alter table aarogyam.%I enable row level security', t);
    execute format('create trigger set_row_times before insert or update on aarogyam.%I
                    for each row execute function app.set_row_times()', t);
    execute format('create trigger audit after insert or update or delete on aarogyam.%I
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.users', '{last_seen_at}', '{}'),
  ('aarogyam.devices', '{push_token_updated_at}', '{push_token}'),
  ('aarogyam.sessions', '{last_active_at}', '{}');

-- Inside a clinic transaction a user sees the names of people in the same clinic (for
-- "seen by Dr Rao"); phone and email stay hidden because only these columns are granted.
-- The policy is created with memberships (0008). Everything else goes through the lookups.
grant select (id, display_name, locale, status) on aarogyam.users to app_user;

grant select, insert, update on aarogyam.devices to app_user;
create policy own on aarogyam.devices to app_user
  using (user_id = (select app.user_id()))
  with check (user_id = (select app.user_id()));

grant select on aarogyam.sessions to app_user;
create policy own on aarogyam.sessions for select to app_user
  using (user_id = (select app.user_id()));
