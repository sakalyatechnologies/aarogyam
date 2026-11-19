-- Fix to 0735: app.record_telemetry dated the all-clinic rows (ui_daily_all, vitals_daily,
-- errors_daily) with the clinic's local day, but the console reads them by UTC date, so for an
-- Indian clinic between 18:30 and 24:00 UTC the counts landed on a day the console had not reached.
-- The clinic's own rows (ui_daily) and its daily quota keep the clinic's day; the all-clinic rows
-- now use UTC, as docs/decisions.md says. Same signature and grants.
-- The console asks for UTC days; a clinic's own day (ui_daily) runs up to a day ahead of UTC
-- (India: from 18:30 UTC), so the two readers of ui_daily include the day after the range end.
set local lock_timeout = '5s';

create or replace function app.record_telemetry(p_org uuid, p_role text, p_app text, p_cap int,
                                     p_routes text[], p_views int[], p_visible bigint[],
                                     p_v_routes text[], p_v_vitals text[], p_v_buckets int[],
                                     p_e_routes text[], p_e_classes text[], p_e_counts int[])
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    -- The clinic's own day for its rows and its quota; UTC for the all-clinic rows, which the
    -- console reads by UTC date.
    v_day date := (now() at time zone 'UTC')::date;
    v_all_day date := (now() at time zone 'UTC')::date;
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
      select v_all_day, p_app, v_role, p.route, p.views, p.visible
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
      select v_all_day, p_app, v.route, v.vital,
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
    select v_all_day, p_app, e.route, e.class, e.count
    from errors e
    order by e.route, e.class
    on conflict (day, app, route, class) do update
      set count = least(d.count::bigint + excluded.count, 2147483647)::int;
    return true;
  end
  $$;

create or replace function app.console_ui_roles(p_from date, p_to date)
  returns table (app text, role_key text, views bigint, visible_ms bigint)
  language sql stable security definer set search_path = ''
  as $$
    select a.app, a.role_key, sum(a.views)::bigint, sum(a.visible_ms)::bigint
    from private.ui_daily_all a
    where a.day between p_from and p_to
      and (a.app = 'console'
           or (select count(distinct u.org_id) from private.ui_daily u
                where u.day between p_from and p_to + 1 and u.app = 'portal') >= 3)
    group by a.app, a.role_key
    order by a.app, sum(a.visible_ms) desc, a.role_key
  $$;

create or replace function app.console_ui_clinics(p_from date, p_to date)
  returns table (org_id uuid, slug text, name text, views bigint, visible_ms bigint)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug::text, o.name::text, sum(u.views)::bigint, sum(u.visible_ms)::bigint
    from private.ui_daily u
    join aarogyam.organizations o on o.id = u.org_id
    where u.day between p_from and p_to + 1
    group by o.id, o.slug, o.name
    order by sum(u.visible_ms) desc, o.slug
  $$;
