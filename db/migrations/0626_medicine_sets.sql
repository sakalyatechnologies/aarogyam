-- A clinic's own medicine sets: several medicines added to a prescription in one tap, beside the
-- specialty's compiled-in sets (specialties/dental/quick-picks.json). The doctor creates, edits
-- and deletes them (prescriptions.issue); a deleted set is hidden, not removed, so the change
-- history keeps it. `items` is a JSON array of the same lines a prescription starts with
-- (drug_name, strength, form, dose, frequency, timing, duration_days, instructions); the API
-- checks every value, the table bounds the size. No patient data.
set local lock_timeout = '5s';

create table aarogyam.medicine_sets (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  label text not null check (char_length(label) between 1 and 80 and label = btrim(label)),
  items jsonb not null
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20
           and pg_column_size(items) <= 16384),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id)
);
-- A label is unique among the clinic's live sets, ignoring case.
create unique index medicine_sets_label on aarogyam.medicine_sets (org_id, lower(label))
  where deleted_at is null;
comment on table aarogyam.medicine_sets is 'sensitivity=internal offline=read_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.medicine_sets', 'soft_delete');
insert into audit.audit_config (table_name, exclude, mask, metadata_only) values
  ('aarogyam.medicine_sets', '{}', '{}', false);
