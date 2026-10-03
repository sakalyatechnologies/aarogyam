-- Patients: each clinic's own record of a person. Two clinics never share a row.
set local lock_timeout = '5s';

create table aarogyam.referral_sources (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('patient', 'doctor', 'online', 'walk_in', 'camp', 'insurance', 'other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id)
);
comment on table aarogyam.referral_sources is 'sensitivity=personal offline=read_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.referral_sources', 'mutable');

create table aarogyam.patients (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  number text not null check (number ~ '^[A-Z]{1,3}-[0-9]{1,12}$'),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  search_name text not null generated always as (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))) stored,
  sex text not null default 'unknown' check (sex in ('female', 'male', 'other', 'unknown')),
  date_of_birth date check (date_of_birth >= date '1900-01-01'),
  birth_date_estimated boolean not null default false,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  alt_phone_e164 text check (alt_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email = lower(email) and email like '_%@_%'),
  address jsonb check (jsonb_typeof(address) = 'object'),
  preferred_language text not null default 'en-IN' check (preferred_language ~ '^[a-z]{2}-[A-Z]{2}$'),
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  referral_source_id uuid,
  referred_by_patient_id uuid,
  tags text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'inactive', 'deceased', 'merged')),
  merged_into_id uuid,
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  foreign key (org_id, referral_source_id) references aarogyam.referral_sources (org_id, id),
  foreign key (org_id, referred_by_patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, merged_into_id) references aarogyam.patients (org_id, id),
  check ((status = 'merged') = (merged_into_id is not null)),
  check (merged_into_id is distinct from id),
  check (not birth_date_estimated or date_of_birth is not null)
);
-- Numbers are never reused, deleted or not.
create unique index patients_number on aarogyam.patients (org_id, number);
create index patients_phone on aarogyam.patients (org_id, phone_e164) where deleted_at is null;
create index patients_alt_phone on aarogyam.patients (org_id, alt_phone_e164)
  where alt_phone_e164 is not null and deleted_at is null;
-- Name prefix search (search_name ^@ 'pri'); "C" collation lets the index serve it.
create index patients_name_prefix on aarogyam.patients (org_id, search_name collate "C") where deleted_at is null;
-- Fuzzy name search, used through app.search_patients().
create index patients_name_trgm on aarogyam.patients
  using gin (org_id, search_name extensions.gin_trgm_ops) where deleted_at is null;
create index patients_referral_source on aarogyam.patients (org_id, referral_source_id)
  where referral_source_id is not null;
create index patients_referred_by on aarogyam.patients (org_id, referred_by_patient_id)
  where referred_by_patient_id is not null;
create index patients_merged_into on aarogyam.patients (org_id, merged_into_id) where merged_into_id is not null;
comment on table aarogyam.patients is 'sensitivity=personal offline=read_write lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.patients', 'soft_delete');

-- Fuzzy name search for the current clinic. Trigram matching can't use the index under
-- row-level security, so this runs as the owner and filters by clinic itself.
create function app.search_patients(p_query text, p_limit int default 20)
  returns table (id uuid, number text, full_name text, sex text, date_of_birth date,
                 birth_date_estimated boolean, phone_e164 text, last_visit_at timestamptz, similarity real)
  language sql stable security definer set search_path = ''
  as $$
    select p.id, p.number, p.full_name, p.sex, p.date_of_birth, p.birth_date_estimated,
           p.phone_e164, p.last_visit_at,
           extensions.similarity(p.search_name, lower(btrim(p_query)))
    from aarogyam.patients p
    where p.org_id = app.tenant_id()
      and app.tenant_id() is not null
      and p.deleted_at is null
      and p.search_name operator(extensions.%) lower(btrim(p_query))
    order by 9 desc, p.full_name
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  $$;
grant execute on function app.search_patients(text, int) to app_user;
