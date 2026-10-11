-- Campaigns (see 0380): who an audience matches, and a claim that can leave campaign messages
-- alone. Both are definer functions, as the message worker acts for no one clinic.
set local lock_timeout = '5s';

-- The clinic's active patients matching one audience filter, now. Inside a clinic transaction it
-- answers only for that clinic. Filters: all_active; last_visit (before: last visit earlier than
-- that date; after: on or after it; a patient never seen matches neither); birthday_month;
-- age_band (whole years today, both ends included; no birth date, no match); sex; tag.
create function app.audience_patients(p_org_id uuid, p_filter jsonb)
  returns table (id uuid)
  language sql stable security definer set search_path = ''
  as $$
    select p.id
    from aarogyam.patients p
    where p.org_id = p_org_id
      and (app.tenant_id() is null or app.tenant_id() = p_org_id)
      and p.deleted_at is null and p.status = 'active'
      and case p_filter->>'kind'
        when 'all_active' then true
        when 'last_visit' then
          ((p_filter->>'before') is null
           or p.last_visit_at < ((p_filter->>'before')::date)::timestamp at time zone 'UTC')
          and ((p_filter->>'after') is null
               or p.last_visit_at >= ((p_filter->>'after')::date)::timestamp at time zone 'UTC')
        when 'birthday_month' then
          extract(month from p.date_of_birth) = (p_filter->>'month')::int
        when 'age_band' then
          p.date_of_birth is not null
          and date_part('year', age(current_date, p.date_of_birth))
              between (p_filter->>'min')::int and (p_filter->>'max')::int
        when 'sex' then p.sex::text = p_filter->>'sex'
        when 'tag' then (p_filter->>'tag') = any (p.tags)
        else false
      end
  $$;
revoke execute on function app.audience_patients(uuid, jsonb) from public;
grant execute on function app.audience_patients(uuid, jsonb) to app_user, aarogyam_api;

-- As 0371, plus p_campaigns_enabled: false (the platform kill switch) leaves campaign messages
-- queued and unclaimed, including any whose claim lapsed.
drop function app.messages_claim(text, text, int, int, int);
create function app.messages_claim(p_channel text, p_provider text, p_daily_budget int,
                                   p_limit int, p_lease_seconds int,
                                   p_campaigns_enabled boolean default true)
  returns table (org_id uuid, id uuid, attempts int, deferred boolean)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
    v_room int;
  begin
    perform pg_advisory_xact_lock(hashtext('app.messages_claim'), hashtext(p_provider));
    select greatest(coalesce(p_daily_budget, 100) - count(*), 0) into v_room
    from aarogyam.messages m
    where m.provider = p_provider
      and (m.sent_at >= v_today or (m.status = 'sending' and m.lease_until > now()));
    return query
    with locked as (
      select m.org_id, m.id, m.scheduled_for
      from aarogyam.messages m
      where m.channel = p_channel
        and (coalesce(p_campaigns_enabled, true) or m.campaign_id is null)
        and ((m.status = 'queued' and m.scheduled_for <= now())
             or (m.status = 'sending' and m.lease_until <= now()))
      order by m.scheduled_for, m.id
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
    ),
    due as (
      select l.org_id, l.id, row_number() over (order by l.scheduled_for, l.id) as n from locked l
    ),
    claimed as (
      update aarogyam.messages m
        set status = 'sending', attempts = m.attempts + 1, provider = p_provider,
            lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 1))
      from due
      where m.org_id = due.org_id and m.id = due.id and due.n <= v_room
      returning m.org_id, m.id, m.attempts, false
    ),
    put_off as (
      update aarogyam.messages m
        set status = 'queued', lease_until = null, provider = null,
            scheduled_for = v_today + interval '1 day'
      from due
      where m.org_id = due.org_id and m.id = due.id and due.n > v_room
      returning m.org_id, m.id, m.attempts, true
    )
    select * from claimed union all select * from put_off;
  end
  $$;
revoke execute on function app.messages_claim(text, text, int, int, int, boolean) from public;
grant execute on function app.messages_claim(text, text, int, int, int, boolean) to aarogyam_api;
