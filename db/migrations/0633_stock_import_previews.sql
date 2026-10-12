-- Stock import: a clinic uploads a CSV (or Excel) list of items and opening stock, sees every
-- row checked (the errors with their row numbers), then commits the preview by its token.
-- The preview holds the checked rows only until it is committed or expires (24 hours); the
-- result of the commit is kept, so committing the same token again returns it instead of
-- receiving the stock twice. Only a SHA-256 of the token is stored. No patient data.
set local lock_timeout = '5s';

create table aarogyam.stock_import_previews (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  file_name text not null check (char_length(file_name) between 1 and 200),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes int not null check (size_bytes between 1 and 5242880),
  row_count int not null check (row_count between 1 and 2000),
  valid_rows int not null check (valid_rows >= 0),
  error_rows int not null check (error_rows >= 0),
  -- The rows that passed, as the commit will apply them. Null once the preview ends.
  rows jsonb check (jsonb_typeof(rows) = 'array'),
  -- [{row, field, message}] for the rows that failed.
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  status text not null default 'open' check (status in ('open', 'committed', 'expired')),
  -- What the commit did: counts, and rows skipped at commit time.
  result jsonb check (jsonb_typeof(result) = 'object'),
  committed_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, token_hash),
  check (valid_rows + error_rows = row_count),
  check ((status = 'open') = (rows is not null)),
  check ((status = 'committed') = (result is not null and committed_at is not null))
);
create index stock_import_previews_file on aarogyam.stock_import_previews (org_id, file_sha256)
  where status = 'committed';
create index stock_import_previews_open on aarogyam.stock_import_previews (org_id, expires_at)
  where status = 'open';
comment on table aarogyam.stock_import_previews is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.stock_import_previews', 'mutable');
insert into audit.audit_config (table_name, exclude) values
  ('aarogyam.stock_import_previews', '{rows,errors,token_hash}');
