-- The clinic's time zone and patient-number prefix with its host, so a request knows its
-- clinic's local day without reading the clinic first: one round trip fewer per request,
-- about 300 ms across regions.
set local lock_timeout = '5s';

-- Host name → clinic, with the clinic's time zone and patient-number prefix. Replaces
-- app.resolve_host, which stays for API versions still running during a deploy; drop it in a
-- later release (expand, then contract).
create function app.resolve_clinic_host(p_host text)
  returns table (org_id uuid, slug text, org_status text, timezone text, number_prefix text)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.status, o.timezone, o.number_prefix
    from aarogyam.org_domains d
    join aarogyam.organizations o on o.id = d.org_id
    where d.hostname = lower(p_host) and d.verified_at is not null
  $$;
grant execute on function app.resolve_clinic_host(text) to aarogyam_api;
