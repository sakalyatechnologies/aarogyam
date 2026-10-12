-- Stock alerts, the clock gate (plan section 5, "Runs from 08:00 local time"). The alert step
-- reads the usage snapshot across clinics, then works only on those whose own local time has
-- reached the starting hour, so one clinic's morning never waits for another's.
--   * app.orgs_past_local_time(p_now, p_from): the clinics in use whose local wall-clock time at
--     p_now is at or after p_from.
-- Runs as the owner (the job has no clinic session). Expand only: a new function.
set local lock_timeout = '5s';

create function app.orgs_past_local_time(p_now timestamptz, p_from time)
  returns setof uuid
  language sql stable security definer set search_path = ''
  as $$
    select o.id from aarogyam.organizations o
    where o.status in ('trial', 'active') and app.clinic_local_time(p_now, o.timezone) >= p_from
  $$;
revoke execute on function app.orgs_past_local_time(timestamptz, time) from public;
grant execute on function app.orgs_past_local_time(timestamptz, time) to aarogyam_api;
