-- The doctor's message ticks and hand-off count (docs/plans/visit-story-v2-offers-design.md
-- §1.6). One row per member: the sections they leave ticked on the Done screen, saved on Send
-- (POST /visits/{id}/patient-message with `sections`) or by PUT /me/message-prefs, never by
-- toggling or previewing; and how often they handed a summary to WhatsApp
-- (POST /visits/{id}/patient-message/handed-off). "Handed off" is never "sent".
--   * sections: null until the member saves ticks, which means every section.
--   * handoff_days goes up once per clinic day (last_handoff_on).
--   * No auto-send columns until that phase is decided (m13).
-- No patient data, so no erasure step. Support never reads it. Expand only: a new table.
set local lock_timeout = '5s';

create table aarogyam.member_message_prefs (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  membership_id uuid not null,
  sections text[] check (sections <@ array['done', 'detail', 'found', 'plan', 'medicines',
                                          'care', 'offer', 'video']::text[]),
  handoffs integer not null default 0 check (handoffs >= 0),
  handoff_days integer not null default 0 check (handoff_days >= 0),
  last_handoff_on date,
  template_version text check (char_length(template_version) between 1 and 40),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id)
);
create unique index member_message_prefs_member
  on aarogyam.member_message_prefs (org_id, membership_id);
comment on table aarogyam.member_message_prefs is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.member_message_prefs', 'mutable');
create policy no_support on aarogyam.member_message_prefs as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
