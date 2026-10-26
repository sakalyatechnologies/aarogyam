-- The unique backstop for self-bookings (0091) must not refuse a request for a time another
-- appointment holds (`requested_overlap`, 0683). Index predicates can't be altered, so the index
-- is rebuilt under the same name in one transaction: the table is locked while it runs, so there
-- is no moment without the backstop, and the app's constraint mapping
-- (`appointments_self_booking_slot` -> 409) keeps working in old and new binaries alike. The new
-- predicate is the old one minus overlap requests, so every strict booking is covered exactly as
-- before; the per-doctor advisory lock (`lock_doctor_bookings`) still serialises the checks.
set local lock_timeout = '5s';

drop index aarogyam.appointments_self_booking_slot;
create unique index appointments_self_booking_slot
  on aarogyam.appointments (org_id, practitioner_id, starts_at)
  where booked_by_account is not null and status not in ('cancelled', 'no_show')
    and deleted_at is null and not requested_overlap;
