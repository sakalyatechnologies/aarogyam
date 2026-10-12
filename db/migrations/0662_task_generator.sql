-- Staff to-dos: when a task falls due, the job that makes each day's occurrences, and the
-- standard tasks every clinic starts with (docs/decisions.md, "Staff operations").
--   * app.clinic_local_to_utc: a clinic's local date and time as an instant.
--   * app.task_due_dates: the one place that knows what "every 3 days" or "weekdays" means; the
--     generator and the "next due" preview both use it.
--   * app.materialize_task_occurrences: the drain job's step. Makes every occurrence that fell due in
--     the last 24 hours (so a short outage is caught up, and nothing fires early) and, in the same
--     statement, its first `task_due` notice. Safe to run twice at once.
--   * app.seed_default_tasks / app.seed_missing_default_tasks: the three standard tasks. A standard
--     task a clinic switched off stays off: seeding only adds the ones that do not exist.
-- A time that does not exist on a clock-change day (02:30 on spring-forward) is read as the
-- offset before the change, so it becomes 03:30 and still fires once; a time that happens twice
-- resolves to one instant. A clinic whose zone Postgres does not know is read in India's, as
-- everywhere else (app.clinic_local_date).
set local lock_timeout = '5s';

-- The instant at which the clinic's wall clock shows p_local.
create function app.clinic_local_to_utc(p_org uuid, p_local timestamp)
  returns timestamptz
  language plpgsql stable set search_path = ''
  as $$
  declare
    v_tz text;
  begin
    select o.timezone into v_tz from aarogyam.organizations o where o.id = p_org;
    begin
      return p_local at time zone coalesce(v_tz, 'Asia/Kolkata');
    exception when invalid_parameter_value then
      return p_local at time zone 'Asia/Kolkata';
    end;
  end
  $$;
revoke execute on function app.clinic_local_to_utc(uuid, timestamp) from public;
grant execute on function app.clinic_local_to_utc(uuid, timestamp) to app_user;

-- The occurrences of one schedule that fall due after p_from and up to p_to (both instants), as
-- the clinic's calendar day and the instant. The columns are a template's own; p_weekdays is
-- the ISO bitmask (Monday = 1).
create function app.task_due_dates(
  p_kind text, p_interval_days int, p_weekdays int, p_starts_on date, p_ends_on date,
  p_due_time time, p_once_at timestamptz, p_timezone text, p_from timestamptz, p_to timestamptz)
  returns table (local_date date, due_at timestamptz)
  language plpgsql stable set search_path = ''
  as $$
  declare
    v_tz text := coalesce(p_timezone, 'Asia/Kolkata');
  begin
    begin
      perform now() at time zone v_tz;
    exception when invalid_parameter_value then
      v_tz := 'Asia/Kolkata';
    end;

    if p_kind = 'once' then
      return query
        select (p_once_at at time zone v_tz)::date, p_once_at
        where p_once_at > p_from and p_once_at <= p_to;
      return;
    end if;

    -- A day either side covers every offset; the instant decides what is inside the window.
    return query
      select d.day, ((d.day + p_due_time) at time zone v_tz)
      from (select g::date as day
            from generate_series((p_from at time zone v_tz)::date - 1,
                                 (p_to at time zone v_tz)::date + 1, interval '1 day') g) d
      where d.day >= p_starts_on
        and (p_ends_on is null or d.day <= p_ends_on)
        and ((d.day + p_due_time) at time zone v_tz) > p_from
        and ((d.day + p_due_time) at time zone v_tz) <= p_to
        and case p_kind
              when 'daily' then true
              when 'every_n_days' then (d.day - p_starts_on) % p_interval_days = 0
              when 'weekdays' then (p_weekdays & (1 << (extract(isodow from d.day)::int - 1))) <> 0
              else false
            end;
  end
  $$;
revoke execute on function app.task_due_dates(text, int, int, date, date, time, timestamptz, text, timestamptz, timestamptz) from public;
grant execute on function app.task_due_dates(text, int, int, date, date, time, timestamptz, text, timestamptz, timestamptz) to app_user;

-- The drain job's step across clinics at p_now: for every active template of a clinic in use
-- whose assignee can still act (the person is active, or someone active holds the role), makes
-- the occurrences that fell due in (p_now - 24 hours, p_now] and not before the template began
-- to count, and writes their first `task_due` notice. One statement, so a second run at the same
-- time waits on the first's rows and then makes nothing. A one-off task is switched off once its
-- occurrence exists. Returns how many occurrences were made.
create function app.materialize_task_occurrences(p_now timestamptz, p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with slots as (
      select t.org_id, t.id as template_id, t.title, t.action, t.assignee_membership_id,
             t.assignee_role_id, s.local_date, s.due_at
      from aarogyam.task_templates t
      join aarogyam.organizations o on o.id = t.org_id and o.status in ('trial', 'active')
      cross join lateral app.task_due_dates(
        t.schedule_kind, t.interval_days, t.weekdays, t.starts_on, t.ends_on, t.due_time,
        t.once_at, o.timezone, p_now - interval '24 hours', p_now) s
      where t.active and t.deleted_at is null
        and s.due_at >= t.activated_at
        and exists (select 1 from aarogyam.memberships m
                    where m.org_id = t.org_id and m.status = 'active'
                      and (m.id = t.assignee_membership_id or m.role_id = t.assignee_role_id))
      order by s.due_at, t.id
      limit least(greatest(coalesce(p_limit, 500), 1), 2000)
    ),
    made as (
      insert into aarogyam.task_occurrences
        (org_id, template_id, title, action, assignee_membership_id, assignee_role_id, local_date, due_at)
      select org_id, template_id, title, action, assignee_membership_id, assignee_role_id,
             local_date, due_at
      from slots
      on conflict do nothing
      returning org_id, id, template_id
    ),
    notified as (
      insert into aarogyam.staff_notifications (org_id, kind, task_occurrence_id, step_no, href)
      select org_id, 'task_due', id, 0, '/today' from made
      on conflict do nothing
      returning 1
    ),
    closed as (
      update aarogyam.task_templates t set active = false
      from made m
      where t.org_id = m.org_id and t.id = m.template_id and t.schedule_kind = 'once' and t.active
      returning 1
    )
    select count(*)::int from made
  $$;
revoke execute on function app.materialize_task_occurrences(timestamptz, int) from public;
grant execute on function app.materialize_task_occurrences(timestamptz, int) to aarogyam_api;

-- The three standard tasks for one clinic: sterilise instruments in the morning, then at the end
-- of the day confirm the photos and record the materials used. Each is given to the role that
-- does it, or to the owner role when the clinic has no such role. A standard task that exists,
-- switched off or not, is left alone, so one the owner turned off never comes back. Returns how
-- many were added.
create function app.seed_default_tasks(p_org uuid)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    with standard (default_key, title, description, due_time, action, role_key) as (values
      ('sterilise_instruments', 'Sterilise instruments',
       'Run the day''s instruments through the autoclave before the first patient.',
       time '08:30', 'none', 'assistant'),
      ('eod_check_photos', 'Check today''s photos',
       'Make sure every patient seen today has the photos the visit needed.',
       time '19:30', 'confirm_photos', 'front_desk'),
      ('eod_record_materials', 'Record materials used today',
       'Enter the materials and consumables used today so stock stays right.',
       time '19:45', 'record_usage', 'front_desk')
    ),
    made as (
      insert into aarogyam.task_templates
        (org_id, title, description, assignee_role_id, schedule_kind, due_time, starts_on, action,
         is_default, default_key)
      select o.id, s.title, s.description, r.id, 'daily', s.due_time,
             app.clinic_local_date(now(), o.timezone), s.action, true, s.default_key
      from aarogyam.organizations o
      cross join standard s
      cross join lateral (select r.id from aarogyam.roles r
                          where r.org_id = o.id and r.key in (s.role_key, 'owner')
                          order by (r.key = s.role_key) desc limit 1) r
      where o.id = p_org
      on conflict (org_id, default_key) where default_key is not null do nothing
      returning 1
    )
    select count(*)::int from made
  $$;
revoke execute on function app.seed_default_tasks(uuid) from public;
grant execute on function app.seed_default_tasks(uuid) to aarogyam_api;

-- The drain job's step for clinics made after the backfill below: seeds up to p_limit clinics in
-- use that miss a standard task. Returns how many tasks were added.
create function app.seed_missing_default_tasks(p_limit int)
  returns int
  language sql volatile security definer set search_path = ''
  as $$
    select coalesce(sum(app.seed_default_tasks(c.id)), 0)::int
    from (select o.id
          from aarogyam.organizations o
          where o.status in ('trial', 'active')
            and (select count(*) from aarogyam.task_templates t
                 where t.org_id = o.id and t.is_default) < 3
          order by o.created_at, o.id
          limit least(greatest(coalesce(p_limit, 50), 1), 500)) c
  $$;
revoke execute on function app.seed_missing_default_tasks(int) from public;
grant execute on function app.seed_missing_default_tasks(int) to aarogyam_api;

-- Clinics that exist already get their standard tasks now.
select app.seed_default_tasks(o.id) from aarogyam.organizations o;
