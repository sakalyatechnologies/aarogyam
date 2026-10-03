-- The clinic (tenant), its host names, branches and settings.
set local lock_timeout = '5s';

create table aarogyam.organizations (
  id uuid primary key default app.uuid_v7(),
  -- The subdomain. Same rules as sakalya_types::Slug, minus names the platform uses itself.
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' and slug not like '%--%')
    check (slug not in ('www', 'api', 'app', 'console', 'admin', 'auth', 'login', 'mail', 'status',
                        'docs', 'help', 'support', 'static', 'assets', 'cdn', 'staging', 'dev', 'test')),
  name text not null check (char_length(name) between 1 and 200),
  legal_name text check (char_length(legal_name) between 1 and 200),
  number_prefix text not null check (number_prefix ~ '^[A-Z]{1,3}$'),
  specialty text not null default 'dental' check (specialty in ('dental', 'general')),
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'churned')),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table aarogyam.organizations is 'sensitivity=internal offline=read_only lifecycle=mutable';

create table aarogyam.org_domains (
  id uuid primary key default app.uuid_v7(),
  org_id uuid not null references aarogyam.organizations (id),
  hostname text not null unique
    check (hostname = lower(hostname) and hostname ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
           and char_length(hostname) <= 253 and hostname not like '%..%'),
  kind text not null check (kind in ('portal', 'website')),
  is_primary boolean not null default false,
  cloudflare_hostname_id text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index org_domains_org on aarogyam.org_domains (org_id);
create unique index org_domains_one_primary on aarogyam.org_domains (org_id, kind) where is_primary;
comment on table aarogyam.org_domains is 'sensitivity=internal offline=server_only lifecycle=mutable';

do $$
declare
  t text;
begin
  foreach t in array array['organizations', 'org_domains'] loop
    execute format('alter table aarogyam.%I enable row level security', t);
    execute format('create trigger set_row_times before insert or update on aarogyam.%I
                    for each row execute function app.set_row_times()', t);
    execute format('create trigger audit after insert or update or delete on aarogyam.%I
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- Members read their own clinic's row and domains. Clinics are created and changed only
-- through the console's functions.
grant select on aarogyam.organizations, aarogyam.org_domains to app_user;
create policy own_clinic on aarogyam.organizations for select to app_user
  using (id = (select app.tenant_id()));
create policy own_clinic on aarogyam.org_domains for select to app_user
  using (org_id = (select app.tenant_id()));

create table aarogyam.branches (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' and slug not like '%--%'),
  name text not null check (char_length(name) between 1 and 200),
  address jsonb not null default '{}' check (jsonb_typeof(address) = 'object'),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code text check (state_code ~ '^[0-9]{2}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id)
);
create unique index branches_slug on aarogyam.branches (org_id, slug) where deleted_at is null;
create unique index branches_one_default on aarogyam.branches (org_id) where is_default and deleted_at is null;
comment on table aarogyam.branches is 'sensitivity=internal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.branches', 'soft_delete');

create table aarogyam.org_settings (
  org_id uuid primary key default app.tenant_id() references aarogyam.organizations (id),
  branding jsonb not null default '{}' check (jsonb_typeof(branding) = 'object'),
  billing jsonb not null default '{}' check (jsonb_typeof(billing) = 'object'),
  prescription jsonb not null default '{}' check (jsonb_typeof(prescription) = 'object'),
  notifications jsonb not null default '{}' check (jsonb_typeof(notifications) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table aarogyam.org_settings is 'sensitivity=internal offline=read_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.org_settings', 'mutable');
