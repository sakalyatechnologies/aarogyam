-- A member's saved screen choices (docs/plans/present-studio-design.md §12.2): the Show patient
-- style ("Make default") and, later, the history view (history-views-design.md §3). One row per
-- member; null means the default (present_style story, history_view page). Written only by
-- PUT /me/ui-prefs, which updates the fields it is sent.
-- No patient data, so no erasure step. Support never reads it. Expand only: a new table.
set local lock_timeout = '5s';

create table aarogyam.member_ui_prefs (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  membership_id uuid not null,
  present_style text check (present_style in ('story', 'painted', 'xray', 'smile3d', 'face')),
  history_view text check (history_view in ('page', 'popup', 'story')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id)
);
create unique index member_ui_prefs_member
  on aarogyam.member_ui_prefs (org_id, membership_id);
comment on table aarogyam.member_ui_prefs is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.member_ui_prefs', 'mutable');
create policy no_support on aarogyam.member_ui_prefs as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
