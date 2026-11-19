-- Walk-ins on the calendar (docs/decisions.md, "Walk-ins on the calendar"): GET
-- /calendar/walk-ins lists visits with no appointment that started in a range of local days.
-- This partial index serves that read; visits booked through an appointment are left out of it.
set local lock_timeout = '5s';

create index encounters_walk_in_started on aarogyam.encounters (org_id, started_at)
  where appointment_id is null;
