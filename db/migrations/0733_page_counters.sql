-- Page views and visible time for the console's Insights page (docs/plans/console-insights-design.md, 2b).
--
-- The portal and the console send their counters to POST /api/v1/telemetry when a tab is hidden
-- or 50 entries have queued. The API adds them here through app.record_telemetry()
-- (0735). Pages are route templates (`/patients/:id`) from an allow-list, anything else is
-- `other`; no path, no query, no person, no session.
--
-- Privacy rules (the design's principles):
-- - private.ui_daily is per clinic and holds NO role: a clinic's numbers are totals across its
--   staff. Kept 90 days, then deleted.
-- - private.ui_daily_all holds the role and NO clinic, written in the same statement; custom
--   roles count as `custom`, so a role name an owner typed never leaves the clinic. Kept 400
--   days. The console's own pages are counted here with app `console`.
-- - private.telemetry_quota counts batches per clinic per day, for the daily cap; kept 2 days.
-- The tables are in `private`: no application role reads or writes them. Clinic rows cascade
-- when a clinic is removed; nothing names a person, so account deletion has nothing to purge.
set local lock_timeout = '5s';

create table private.ui_daily (
  org_id uuid not null references aarogyam.organizations (id) on delete cascade,
  day date not null,
  app text not null check (app in ('portal', 'console')),
  route text not null check (char_length(route) <= 120),
  views int not null check (views >= 0),
  visible_ms bigint not null check (visible_ms >= 0),
  primary key (org_id, day, app, route)
);
create index ui_daily_day on private.ui_daily (day);
alter table private.ui_daily enable row level security;

create table private.ui_daily_all (
  day date not null,
  app text not null check (app in ('portal', 'console')),
  role_key text not null check (char_length(role_key) <= 40),
  route text not null check (char_length(route) <= 120),
  views bigint not null check (views >= 0),
  visible_ms bigint not null check (visible_ms >= 0),
  primary key (day, app, role_key, route)
);
alter table private.ui_daily_all enable row level security;

create table private.telemetry_quota (
  org_id uuid not null references aarogyam.organizations (id) on delete cascade,
  day date not null,
  batches int not null check (batches >= 0),
  primary key (org_id, day)
);
alter table private.telemetry_quota enable row level security;
