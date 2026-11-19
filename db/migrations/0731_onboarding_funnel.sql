-- The onboarding funnel for the console's Insights page (docs/plans/console-insights-design.md, 1c),
-- computed on read from existing tables, one row per clinic: when it was created, when its owner
-- joined, setup steps done, the first patient, visit and bill, and the first week (clinic time)
-- with 5 or more visits. Dates and counts only: never a patient, a name or an amount.
set local lock_timeout = '5s';

create function app.console_onboarding()
  returns table (org_id uuid, slug text, name text, status text, created_at timestamptz,
                 owner_joined_at timestamptz, setup_steps_done int, setup_completed_at timestamptz,
                 first_patient_at timestamptz, first_visit_at timestamptz,
                 first_bill_at timestamptz, first_busy_week date)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.name, o.status, o.created_at,
           (select min(m.joined_at) from aarogyam.memberships m
              join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
             where m.org_id = o.id and r.key = 'owner'),
           coalesce((select count(*) from aarogyam.clinic_setup cs, jsonb_each_text(cs.steps) st
                      where cs.org_id = o.id and st.value = 'done'), 0)::int,
           (select cs.completed_at from aarogyam.clinic_setup cs where cs.org_id = o.id),
           (select min(p.created_at) from aarogyam.patients p where p.org_id = o.id),
           (select min(e.started_at) from aarogyam.encounters e where e.org_id = o.id),
           (select min(i.issued_at) from aarogyam.invoices i
             where i.org_id = o.id and i.issued_at is not null),
           (select w.week from (
               select date_trunc('week', e.started_at at time zone o.timezone)::date as week
               from aarogyam.encounters e where e.org_id = o.id) w
             group by w.week having count(*) >= 5 order by w.week limit 1)
    from aarogyam.organizations o
    order by o.created_at desc, o.id
  $$;

grant execute on function app.console_onboarding() to aarogyam_api;
