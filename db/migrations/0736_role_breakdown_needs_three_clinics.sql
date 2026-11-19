-- People signed in by role "across all clinics" (app.console_active_roles, 0730) is shown only
-- when 3 or more clinics have active-staff rows in the range. With one or two clinics the
-- breakdown would be those clinics' own, which the console never shows by role
-- (docs/plans/console-insights-design.md, Principles). app.console_ui_roles (0735) has the
-- same rule for page counters.
set local lock_timeout = '5s';

create or replace function app.console_active_roles(p_from date, p_to date)
  returns table (day date, role_key text, members int, clinics int)
  language sql stable security definer set search_path = ''
  as $$
    select ad.day, ad.role_key, sum(ad.members)::int, count(*)::int
    from private.active_daily ad
    where ad.day between p_from and p_to
      and (select count(distinct x.org_id) from private.active_daily x
            where x.day between p_from and p_to) >= 3
    group by ad.day, ad.role_key
    order by ad.day, ad.role_key
  $$;
