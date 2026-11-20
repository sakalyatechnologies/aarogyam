-- The patient's answer to their plan (docs/plans/visit-story-design.md C5; docs/decisions.md,
-- "The patient answers their plan"). From the visit page, a patient with the link and PIN says
-- "Yes, I want to go ahead" or "I have a question" (POST /shared/{token}/plan-response).
--   * visit_plan_responses: one row per link, the latest choice wins. `shown` keeps the
--     procedure and plan-item ids the page showed, so "go ahead" still means something after
--     the plan changes. Written under the public link scope; its change history is the record
--     (access_log has no "respond" action). Erased with the patient, before the links (step 30).
--   * staff_notifications kind `plan_response`, about the visit (new subject column
--     encounter_id): one row per visit, reopened when a new choice arrives. Seen by the visit's
--     doctor and members with appointment reach (app.plan_response_visible). The row holds ids
--     only; its href is /patients/<patient id>. The push text is the generic `push.plan_response`
--     key on the device.
-- Expand only: a new table, a nullable column and wider checks.
set local lock_timeout = '5s';

create table aarogyam.visit_plan_responses (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  encounter_id uuid not null,
  patient_id uuid not null,
  share_link_id uuid not null,
  choice text not null check (choice in ('go_ahead', 'question')),
  -- [{"source": "procedure" | "plan_item", "id": "<uuid>"}, ...] as the page showed them.
  shown jsonb not null check (jsonb_typeof(shown) = 'array'),
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, encounter_id, patient_id)
    references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, share_link_id) references aarogyam.share_links (org_id, id)
);
create unique index visit_plan_responses_link
  on aarogyam.visit_plan_responses (org_id, share_link_id);
create index visit_plan_responses_encounter
  on aarogyam.visit_plan_responses (org_id, encounter_id, patient_id);
create index visit_plan_responses_patient
  on aarogyam.visit_plan_responses (org_id, patient_id);
comment on table aarogyam.visit_plan_responses is 'sensitivity=health offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.visit_plan_responses', 'mutable');
create policy no_support on aarogyam.visit_plan_responses as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');

-- Erasure (0345): before the links they belong to (step 30).
insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.visit_plan_responses', 29, 'delete', null, 'patient_id = $2',
   'answers to a visit plan');

-- 0683's list plus plan_response (about a visit).
alter table aarogyam.staff_notifications
  add column encounter_id uuid,
  drop constraint staff_notifications_kind_check,
  drop constraint staff_notifications_one_subject,
  add constraint staff_notifications_kind_check check (kind in
    ('booking_requested', 'booking_confirmed_auto', 'booking_cancelled_by_patient', 'lab_overdue',
     'arrival', 'payment_due', 'recall_due', 'patient_waiting', 'send_in', 'collect_payment',
     'task_due', 'task_reminder', 'task_escalated', 'time_off_requested', 'time_off_decided',
     'stock_alert', 'booking_conflict', 'plan_response'))
    not valid,
  add constraint staff_notifications_one_subject
    check (num_nonnulls(appointment_id, lab_order_id, invoice_id, recall_id, queue_token_id,
                        task_occurrence_id, time_off_request_id, inventory_item_id,
                        encounter_id) = 1) not valid,
  add constraint staff_notifications_encounter_subject
    check ((kind = 'plan_response') = (encounter_id is not null)) not valid,
  add constraint staff_notifications_encounter_fk
    foreign key (org_id, encounter_id) references aarogyam.encounters (org_id, id) not valid;
alter table aarogyam.staff_notifications validate constraint staff_notifications_kind_check;
alter table aarogyam.staff_notifications validate constraint staff_notifications_one_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_encounter_subject;
alter table aarogyam.staff_notifications validate constraint staff_notifications_encounter_fk;

-- One per visit and kind.
create unique index staff_notifications_encounter
  on aarogyam.staff_notifications (org_id, encounter_id, kind) where encounter_id is not null;

-- A plan answer names the patient in its href: it goes with the patient, like recall alerts.
update audit.erasure_steps
  set filter = 'recall_id in (select r.id from aarogyam.recalls r where r.patient_id = $2)'
               || ' or encounter_id in (select e.id from aarogyam.encounters e where e.patient_id = $2)',
      note = 'recall alerts and plan answers; booking, bill and lab alerts hold ids only and stay'
  where table_name = 'aarogyam.staff_notifications';

-- Who sees a plan answer: the visit's doctor (encounters.clinician_id), and members whose role
-- has appointments.read (p_bookings) reaching every doctor (p_reach null; an `own` reach is the
-- member, so it is the doctor rule again). False for every other kind.
create function app.plan_response_visible(
  n aarogyam.staff_notifications, p_member uuid, p_bookings boolean, p_reach uuid)
  returns boolean
  language sql stable set search_path = ''
  as $$
    select n.kind = 'plan_response' and exists (
      select 1 from aarogyam.encounters e
      where e.org_id = n.org_id and e.id = n.encounter_id
        and (e.clinician_id = p_member
             or (p_bookings and (p_reach is null or e.clinician_id = p_reach))))
  $$;
grant execute on function app.plan_response_visible(
  aarogyam.staff_notifications, uuid, boolean, uuid) to app_user;
