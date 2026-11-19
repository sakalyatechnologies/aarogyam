-- Per-route API counters for the console's Insights page (docs/plans/console-insights-design.md, 2a).
--
-- Each API instance keeps its counters in memory. When its minute rolls over, the first request
-- to claim the flush adds the finished minutes to private.api_route_hours through
-- app.add_route_hours(): one autocommit statement, rows sorted by key so two revisions running
-- side by side during a deploy cannot deadlock, latency buckets added element by element. A
-- failed flush is dropped, never retried, so nothing is counted twice.
--
-- The outbox drain job calls app.fold_api_routes(): hours older than 30 days are folded into
-- private.api_route_days (kept 400 days). Rows hold route templates (`/api/v1/patients/{id}`),
-- counts and latency buckets only: no clinic, no person, no path.
-- The tables are in `private`: no application role reads or writes them directly.
set local lock_timeout = '5s';

-- Latency buckets end at 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000 and 10 000 ms; the
-- twelfth holds the rest (crates/aarogyam-api/src/metrics.rs).
create table private.api_route_hours (
  hour timestamptz not null check (extract(epoch from hour) % 3600 = 0),
  method text not null check (char_length(method) <= 8),
  route text not null check (char_length(route) <= 200),
  requests int not null check (requests >= 0),
  err_4xx int not null check (err_4xx >= 0),
  err_5xx int not null check (err_5xx >= 0),
  err_429 int not null check (err_429 >= 0),
  buckets int[] not null check (cardinality(buckets) = 12),
  primary key (hour, method, route)
);
alter table private.api_route_hours enable row level security;

create table private.api_route_days (
  day date not null,
  method text not null check (char_length(method) <= 8),
  route text not null check (char_length(route) <= 200),
  requests bigint not null check (requests >= 0),
  err_4xx bigint not null check (err_4xx >= 0),
  err_5xx bigint not null check (err_5xx >= 0),
  err_429 bigint not null check (err_429 >= 0),
  buckets bigint[] not null check (cardinality(buckets) = 12),
  primary key (day, method, route)
);
alter table private.api_route_days enable row level security;

-- Two bucket arrays added element by element; a missing element counts as 0. Saturates at the
-- largest int rather than failing a flush.
create function app.add_buckets(a int[], b int[])
  returns int[]
  language sql immutable parallel safe set search_path = ''
  as $$
    select coalesce(array_agg(least(coalesce(t.x, 0)::bigint + coalesce(t.y, 0), 2147483647)::int
                              order by t.n), '{}')
    from unnest(a, b) with ordinality as t(x, y, n)
  $$;

-- The same for day rows, whose sums can outgrow an int.
create function app.add_buckets(a bigint[], b bigint[])
  returns bigint[]
  language sql immutable parallel safe set search_path = ''
  as $$
    select coalesce(array_agg(coalesce(t.x, 0) + coalesce(t.y, 0) order by t.n), '{}')
    from unnest(a, b) with ordinality as t(x, y, n)
  $$;

-- Sums bucket arrays across rows.
create aggregate app.sum_buckets(bigint[]) (
  sfunc = app.add_buckets,
  stype = bigint[],
  initcond = '{0,0,0,0,0,0,0,0,0,0,0,0}'
);

-- Adds one flush: row i is (hours[i], methods[i], routes[i], ...), and its buckets are
-- buckets[12i-11 .. 12i] of the flat array. One statement, rows taken in key order.
create function app.add_route_hours(p_hours timestamptz[], p_methods text[], p_routes text[],
                                    p_requests int[], p_4xx int[], p_5xx int[], p_429 int[],
                                    p_buckets int[])
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with written as (
      insert into private.api_route_hours as h (hour, method, route, requests, err_4xx, err_5xx,
                                                err_429, buckets)
      select r.hour, r.method, r.route, r.requests, r.e4, r.e5, r.e429,
             p_buckets[(r.n - 1) * 12 + 1:r.n * 12]
      from unnest(p_hours, p_methods, p_routes, p_requests, p_4xx, p_5xx, p_429)
             with ordinality as r(hour, method, route, requests, e4, e5, e429, n)
      where cardinality(p_buckets) >= r.n * 12
      order by r.hour, r.method, r.route
      on conflict (hour, method, route) do update
        set requests = h.requests + excluded.requests,
            err_4xx = h.err_4xx + excluded.err_4xx,
            err_5xx = h.err_5xx + excluded.err_5xx,
            err_429 = h.err_429 + excluded.err_429,
            buckets = app.add_buckets(h.buckets, excluded.buckets)
      returning 1
    )
    select count(*)::int from written
  $$;

-- For the drain job: hours older than 30 days move into day rows (UTC days), and day rows older
-- than 400 days are deleted. Returns the hour rows folded.
create function app.fold_api_routes()
  returns int
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_cutoff timestamptz := date_trunc('day', now() - interval '30 days', 'UTC');
    v_folded int;
  begin
    perform pg_catalog.pg_advisory_xact_lock(hashtext('private.api_route_hours'));
    with moved as (
      delete from private.api_route_hours where hour < v_cutoff
      returning hour, method, route, requests, err_4xx, err_5xx, err_429, buckets
    ), days as (
      insert into private.api_route_days as d (day, method, route, requests, err_4xx, err_5xx,
                                               err_429, buckets)
      select (m.hour at time zone 'UTC')::date, m.method, m.route, sum(m.requests),
             sum(m.err_4xx), sum(m.err_5xx), sum(m.err_429), app.sum_buckets(m.buckets::bigint[])
      from moved m
      group by 1, 2, 3
      order by 1, 2, 3
      on conflict (day, method, route) do update
        set requests = d.requests + excluded.requests,
            err_4xx = d.err_4xx + excluded.err_4xx,
            err_5xx = d.err_5xx + excluded.err_5xx,
            err_429 = d.err_429 + excluded.err_429,
            buckets = app.add_buckets(d.buckets, excluded.buckets)
    )
    select count(*)::int into v_folded from moved;
    delete from private.api_route_days where day < (now() at time zone 'UTC')::date - 400;
    return v_folded;
  end
  $$;

-- Each method and route since `p_since`, summed: hours still kept, plus day rows for older
-- folded days. An hour is in one table or the other, never both.
create function app.console_api_routes(p_since timestamptz)
  returns table (method text, route text, requests bigint, err_4xx bigint, err_5xx bigint,
                 err_429 bigint, buckets bigint[])
  language sql stable security definer set search_path = ''
  as $$
    select x.method, x.route, sum(x.requests)::bigint, sum(x.err_4xx)::bigint,
           sum(x.err_5xx)::bigint, sum(x.err_429)::bigint, app.sum_buckets(x.buckets)
    from (
      select h.method, h.route, h.requests::bigint as requests, h.err_4xx::bigint as err_4xx,
             h.err_5xx::bigint as err_5xx, h.err_429::bigint as err_429,
             h.buckets::bigint[] as buckets
      from private.api_route_hours h
      where h.hour >= date_trunc('hour', p_since, 'UTC')
      union all
      select d.method, d.route, d.requests, d.err_4xx, d.err_5xx, d.err_429, d.buckets
      from private.api_route_days d
      where d.day >= (p_since at time zone 'UTC')::date
    ) x
    group by x.method, x.route
    order by sum(x.requests) desc, x.route, x.method
  $$;

grant execute on function app.add_route_hours(timestamptz[], text[], text[], int[], int[], int[],
                                              int[], int[]) to aarogyam_api;
grant execute on function app.fold_api_routes() to aarogyam_api;
grant execute on function app.console_api_routes(timestamptz) to aarogyam_api;
