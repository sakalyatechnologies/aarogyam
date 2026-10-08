-- Synthetic expenses for the demo clinics (sunrise, lotus, suhasyadental), so Billing → Expenses and
-- the Analytics money charts are not empty: for each of the last twelve months (this one up to
-- today) salaries, rent, electricity, two lab bills, a small material buy and one other cost.
-- Amounts are made up and vary by month. Every row's note starts "Demo:"; a month and category that
-- already has a Demo row is skipped, so it is safe to run again (each run fills in new months).
-- Never deletes or edits a row. Run by scripts/demo-refresh.sh after the date shift, with its
-- apply/dry-run variable; directly:
--   psql "$OWNER_URL" -v apply=1 -f scripts/demo-expenses.sql
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
\if :{?apply}
\else
  \set apply 0
\endif
begin;
set local timezone = 'Asia/Kolkata';

with orgs as (
  select o.id as org_id,
         -- The owner records them; any active member will do when there is no owner.
         (select m.id from aarogyam.memberships m join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
          where m.org_id = o.id and m.status = 'active' order by (r.key = 'owner') desc, m.id limit 1) as member
  from aarogyam.organizations o
  where o.slug in ('sunrise', 'lotus', 'suhasyadental')
), months as (
  select (date_trunc('month', current_date) - make_interval(months => n))::date as first_day, n
  from generate_series(0, 11) n
), plan(category, day, base_rupees, spread_rupees, note) as (
  values ('salary', 1, 185000, 6000, 'Demo: staff salaries'),
         ('rent', 5, 65000, 0, 'Demo: clinic rent'),
         ('electricity', 10, 8000, 5000, 'Demo: electricity bill'),
         ('lab', 8, 7000, 7000, 'Demo: crowns and bridges'),
         ('lab', 21, 5000, 6000, 'Demo: aligners lab'),
         ('material', 14, 3000, 4500, 'Demo: gloves and masks, local shop'),
         ('other', 18, 2000, 4000, 'Demo: housekeeping and repairs')
), wanted as (
  select o.org_id, o.member, c.id as category_id, m.first_day + (p.day - 1) as spent_on, p.note,
         -- A stable pseudo-random amount per clinic, month and line, in whole rupees.
         (p.base_rupees + (abs(hashtext(o.org_id::text || m.first_day::text || p.note)) % (p.spread_rupees + 1))) * 100 as amount_paise
  from orgs o
  cross join months m
  cross join plan p
  join aarogyam.expense_categories c on c.org_id = o.org_id and c.key = p.category
  where o.member is not null and m.first_day + (p.day - 1) <= current_date
), added as (
  insert into aarogyam.expenses (org_id, category_id, spent_on, amount_paise, note, recorded_by)
  select w.org_id, w.category_id, w.spent_on, w.amount_paise, w.note, w.member
  from wanted w
  where not exists (select 1 from aarogyam.expenses e
                    where e.org_id = w.org_id and e.spent_on = w.spent_on and e.note = w.note)
  returning 1
)
select count(*) from added \gset
\echo 'demo expenses added: ' :count

\if :apply
commit;
\else
rollback;
\endif
