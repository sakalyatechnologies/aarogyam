-- Page speed and front-end error classes for the console's Insights page
-- (docs/plans/console-insights-design.md, 2b).
--
-- Written by app.record_telemetry() (0735) from the same batches as the page counters, with NO
-- clinic and NO role: only the app, the route template, the vital or error class, and counts.
-- Vitals are histograms: twelve buckets whose bounds the API fixes per vital
-- (crates/aarogyam-domain/src/telemetry.rs), so percentiles are estimated on read. Error classes
-- are a fixed list (`type_error`, `chunk_load` ...); messages stay in the log through
-- POST /api/v1/client-errors. Both are kept 400 days.
set local lock_timeout = '5s';

create table private.vitals_daily (
  day date not null,
  app text not null check (app in ('portal', 'console')),
  route text not null check (char_length(route) <= 120),
  vital text not null check (vital in ('lcp', 'inp', 'cls', 'ttfb')),
  buckets int[] not null check (cardinality(buckets) = 12),
  primary key (day, app, route, vital)
);
alter table private.vitals_daily enable row level security;

create table private.errors_daily (
  day date not null,
  app text not null check (app in ('portal', 'console')),
  route text not null check (char_length(route) <= 120),
  class text not null check (class in ('type_error', 'reference_error', 'range_error',
                                       'syntax_error', 'chunk_load', 'network',
                                       'unhandled_rejection', 'other')),
  count int not null check (count >= 0),
  primary key (day, app, route, class)
);
alter table private.errors_daily enable row level security;
