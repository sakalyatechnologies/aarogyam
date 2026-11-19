-- Writing and reading the front-end counters (0733, 0734) for the console's Insights page
-- (docs/plans/console-insights-design.md, 2b).
--
-- app.record_telemetry() is the only writer: POST /api/v1/telemetry calls it once per batch the
-- API has already validated (route allow-list, fixed vital and error names, 50 entries). It
-- adds, in one statement, to ui_daily (clinic, no role), ui_daily_all (role, no clinic),
-- vitals_daily and errors_daily (neither). A clinic's batches past the daily cap are dropped.
-- The console's own pages arrive with no clinic and go to the all-clinic tables only.
-- The readers return sums for the console; the drain job calls app.purge_telemetry().
set local lock_timeout = '5s';

-- One batch. Pages are (routes[i], views[i], visible[i]); vitals are (v_routes[i], v_vitals[i])
-- with buckets v_buckets[12i-11 .. 12i]; errors are (e_routes[i], e_classes[i], e_counts[i]).
-- `p_org` null means the console (`p_role` is then the staff member's console role). Returns
-- false when the clinic is over `p_cap` batches today and nothing was added.
create function app.record_telemetry(p_org uuid, p_role text, p_app text, p_cap int,
                                     p_routes text[], p_views int[], p_visible bigint[],
                                     p_v_routes text[], p_v_vitals text[], p_v_buckets int[],
                                     p_e_routes text[], p_e_classes text[], p_e_counts int[])
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_day date := (now() at time zone 'UTC')::date;
    v_role text := p_role;
    v_batches int;
  begin
    if p_org is not null then
      select (now() at time zone o.timezone)::date into v_day
        from aarogyam.organizations o where o.id = p_org;
      if v_day is null then
        return false;
      end if;
      insert into private.telemetry_quota as q (org_id, day, batches)
      values (p_org, v_day, 1)
      on conflict (org_id, day) do update set batches = q.batches + 1
      returning q.batches into v_batches;
      if v_batches > p_cap then
        return false;
      end if;
      -- Standard roles by key; a role the clinic made counts as `custom`.
      select coalesce((select case when r.is_template then r.key else 'custom' end
                         from aarogyam.roles r where r.org_id = p_org and r.key = p_role),
                      'custom')
        into v_role;
    end if;

    with pages as (
      select p.route, sum(p.views)::bigint as views, sum(p.visible)::bigint as visible
      from unnest(p_routes, p_views, p_visible) as p(route, views, visible)
      group by p.route
    ), clinic as (
      insert into private.ui_daily as u (org_id, day, app, route, views, visible_ms)
      select p_org, v_day, p_app, p.route, p.views, p.visible
      from pages p
      where p_org is not null
      order by p.route
      on conflict (org_id, day, app, route) do update
        set views = u.views + excluded.views, visible_ms = u.visible_ms + excluded.visible_ms
    ), everyone as (
      insert into private.ui_daily_all as a (day, app, role_key, route, views, visible_ms)
      select v_day, p_app, v_role, p.route, p.views, p.visible
      from pages p
      order by p.route
      on conflict (day, app, role_key, route) do update
        set views = a.views + excluded.views, visible_ms = a.visible_ms + excluded.visible_ms
    ), vitals as (
      select v.route, v.vital,
             app.sum_buckets(p_v_buckets[(v.n - 1) * 12 + 1:v.n * 12]::bigint[]) as buckets
      from unnest(p_v_routes, p_v_vitals) with ordinality as v(route, vital, n)
      where cardinality(p_v_buckets) >= v.n * 12
      group by v.route, v.vital
    ), speed as (
      insert into private.vitals_daily as s (day, app, route, vital, buckets)
      select v_day, p_app, v.route, v.vital,
             (select array_agg(least(b, 2147483647)::int order by i)
                from unnest(v.buckets) with ordinality as x(b, i))
      from vitals v
      order by v.route, v.vital
      on conflict (day, app, route, vital) do update
        set buckets = app.add_buckets(s.buckets, excluded.buckets)
    ), errors as (
      select e.route, e.class, least(sum(e.count), 2147483647)::int as count
      from unnest(p_e_routes, p_e_classes, p_e_counts) as e(route, class, count)
      group by e.route, e.class
    )
    insert into private.errors_daily as d (day, app, route, class, count)
    select v_day, p_app, e.route, e.class, e.count
    from errors e
    order by e.route, e.class
    on conflict (day, app, route, class) do update
      set count = least(d.count::bigint + excluded.count, 2147483647)::int;
    return true;
  end
  $$;

-- Views and visible time per app and page, all clinics and the console, from `p_from` to `p_to`.
create function app.console_ui_pages(p_from date, p_to date)
  returns table (app text, route text, views bigint, visible_ms bigint)
  language sql stable security definer set search_path = ''
  as $$
    select a.app, a.route, sum(a.views)::bigint, sum(a.visible_ms)::bigint
    from private.ui_daily_all a
    where a.day between p_from and p_to
    group by a.app, a.route
    order by a.app, sum(a.visible_ms) desc, a.route
  $$;

-- The same per role, across all clinics: no clinic is named or can be picked out.
create function app.console_ui_roles(p_from date, p_to date)
  returns table (app text, role_key text, views bigint, visible_ms bigint)
  language sql stable security definer set search_path = ''
  as $$
    select a.app, a.role_key, sum(a.views)::bigint, sum(a.visible_ms)::bigint
    from private.ui_daily_all a
    where a.day between p_from and p_to
    group by a.app, a.role_key
    order by a.app, sum(a.visible_ms) desc, a.role_key
  $$;

-- Each clinic's totals across its staff and pages: no role, no page.
create function app.console_ui_clinics(p_from date, p_to date)
  returns table (org_id uuid, slug text, name text, views bigint, visible_ms bigint)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug::text, o.name::text, sum(u.views)::bigint, sum(u.visible_ms)::bigint
    from private.ui_daily u
    join aarogyam.organizations o on o.id = u.org_id
    where u.day between p_from and p_to
    group by o.id, o.slug, o.name
    order by sum(u.visible_ms) desc, o.slug
  $$;

-- Vital histograms per app, page and vital, summed over the days.
create function app.console_vitals(p_from date, p_to date)
  returns table (app text, route text, vital text, buckets bigint[])
  language sql stable security definer set search_path = ''
  as $$
    select v.app, v.route, v.vital, app.sum_buckets(v.buckets::bigint[])
    from private.vitals_daily v
    where v.day between p_from and p_to
    group by v.app, v.route, v.vital
    order by v.app, v.route, v.vital
  $$;

-- Error counts per app, page and class.
create function app.console_errors(p_from date, p_to date)
  returns table (app text, route text, class text, count bigint)
  language sql stable security definer set search_path = ''
  as $$
    select e.app, e.route, e.class, sum(e.count)::bigint
    from private.errors_daily e
    where e.day between p_from and p_to
    group by e.app, e.route, e.class
    order by sum(e.count) desc, e.app, e.route, e.class
  $$;

-- For the drain job: clinic page rows after 90 days, the rest after 400, quotas after 2.
create function app.purge_telemetry()
  returns int
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_today date := (now() at time zone 'UTC')::date;
    v_count int;
    v_total int := 0;
  begin
    delete from private.ui_daily where day < v_today - 90;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    delete from private.ui_daily_all where day < v_today - 400;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    delete from private.vitals_daily where day < v_today - 400;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    delete from private.errors_daily where day < v_today - 400;
    get diagnostics v_count = row_count;
    v_total := v_total + v_count;
    delete from private.telemetry_quota where day < v_today - 2;
    get diagnostics v_count = row_count;
    return v_total + v_count;
  end
  $$;

grant execute on function app.record_telemetry(uuid, text, text, int, text[], int[], bigint[],
                                               text[], text[], int[], text[], text[], int[])
  to aarogyam_api;
grant execute on function app.console_ui_pages(date, date) to aarogyam_api;
grant execute on function app.console_ui_roles(date, date) to aarogyam_api;
grant execute on function app.console_ui_clinics(date, date) to aarogyam_api;
grant execute on function app.console_vitals(date, date) to aarogyam_api;
grant execute on function app.console_errors(date, date) to aarogyam_api;
grant execute on function app.purge_telemetry() to aarogyam_api;
