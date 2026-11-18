-- Recurring expenses: rent, salaries and other amounts the clinic pays every month or every
-- week (docs/decisions.md, "Recurring expenses"). A rule records an ordinary expense on each due
-- day; the outbox drain job runs the pass, so there is no new job or schedule.
--
-- A monthly rule names a day of the month (1 to 31; a shorter month uses its last day); a
-- weekly one names a weekday (Monday = 1). next_due_on is the next day it records an expense. A
-- rule is paused and resumed, or stopped for good; ends_on stops it after that day. Changing a
-- rule only changes what it records next: recorded expenses never change.
--
-- expenses.recurring_expense_id names the rule that recorded an expense, and the unique index on
-- (rule, day) makes the pass safe to run twice. Expand only: the column is nullable.
set local lock_timeout = '5s';

create table aarogyam.recurring_expenses (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  category_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 1000000000),
  method text check (method in ('cash', 'upi', 'card', 'bank')),
  note text check (char_length(btrim(note)) between 1 and 300),
  cadence text not null check (cadence in ('monthly', 'weekly')),
  day_of_month smallint check (day_of_month between 1 and 31),
  weekday smallint check (weekday between 1 and 7),
  starts_on date not null,
  ends_on date,
  -- The next clinic day this rule records an expense.
  next_due_on date not null,
  paused_at timestamptz,
  stopped_at timestamptz,
  -- Whose name the recorded expenses carry: the member who set the rule up.
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, category_id) references aarogyam.expense_categories (org_id, id),
  foreign key (org_id, recorded_by) references aarogyam.memberships (org_id, id),
  check ((cadence = 'monthly' and day_of_month is not null and weekday is null)
      or (cadence = 'weekly' and weekday is not null and day_of_month is null)),
  check (ends_on is null or ends_on >= starts_on),
  check (next_due_on >= starts_on)
);
create index recurring_expenses_category on aarogyam.recurring_expenses (org_id, category_id);
create index recurring_expenses_recorded_by on aarogyam.recurring_expenses (org_id, recorded_by);
-- The pass reads only this: active rules by due day, across clinics.
create index recurring_expenses_due on aarogyam.recurring_expenses (next_due_on)
  where paused_at is null and stopped_at is null;
comment on table aarogyam.recurring_expenses is 'sensitivity=financial offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.recurring_expenses', 'mutable');
-- A rule is never deleted; stopping it keeps the record of what it recorded.
revoke delete on aarogyam.recurring_expenses from app_user;

alter table aarogyam.expenses add column recurring_expense_id uuid,
  add constraint expenses_recurring_expense_fk foreign key (org_id, recurring_expense_id)
    references aarogyam.recurring_expenses (org_id, id);
comment on column aarogyam.expenses.recurring_expense_id is 'The recurring expense that recorded it; null when recorded by hand.';
create unique index expenses_recurring_day on aarogyam.expenses (org_id, recurring_expense_id, spent_on)
  where recurring_expense_id is not null;

-- The first due day after p_after. Monthly: day p_day of that month or the next, or the month's
-- last day when it is shorter. Weekly: the next day with ISO weekday p_weekday (Monday = 1).
create function app.recurring_due_after(p_cadence text, p_day int, p_weekday int, p_after date)
  returns date
  language sql immutable set search_path = ''
  as $$
    select case p_cadence
      when 'weekly' then
        p_after + ((p_weekday - extract(isodow from p_after)::int + 6) % 7) + 1
      else (
        select case when x.this_month > p_after then x.this_month else x.next_month end
        from (
          select m.m0 + (least(p_day, extract(day from m.m0 + interval '1 month - 1 day')::int) - 1)
                   as this_month,
                 (m.m0 + interval '1 month')::date
                   + (least(p_day, extract(day from m.m0 + interval '2 month - 1 day')::int) - 1)
                   as next_month
          from (select make_date(extract(year from p_after)::int, extract(month from p_after)::int, 1)
                       as m0) m
        ) x
      )
    end
  $$;
grant execute on function app.recurring_due_after(text, int, int, date) to app_user;

-- The pass, across clinics: for each active rule due by the clinic's today, record an expense
-- for every due day up to today (at most 12 per rule per run; the next run catches up the rest),
-- then move next_due_on on. A day already recorded is skipped through expenses_recurring_day,
-- and next_due_on only moves from the value read, so overlapping runs record each day once.
-- Returns one row per rule it moved, with how many expenses it recorded.
create function app.run_recurring_expenses(p_now timestamptz, p_limit int)
  returns table (org_id uuid, recurring_expense_id uuid, recorded int)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    r record;
    v_due date;
    v_steps int;
  begin
    for r in
      select x.* from (
        select e.org_id, e.id, e.category_id, e.amount_paise, e.method, e.note, e.cadence,
               e.day_of_month, e.weekday, e.ends_on, e.next_due_on, e.recorded_by,
               app.clinic_local_date(p_now, g.timezone) as today
        from aarogyam.recurring_expenses e
        join aarogyam.organizations g on g.id = e.org_id
        -- No clinic's today is more than a day past UTC's, so the index does the work.
        where e.paused_at is null and e.stopped_at is null
          and e.next_due_on <= (p_now at time zone 'UTC')::date + 1
          and (e.ends_on is null or e.next_due_on <= e.ends_on)
          and g.status in ('trial', 'active')
      ) x
      where x.next_due_on <= x.today
      order by x.next_due_on, x.id
      limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    loop
      v_due := r.next_due_on;
      v_steps := 0;
      recorded := 0;
      while v_due <= r.today and (r.ends_on is null or v_due <= r.ends_on) and v_steps < 12 loop
        insert into aarogyam.expenses (org_id, category_id, spent_on, amount_paise, note, method,
                                       recorded_by, recurring_expense_id)
        values (r.org_id, r.category_id, v_due, r.amount_paise, r.note, r.method, r.recorded_by,
                r.id)
        on conflict (org_id, recurring_expense_id, spent_on) where recurring_expense_id is not null
          do nothing;
        if found then
          recorded := recorded + 1;
        end if;
        v_steps := v_steps + 1;
        v_due := app.recurring_due_after(r.cadence, r.day_of_month, r.weekday, v_due);
      end loop;
      update aarogyam.recurring_expenses e set next_due_on = v_due
      where e.org_id = r.org_id and e.id = r.id and e.next_due_on = r.next_due_on;
      continue when not found;
      org_id := r.org_id;
      recurring_expense_id := r.id;
      return next;
    end loop;
  end
  $$;
grant execute on function app.run_recurring_expenses(timestamptz, int) to aarogyam_api;
