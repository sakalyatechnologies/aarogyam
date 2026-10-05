-- Patient self-booking: a `requested` status for bookings the front desk hasn't confirmed, and
-- the verified sign-in identity (Supabase auth id) that made one, so a person's open bookings
-- can be capped. Two self-bookings can never take the same doctor at the same start: the API
-- also serialises them per doctor and checks the whole slot; this index is the backstop.
set local lock_timeout = '5s';

alter table aarogyam.appointments drop constraint appointments_status_check;
alter table aarogyam.appointments add constraint appointments_status_check
  check (status in ('requested', 'booked', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show'));
alter table aarogyam.appointment_events drop constraint appointment_events_from_status_check;
alter table aarogyam.appointment_events add constraint appointment_events_from_status_check
  check (from_status in ('requested', 'booked', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show'));
alter table aarogyam.appointment_events drop constraint appointment_events_to_status_check;
alter table aarogyam.appointment_events add constraint appointment_events_to_status_check
  check (to_status in ('requested', 'booked', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show'));

-- Who booked it themselves: the Supabase auth id of the verified person; null for staff bookings.
alter table aarogyam.appointments add column booked_by_account uuid;
create index appointments_booked_by_account on aarogyam.appointments (org_id, booked_by_account)
  where booked_by_account is not null;
create unique index appointments_self_booking_slot
  on aarogyam.appointments (org_id, practitioner_id, starts_at)
  where booked_by_account is not null and status not in ('cancelled', 'no_show') and deleted_at is null;
