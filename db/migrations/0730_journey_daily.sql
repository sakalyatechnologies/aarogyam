-- Journeys and active staff for the console's Insights page (docs/plans/console-insights-design.md, 1c).
--
-- Once a day per clinic, the outbox drain job asks app.journey_days_due() which clinics have no
-- row for their yesterday (clinic time), at most 20 a run, and calls app.record_journey_day()
-- for each. That writes one private.journey_daily row, always, zero for a clinic with no visits,
-- so an idle clinic is never picked again that day, and in the same transaction the clinic's
-- private.active_daily rows. Both hold aggregates only: no patient, no member, no record id.
--
-- Privacy rules (product rule 6, the design's principles):
-- - Clinic rows never leave app.journey_day(): it returns counts and percentiles only.
-- - A timing built from fewer than 5 visits is stored as null.
-- - active_daily counts distinct people per role; custom roles count as `custom`, so a role
--   name an owner typed never leaves the clinic. The console shows a clinic's roles only where
--   that day's row has 3 or more members (app.console_clinic_roles), otherwise only totals.
-- The tables are in `private`: no application role reads or writes them. They cascade when a
-- clinic is removed; they hold nothing about a person, so account deletion has nothing to purge.
set local lock_timeout = '5s';

create table private.journey_daily (
  org_id uuid not null references aarogyam.organizations (id) on delete cascade,
  day date not null,
  visits int not null,
  arrive_to_seat_p50 numeric(10, 1),
  arrive_to_seat_p90 numeric(10, 1),
  seat_to_start_p50 numeric(10, 1),
  seat_to_start_p90 numeric(10, 1),
  visit_minutes_p50 numeric(10, 1),
  visit_minutes_p90 numeric(10, 1),
  end_to_paid_p50 numeric(10, 1),
  end_to_paid_p90 numeric(10, 1),
  booked int not null,
  no_shows int not null,
  booking_lead_days_p50 numeric(10, 1),
  created_at timestamptz not null default now(),
  primary key (org_id, day)
);
create index journey_daily_day on private.journey_daily (day);
alter table private.journey_daily enable row level security;

create table private.active_daily (
  org_id uuid not null references aarogyam.organizations (id) on delete cascade,
  day date not null,
  role_key text not null,
  members int not null check (members > 0),
  primary key (org_id, day, role_key)
);
create index active_daily_day on private.active_daily (day);
alter table private.active_daily enable row level security;

-- The q-th percentile of `p_values`, rounded to 0.1, or null for fewer than 5 values.
create function app.journey_percentile(p_values double precision[], p_q double precision)
  returns numeric
  language sql immutable set search_path = ''
  as $$
    select case when count(*) >= 5
                then round((percentile_cont(p_q) within group (order by v))::numeric, 1) end
    from unnest(p_values) as v
  $$;

-- One clinic's day in clinic time, as aggregates. Minutes for arrive -> seated (appointments),
-- seated -> visit started, visit started -> ended, ended -> first payment on the visit's bill;
-- booked (appointments that day not cancelled or still requested), no-shows, and how many days
-- ahead those were booked. Percentiles from fewer than 5 visits are null.
create function app.journey_day(p_org uuid, p_day date)
  returns table (visits int, arrive_to_seat_p50 numeric, arrive_to_seat_p90 numeric,
                 seat_to_start_p50 numeric, seat_to_start_p90 numeric,
                 visit_minutes_p50 numeric, visit_minutes_p90 numeric,
                 end_to_paid_p50 numeric, end_to_paid_p90 numeric,
                 booked int, no_shows int, booking_lead_days_p50 numeric)
  language sql stable security definer set search_path = ''
  as $$
    with b as (
      select p_day::timestamp at time zone o.timezone as t0,
             (p_day + 1)::timestamp at time zone o.timezone as t1
      from aarogyam.organizations o where o.id = p_org
    ), a as (
      select ap.status, ap.arrived_at, ap.seated_at, ap.starts_at, ap.created_at
      from aarogyam.appointments ap, b
      where ap.org_id = p_org and ap.deleted_at is null
        and ap.starts_at >= b.t0 and ap.starts_at < b.t1
    ), v as (
      select e.started_at, e.ended_at, ap.seated_at,
             (select min(p.received_at)
                from aarogyam.invoices i
                join aarogyam.payment_allocations pa on pa.org_id = i.org_id and pa.invoice_id = i.id
                join aarogyam.payments p on p.org_id = pa.org_id and p.id = pa.payment_id
               where i.org_id = e.org_id and i.encounter_id = e.id
                 and i.status = 'issued' and p.status = 'received') as paid_at
      from aarogyam.encounters e
      cross join b
      left join aarogyam.appointments ap on ap.org_id = e.org_id and ap.id = e.appointment_id
      where e.org_id = p_org and e.started_at >= b.t0 and e.started_at < b.t1
    ), t as (
      select
        (select array_agg(extract(epoch from a.seated_at - a.arrived_at)::float8 / 60) from a
          where a.arrived_at is not null and a.seated_at >= a.arrived_at) as arrive_seat,
        (select array_agg(extract(epoch from v.started_at - v.seated_at)::float8 / 60) from v
          where v.seated_at is not null and v.started_at >= v.seated_at) as seat_start,
        (select array_agg(extract(epoch from v.ended_at - v.started_at)::float8 / 60) from v
          where v.ended_at >= v.started_at) as visit_length,
        (select array_agg(greatest(extract(epoch from v.paid_at - v.ended_at)::float8, 0) / 60) from v
          where v.ended_at is not null and v.paid_at is not null) as end_paid,
        (select array_agg(extract(epoch from a.starts_at - a.created_at)::float8 / 86400) from a
          where a.status not in ('cancelled', 'requested') and a.starts_at >= a.created_at) as lead_days
    )
    select (select count(*)::int from v),
           app.journey_percentile(t.arrive_seat, 0.5), app.journey_percentile(t.arrive_seat, 0.9),
           app.journey_percentile(t.seat_start, 0.5), app.journey_percentile(t.seat_start, 0.9),
           app.journey_percentile(t.visit_length, 0.5), app.journey_percentile(t.visit_length, 0.9),
           app.journey_percentile(t.end_paid, 0.5), app.journey_percentile(t.end_paid, 0.9),
           (select count(*)::int from a where a.status not in ('cancelled', 'requested')),
           (select count(*)::int from a where a.status = 'no_show'),
           app.journey_percentile(t.lead_days, 0.5)
    from b, t
  $$;

-- Writes the clinic's journey row for `p_day` and, in the same transaction, who was active:
-- distinct members whose latest clinic sign-in activity (any clinic, web or phone) is on or
-- after the start of that day. The job runs this shortly after the clinic's midnight, before the
-- day's activity overwrites last_active_at. Returns false when the row already existed.
create function app.record_journey_day(p_org uuid, p_day date)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_written int;
    v_from timestamptz;
  begin
    insert into private.journey_daily (org_id, day, visits, arrive_to_seat_p50, arrive_to_seat_p90,
                                       seat_to_start_p50, seat_to_start_p90, visit_minutes_p50,
                                       visit_minutes_p90, end_to_paid_p50, end_to_paid_p90,
                                       booked, no_shows, booking_lead_days_p50)
    select p_org, p_day, j.visits, j.arrive_to_seat_p50, j.arrive_to_seat_p90,
           j.seat_to_start_p50, j.seat_to_start_p90, j.visit_minutes_p50, j.visit_minutes_p90,
           j.end_to_paid_p50, j.end_to_paid_p90, j.booked, j.no_shows, j.booking_lead_days_p50
    from app.journey_day(p_org, p_day) j
    on conflict (org_id, day) do nothing;
    get diagnostics v_written = row_count;
    if v_written = 0 then
      return false;
    end if;

    select p_day::timestamp at time zone o.timezone into v_from
      from aarogyam.organizations o where o.id = p_org;
    insert into private.active_daily (org_id, day, role_key, members)
    select p_org, p_day, x.role_key, count(*)::int
    from (
      select distinct m.user_id, case when r.is_template then r.key else 'custom' end as role_key
      from aarogyam.memberships m
      join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
      where m.org_id = p_org and m.status = 'active'
        and exists (select 1 from aarogyam.sessions s
                     where s.user_id = m.user_id and s.audience = 'clinic'
                       and s.last_active_at >= v_from)
    ) x
    group by x.role_key
    on conflict (org_id, day, role_key) do nothing;
    return true;
  end
  $$;

-- Clinics without a journey row for their yesterday (clinic time), oldest clinic first. A clinic
-- created today has no yesterday yet; churned clinics are skipped.
create function app.journey_days_due(p_limit int)
  returns table (org_id uuid, day date)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, d.yesterday
    from aarogyam.organizations o
    cross join lateral (select (now() at time zone o.timezone)::date - 1 as yesterday) d
    where o.status <> 'churned'
      and o.created_at < (d.yesterday + 1)::timestamp at time zone o.timezone
      and not exists (select 1 from private.journey_daily j
                       where j.org_id = o.id and j.day = d.yesterday)
    order by o.created_at, o.id
    limit least(greatest(p_limit, 0), 100)
  $$;

-- The console's reads. Per clinic: journeys and the day's active-staff total.
create function app.console_journeys(p_from date, p_to date)
  returns table (org_id uuid, slug text, name text, day date, visits int,
                 arrive_to_seat_p50 numeric, arrive_to_seat_p90 numeric,
                 seat_to_start_p50 numeric, seat_to_start_p90 numeric,
                 visit_minutes_p50 numeric, visit_minutes_p90 numeric,
                 end_to_paid_p50 numeric, end_to_paid_p90 numeric,
                 booked int, no_shows int, booking_lead_days_p50 numeric, active_staff int)
  language sql stable security definer set search_path = ''
  as $$
    select j.org_id, o.slug, o.name, j.day, j.visits, j.arrive_to_seat_p50, j.arrive_to_seat_p90,
           j.seat_to_start_p50, j.seat_to_start_p90, j.visit_minutes_p50, j.visit_minutes_p90,
           j.end_to_paid_p50, j.end_to_paid_p90, j.booked, j.no_shows, j.booking_lead_days_p50,
           coalesce((select sum(ad.members) from private.active_daily ad
                      where ad.org_id = j.org_id and ad.day = j.day), 0)::int
    from private.journey_daily j
    join aarogyam.organizations o on o.id = j.org_id
    where j.day between p_from and p_to
    order by j.day, o.slug
  $$;

-- Active staff by role across all clinics, per day: no clinic in the answer.
create function app.console_active_roles(p_from date, p_to date)
  returns table (day date, role_key text, members int, clinics int)
  language sql stable security definer set search_path = ''
  as $$
    select ad.day, ad.role_key, sum(ad.members)::int, count(*)::int
    from private.active_daily ad
    where ad.day between p_from and p_to
    group by ad.day, ad.role_key
    order by ad.day, ad.role_key
  $$;

-- A clinic's active staff by role, only where that day's row has 3 or more members.
create function app.console_clinic_roles(p_from date, p_to date)
  returns table (org_id uuid, day date, role_key text, members int)
  language sql stable security definer set search_path = ''
  as $$
    select ad.org_id, ad.day, ad.role_key, ad.members
    from private.active_daily ad
    where ad.day between p_from and p_to and ad.members >= 3
    order by ad.org_id, ad.day, ad.role_key
  $$;

grant execute on function app.record_journey_day(uuid, date) to aarogyam_api;
grant execute on function app.journey_days_due(int) to aarogyam_api;
grant execute on function app.console_journeys(date, date) to aarogyam_api;
grant execute on function app.console_active_roles(date, date) to aarogyam_api;
grant execute on function app.console_clinic_roles(date, date) to aarogyam_api;
