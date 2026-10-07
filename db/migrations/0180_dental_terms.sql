-- A clinic's own dental terms: procedures and materials it added beside the seeded vocabulary
-- in specialties/dental/vocabulary.json. Chart entries (specialty_records.data) name a term by
-- id: a seeded id such as 'zirconia', or one of these rows' UUIDs. Labels are unique per list,
-- ignoring case, so "Add new" twice finds the same term.
set local lock_timeout = '5s';

create table aarogyam.dental_terms (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  kind text not null check (kind in ('procedure', 'material')),
  label text not null check (char_length(label) between 1 and 80 and label = btrim(label)),
  added_by uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, added_by) references aarogyam.memberships (org_id, id)
);
create unique index dental_terms_label on aarogyam.dental_terms (org_id, kind, lower(label));
create index dental_terms_added_by on aarogyam.dental_terms (org_id, added_by);
comment on table aarogyam.dental_terms is 'sensitivity=internal offline=read_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.dental_terms', 'append_only');
