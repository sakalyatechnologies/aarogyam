-- Labs directory (docs/decisions.md, "Labs directory and batch reminders"). A lab gains its
-- city, the kinds of work it does and its usual turnaround, for the labs page and for choosing
-- where to send. Expand only: existing rows and clients are unchanged. (The batch reminder
-- needs no schema: it reuses the outbox's `lab_order.reminder` event with a list of orders.)
set local lock_timeout = '5s';

-- Up to 20 different work types of 1 to 40 characters each, on one line.
create function app.lab_work_types_valid(p_types text[]) returns boolean
  language sql immutable set search_path = ''
  as $$
    select coalesce(array_length(p_types, 1), 0) <= 20
       and not exists (select 1 from unnest(p_types) t
                       where t is null or char_length(btrim(t)) not between 1 and 40
                          or t ~ '[[:cntrl:]]')
       and (select count(distinct lower(btrim(t))) from unnest(p_types) t)
           = coalesce(array_length(p_types, 1), 0)
  $$;
grant execute on function app.lab_work_types_valid(text[]) to app_user;

alter table aarogyam.lab_vendors
  add column city text check (char_length(btrim(city)) between 1 and 80),
  add column work_types text[] not null default '{}' check (app.lab_work_types_valid(work_types)),
  add column turnaround_days smallint check (turnaround_days between 1 and 90);
