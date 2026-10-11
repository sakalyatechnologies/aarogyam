-- Staff time off: a request from a member, decided by the owner (docs/decisions.md, "Staff
-- operations"). `leave_blocks` stays the only thing availability reads: approving a request for
-- someone with a practitioner row adds a leave block (reason "Time off", never the request's
-- reason), cancelling deletes it. Someone without one (an assistant) gets a request and no block.
--   * kind and reason are private to the requester and time_off.manage holders; the API shows
--     everyone else only that the person is away. The change history masks reason and note.
--   * All-day time off is stored as UTC instants; local midnight is worked out here, in Postgres,
--     with the clinic's time zone (app.time_off_day_start_utc).
-- Holds a member's reason, so it has a retention class (time_off_requests, 365 days after the
-- last change) but no patient and no erasure step.
set local lock_timeout = '5s';

-- Midnight at the start of the clinic's local day p_day, as an instant. India's zone when the
-- clinic's is unknown to Postgres. Private to time-off: the clinic is the current tenant.
create function app.time_off_day_start_utc(p_day date)
  returns timestamptz
  language plpgsql stable set search_path = ''
  as $$
  declare
    zone text;
  begin
    select o.timezone into zone from aarogyam.organizations o
    where o.id = (select app.tenant_id());
    return p_day::timestamp at time zone coalesce(zone, 'Asia/Kolkata');
  exception when invalid_parameter_value then
    return p_day::timestamp at time zone 'Asia/Kolkata';
  end
  $$;
revoke execute on function app.time_off_day_start_utc(date) from public;
grant execute on function app.time_off_day_start_utc(date) to app_user;

create table aarogyam.time_off_requests (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- Who is away.
  membership_id uuid not null,
  kind text not null check (kind in ('vacation', 'sick', 'personal', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The window is whole local days; starts_at and ends_at are their UTC boundaries.
  all_day boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'cancelled')),
  -- Private to the requester and time_off.manage; never copied to leave_blocks.
  reason text check (char_length(btrim(reason)) between 1 and 200),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (char_length(btrim(decision_note)) between 1 and 200),
  -- The block availability reads; set while approved for someone with a practitioner row. A
  -- block deleted by hand leaves the request approved without one.
  leave_block_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, decided_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, leave_block_id) references aarogyam.leave_blocks (org_id, id)
    on delete set null (leave_block_id),
  check (starts_at < ends_at),
  check (ends_at - starts_at <= interval '366 days'),
  check ((status in ('approved', 'declined')) = (decided_by is not null and decided_at is not null)
         or status = 'cancelled'),
  check (leave_block_id is null or status = 'approved')
);
create index time_off_requests_status on aarogyam.time_off_requests (org_id, status, starts_at);
create index time_off_requests_member on aarogyam.time_off_requests (org_id, membership_id, starts_at);
create index time_off_requests_decided_by on aarogyam.time_off_requests (org_id, decided_by)
  where decided_by is not null;
create unique index time_off_requests_leave_block on aarogyam.time_off_requests (org_id, leave_block_id)
  where leave_block_id is not null;
comment on table aarogyam.time_off_requests is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.time_off_requests', 'mutable');
insert into audit.audit_config (table_name, mask) values
  ('aarogyam.time_off_requests', '{reason,decision_note}');
