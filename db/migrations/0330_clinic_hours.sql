-- Clinic opening hours: the weekly hours each branch is open, split shifts as two rows. Until
-- now only each doctor's hours were stored (the setup wizard copied the clinic's hours onto
-- every doctor), so chair utilization assumed nine hours a day (docs/decisions.md, "Analytics:
-- chair utilization and material costs"). Replaced as a whole per branch, so rows are
-- ephemeral, like working_hours.
--
-- Clinics that exist get their hours derived once from their doctors' hours: per branch and
-- weekday, the union of active doctors' shifts, with overlapping or touching shifts merged.
set local lock_timeout = '5s';

create table aarogyam.clinic_hours (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  branch_id uuid not null,
  -- ISO weekday: 1 Monday to 7 Sunday.
  weekday smallint not null check (weekday between 1 and 7),
  starts time not null,
  ends time not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id),
  check (starts < ends)
);
create index clinic_hours_branch on aarogyam.clinic_hours (org_id, branch_id, weekday, starts);
comment on table aarogyam.clinic_hours is 'sensitivity=internal offline=read_only lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.clinic_hours', 'ephemeral');

with shifts as (
  select w.org_id, w.branch_id, w.weekday, w.starts, w.ends,
         max(w.ends) over (partition by w.org_id, w.branch_id, w.weekday
                           order by w.starts, w.ends
                           rows between unbounded preceding and 1 preceding) as reach
  from aarogyam.working_hours w
  join aarogyam.practitioners p on p.org_id = w.org_id and p.id = w.practitioner_id
  where p.active and p.deleted_at is null
), islands as (
  select *, sum(case when reach is null or starts > reach then 1 else 0 end)
              over (partition by org_id, branch_id, weekday order by starts, ends) as island
  from shifts
)
insert into aarogyam.clinic_hours (org_id, branch_id, weekday, starts, ends)
select org_id, branch_id, weekday, min(starts), max(ends)
from islands
group by org_id, branch_id, weekday, island;
