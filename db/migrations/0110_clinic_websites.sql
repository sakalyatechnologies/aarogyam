-- A clinic's public website: which layout, template, palette and font pairing it uses, the
-- text the owner wrote, and whether it is published. One row per clinic, created when the
-- owner first opens Settings -> Website. The row holds only public content; the clinic's name,
-- doctors, price list, hours and address are read from their own tables when a page is shown.
--
-- `custom_domain` and its verification fields are filled in by the domain step; nothing
-- resolves a custom domain yet (hosting comes with the product domain). A domain is claimed
-- globally only when it is verified and moves to `org_domains`, which is unique across clinics.
set local lock_timeout = '5s';

create table aarogyam.clinic_websites (
  org_id uuid primary key default app.tenant_id() references aarogyam.organizations (id),
  -- `one` page with every section, or `multi` pages (home, about, services, gallery, contact).
  layout text not null default 'one' check (layout in ('one', 'multi')),
  -- Which design, colour palette and font pairing. The API checks the palette against the
  -- template; the database only checks the shape, so a new design needs no migration.
  template text not null default 'aurora' check (template ~ '^[a-z][a-z0-9]{2,19}$'),
  palette text not null default 'gold' check (palette ~ '^[a-z][a-z0-9]{2,19}$'),
  fonts text not null default 'modern' check (fonts ~ '^[a-z][a-z0-9]{2,19}$'),
  -- Section text, doctor profiles, hidden services, reviews, social links. Validated by the API.
  content jsonb not null default '{}' check (jsonb_typeof(content) = 'object'),
  published boolean not null default false,
  published_at timestamptz,
  -- A domain the clinic owns, lower case, and where its verification stands.
  custom_domain text check (custom_domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
                            and char_length(custom_domain) <= 253),
  domain_status text not null default 'none' check (domain_status in ('none', 'pending', 'verified', 'failed')),
  -- The value of the TXT record the owner adds to prove they control the domain.
  domain_token text check (domain_token ~ '^[a-z0-9-]{16,64}$'),
  domain_checked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check ((custom_domain is null) = (domain_status = 'none')),
  check (not published or published_at is not null)
);
comment on table aarogyam.clinic_websites is 'sensitivity=public offline=none lifecycle=mutable';
select app.protect_clinic_table('aarogyam.clinic_websites', 'mutable');
