-- The Today board's layout (docs/decisions.md, "Dashboard layout"): versioned JSON, v2, checked
-- by the API against the widget registry in aarogyam-domain. One row per clinic holds the
-- clinic's default (membership_id is null); one row per member holds that member's own layout
-- for this clinic, so it follows them across devices. No row means the next level applies: the
-- member's row, then the clinic's, then the built-in template. Resetting deletes the row, so
-- the table is ephemeral. Layouts hold no patient data (no erasure step, no retention class).
set local lock_timeout = '5s';

create table aarogyam.dashboard_layouts (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- Null for the clinic's default.
  membership_id uuid,
  layout jsonb not null
    check (jsonb_typeof(layout) = 'object' and layout -> 'v' = '2'::jsonb
           and pg_column_size(layout) <= 16384),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id)
);
create unique index dashboard_layouts_clinic on aarogyam.dashboard_layouts (org_id)
  where membership_id is null;
create unique index dashboard_layouts_member on aarogyam.dashboard_layouts (org_id, membership_id)
  where membership_id is not null;
comment on table aarogyam.dashboard_layouts is 'sensitivity=internal offline=read_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.dashboard_layouts', 'ephemeral');
