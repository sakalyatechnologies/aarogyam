-- Pictures on a clinic's website: logo, hero, about, doctors, gallery. The bytes live in file
-- storage under `<org_id>/<id>`, made by the server; this row says what the file is. These are
-- public pictures chosen by the clinic, kept apart from patient files (`attachments`).
set local lock_timeout = '5s';

create table aarogyam.website_photos (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- Where it is used: the logo, the top picture, the about section, a doctor, or the gallery.
  kind text not null default 'gallery' check (kind in ('logo', 'hero', 'about', 'doctor', 'gallery')),
  storage_key text not null check (storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null check (size_bytes between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- What the picture shows, for people who cannot see it.
  alt text check (char_length(btrim(alt)) between 1 and 200),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id)
);
create unique index website_photos_storage_key on aarogyam.website_photos (org_id, storage_key);
create index website_photos_kind on aarogyam.website_photos (org_id, kind, sort_order, created_at);
comment on table aarogyam.website_photos is 'sensitivity=public offline=none lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.website_photos', 'ephemeral');
