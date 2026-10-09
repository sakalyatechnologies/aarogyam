-- Notifications for clinic staff about online bookings, per-person read state, and the clinic
-- inbox that reminders and escalations write to. IDs only: never a patient's name, phone or
-- reason, so a notification can be shown, pushed or logged without patient data.
--
-- Who sees a notification is decided when it is read, not stored: every member whose role has
-- appointments.read and whose scope reaches the appointment's doctor (app.practitioner_in_reach).
-- See docs/decisions.md, "Clinic notifications, reminders and escalation".
set local lock_timeout = '5s';

create table aarogyam.staff_notifications (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  kind text not null
    check (kind in ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient')),
  appointment_id uuid not null,
  -- Set in the same transaction as the appointment is confirmed, declined or cancelled.
  handled_at timestamptz,
  -- Who did it; null when the patient cancelled or the change came from no member.
  handled_by uuid,
  -- The reminder job's steps: everyone reminded, then the owners told.
  reminded_at timestamptz,
  escalated_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, appointment_id) references aarogyam.appointments (org_id, id),
  foreign key (org_id, handled_by) references aarogyam.memberships (org_id, id),
  check (handled_by is null or handled_at is not null),
  check (escalated_at is null or reminded_at is not null)
);
-- The feed reads the primary key backwards: ids are version 7 UUIDs, so they sort by time.
create index staff_notifications_appointment on aarogyam.staff_notifications (org_id, appointment_id);
create index staff_notifications_handled_by on aarogyam.staff_notifications (org_id, handled_by)
  where handled_by is not null;
-- The reminder job's queue across clinics: booking requests nobody has answered.
create index staff_notifications_open on aarogyam.staff_notifications (created_at)
  where kind = 'booking_requested' and handled_at is null and escalated_at is null;
comment on table aarogyam.staff_notifications is 'sensitivity=internal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.staff_notifications', 'mutable');
insert into audit.audit_config (table_name, exclude) values
  ('aarogyam.staff_notifications', '{reminded_at,escalated_at}');

-- One row per member who has read a notification.
create table aarogyam.staff_notification_reads (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  notification_id uuid not null,
  membership_id uuid not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, notification_id, membership_id),
  foreign key (org_id, notification_id) references aarogyam.staff_notifications (org_id, id),
  foreign key (org_id, membership_id) references aarogyam.memberships (org_id, id)
);
create index staff_notification_reads_member
  on aarogyam.staff_notification_reads (org_id, membership_id, notification_id);
comment on table aarogyam.staff_notification_reads is 'sensitivity=internal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.staff_notification_reads', 'append_only');
-- Reading is not a change worth a full history row each time.
insert into audit.audit_config (table_name, metadata_only) values
  ('aarogyam.staff_notification_reads', true);

-- The clinic inbox: a message stays until its booking is handled (the notification's
-- handled_at), unlike a toast. Written by the reminder job only.
create table aarogyam.staff_inbox_messages (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  kind text not null check (kind in ('booking_reminder', 'booking_escalation')),
  -- clinic: everyone who sees the notification; owners: members with the owner role.
  audience text not null check (audience in ('clinic', 'owners')),
  notification_id uuid not null,
  appointment_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, notification_id, kind),
  foreign key (org_id, notification_id) references aarogyam.staff_notifications (org_id, id),
  foreign key (org_id, appointment_id) references aarogyam.appointments (org_id, id),
  check ((kind = 'booking_reminder') = (audience = 'clinic'))
);
create index staff_inbox_messages_appointment on aarogyam.staff_inbox_messages (org_id, appointment_id);
comment on table aarogyam.staff_inbox_messages is 'sensitivity=internal offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.staff_inbox_messages', 'append_only');

-- A patient cancelling in the app acts as a patient account, which may not see staff tables
-- (0261). This marks the appointment's open notifications handled and tells the clinic, after
-- checking the appointment is the linked patient's own and is cancelled.
create function app.notify_patient_cancelled(p_appointment_id uuid)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    with appt as (
      select a.org_id, a.id from aarogyam.appointments a
      where (select app.actor_kind()) = 'patient_account'
        and a.org_id = (select app.tenant_id()) and a.id = p_appointment_id
        and a.patient_id = (select app.linked_patient_id()) and a.status = 'cancelled'
    ),
    handled as (
      update aarogyam.staff_notifications n set handled_at = now()
      from appt where n.org_id = appt.org_id and n.appointment_id = appt.id and n.handled_at is null
      returning n.id
    )
    insert into aarogyam.staff_notifications (org_id, kind, appointment_id)
    select appt.org_id, 'booking_cancelled_by_patient', appt.id from appt
  $$;
revoke execute on function app.notify_patient_cancelled(uuid) from public;
grant execute on function app.notify_patient_cancelled(uuid) to app_user;

-- The clinic's wall-clock time at p_at; India's when the clinic's zone is unknown to Postgres.
create function app.clinic_local_time(p_at timestamptz, p_timezone text)
  returns time
  language plpgsql stable set search_path = ''
  as $$
  begin
    return (p_at at time zone p_timezone)::time;
  exception when invalid_parameter_value then
    return (p_at at time zone 'Asia/Kolkata')::time;
  end
  $$;
revoke execute on function app.clinic_local_time(timestamptz, text) from public;

-- The reminder job's work across clinics at p_now (the job's clock): booking requests nobody
-- has answered, at least p_min_minutes old, whose appointment is still requested and in the
-- future, at clinics in use. With each, the clinic's local time and booking settings.
create function app.open_booking_requests(p_now timestamptz, p_min_minutes int, p_limit int)
  returns table (org_id uuid, id uuid, created_at timestamptz, reminded_at timestamptz,
                 local_now time, booking jsonb)
  language sql stable security definer set search_path = ''
  as $$
    select n.org_id, n.id, n.created_at, n.reminded_at,
           app.clinic_local_time(p_now, o.timezone), coalesce(s.booking, '{}')
    from aarogyam.staff_notifications n
    join aarogyam.appointments a on a.org_id = n.org_id and a.id = n.appointment_id
    join aarogyam.organizations o on o.id = n.org_id
    left join aarogyam.org_settings s on s.org_id = n.org_id
    where n.kind = 'booking_requested' and n.handled_at is null and n.escalated_at is null
      and n.created_at <= p_now - make_interval(mins => greatest(coalesce(p_min_minutes, 5), 1))
      and a.status = 'requested' and a.deleted_at is null and a.starts_at > p_now
      and o.status in ('trial', 'active')
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  $$;

-- Records one step for a booking request at p_now and leaves its inbox message, once: 'remind'
-- sets reminded_at and writes a message for the clinic; 'escalate' sets escalated_at and writes one
-- for the owners. Returns the message id, or null when the step was already taken or the
-- request was handled meanwhile.
create function app.record_booking_request_step(p_org_id uuid, p_id uuid, p_step text,
                                                p_now timestamptz)
  returns uuid
  language sql volatile security definer set search_path = ''
  as $$
    with stepped as (
      update aarogyam.staff_notifications n
        set reminded_at = case when p_step = 'remind' then p_now else n.reminded_at end,
            escalated_at = case when p_step = 'escalate' then p_now else n.escalated_at end
      where n.org_id = p_org_id and n.id = p_id and n.kind = 'booking_requested'
        and n.handled_at is null and n.escalated_at is null
        and ((p_step = 'remind' and n.reminded_at is null)
             or (p_step = 'escalate' and n.reminded_at is not null))
      returning n.org_id, n.id, n.appointment_id
    )
    insert into aarogyam.staff_inbox_messages (org_id, kind, audience, notification_id, appointment_id)
    select s.org_id,
           case when p_step = 'remind' then 'booking_reminder' else 'booking_escalation' end,
           case when p_step = 'remind' then 'clinic' else 'owners' end,
           s.id, s.appointment_id
    from stepped s
    on conflict (org_id, notification_id, kind) do nothing
    returning id
  $$;

revoke execute on function app.open_booking_requests(timestamptz, int, int) from public;
revoke execute on function app.record_booking_request_step(uuid, uuid, text, timestamptz) from public;
grant execute on function app.open_booking_requests(timestamptz, int, int) to aarogyam_api;
grant execute on function app.record_booking_request_step(uuid, uuid, text, timestamptz) to aarogyam_api;
