-- Local development data: two fictional clinics with synthetic patients. Never real people.
-- Runs as the owner (scripts/dev-db.sh --seed) after migrations; safe to run once per database.
-- Fixed IDs so the dev sign-in can mint tokens for these people (auth_uid = token `sub`).
-- Portal hosts come from the psql variable portal_host_template, the API's
-- hosts.portal_host_template (`{slug}.localtest.me` locally; see docs/deploy.md for the demo).
--
--   Sunrise Dental     sunrise.localtest.me   owner Asha, doctor Dev, front desk Farah; two chairs and
--                                             today's appointments and queue around the time of seeding
--   Lotus Dental Care  lotus.localtest.me     owner Bina; Dev also consults here
--   Console            Sakalya Admin (platform owner)
--   Billing            then demo-billing.sql adds Sunrise's bills and receipts
\set ON_ERROR_STOP 1
\if :{?portal_host_template}
\else
  \set portal_host_template '{slug}.localtest.me'
\endif
begin;

insert into aarogyam.users (id, auth_uid, display_name, email, phone_e164) values
  ('01920000-0000-7000-8000-0000000000a1', 'a1a1a1a1-0000-4000-8000-000000000001', 'Asha Kulkarni', 'asha@sunrise.example', '+919800000001'),
  ('01920000-0000-7000-8000-0000000000a2', 'a1a1a1a1-0000-4000-8000-000000000002', 'Dr Dev Rao', 'dev@sunrise.example', '+919800000002'),
  ('01920000-0000-7000-8000-0000000000a3', 'a1a1a1a1-0000-4000-8000-000000000003', 'Farah Shaikh', 'farah@sunrise.example', '+919800000003'),
  ('01920000-0000-7000-8000-0000000000b1', 'b1b1b1b1-0000-4000-8000-000000000001', 'Bina Joshi', 'bina@lotus.example', '+919800000011');

-- Sakalya staff for the console.
insert into aarogyam.users (id, auth_uid, display_name, email) values
  ('01920000-0000-7000-8000-0000000000c1', 'c1c1c1c1-0000-4000-8000-000000000001', 'Sakalya Admin', 'admin@sakalya.example');
insert into aarogyam.platform_users (user_id, role) values ('01920000-0000-7000-8000-0000000000c1', 'owner');

select app.create_clinic('sunrise', 'Sunrise Dental', 'SD', 'dental', replace(:'portal_host_template', '{slug}', 'sunrise'),
                         '01920000-0000-7000-8000-0000000000a1') as sunrise \gset
select app.create_clinic('lotus', 'Lotus Dental Care', 'LD', 'dental', replace(:'portal_host_template', '{slug}', 'lotus'),
                         '01920000-0000-7000-8000-0000000000b1') as lotus \gset

insert into aarogyam.memberships (org_id, user_id, role_id, status, joined_at)
select :'sunrise', u.id, r.id, 'active', now()
from (values ('01920000-0000-7000-8000-0000000000a2'::uuid, 'doctor'),
             ('01920000-0000-7000-8000-0000000000a3'::uuid, 'front_desk')) as u(id, role_key)
join aarogyam.roles r on r.org_id = :'sunrise' and r.key = u.role_key;

insert into aarogyam.memberships (org_id, user_id, role_id, status, joined_at)
select :'lotus', '01920000-0000-7000-8000-0000000000a2', r.id, 'active', now()
from aarogyam.roles r where r.org_id = :'lotus' and r.key = 'consultant';

-- Patients, numbered the way the API numbers them.
select set_config('app.tenant_id', :'sunrise', true) \gset
insert into aarogyam.patients (number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, preferred_language)
select 'SD-' || app.next_number('patient'), p.name, p.sex, p.dob, p.estimated, p.phone, p.lang
from (values
  ('Priya Sharma', 'female', date '1990-04-12', false, '+919810000001', 'en-IN'),
  ('Rahul Verma', 'male', date '1985-11-03', false, '+919810000002', 'hi-IN'),
  ('Sneha Patil', 'female', date '1996-01-25', false, '+919810000003', 'mr-IN'),
  ('Arjun Nair', 'male', date '1978-07-19', false, '+919810000004', 'en-IN'),
  ('Kavya Iyer', 'female', date '2012-09-30', false, '+919810000005', 'en-IN'),
  ('Rohan Deshmukh', 'male', date '1970-01-01', true, '+919810000006', 'mr-IN'),
  ('Meera Pillai', 'female', date '1988-03-08', false, '+919810000007', 'en-IN'),
  ('Vikram Singh', 'male', date '1965-12-14', false, '+919810000008', 'hi-IN'),
  ('Ananya Gupta', 'female', date '2001-06-21', false, '+919810000009', 'hi-IN'),
  ('Siddharth Joshi', 'male', date '1993-10-10', false, '+919810000002', 'en-IN'),
  ('Pooja Kulkarni', 'female', date '1999-02-17', false, null, 'mr-IN'),
  ('Imran Khan', 'male', date '1982-05-29', false, '+919810000012', 'hi-IN')
) as p(name, sex, dob, estimated, phone, lang);

select set_config('app.tenant_id', :'lotus', true) \gset
insert into aarogyam.patients (number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, preferred_language)
select 'LD-' || app.next_number('patient'), p.name, p.sex, p.dob, false, p.phone, 'en-IN'
from (values
  ('Priya Sharma', 'female', date '1975-08-02', '+919820000001'),
  ('Nikhil Bhosale', 'male', date '1991-04-04', '+919820000002'),
  ('Divya Menon', 'female', date '1987-12-12', '+919820000003'),
  ('Aditya Kapoor', 'male', date '2005-03-15', '+919820000004'),
  ('Lakshmi Rao', 'female', date '1958-09-09', '+919820000005')
) as p(name, sex, dob, phone);

-- Sunrise's price list: clinical services are exempt (bill of supply); products carry GST.
select set_config('app.tenant_id', :'sunrise', true) \gset
update aarogyam.organizations set legal_name = 'Sunrise Dental Care LLP', gstin = '27AAPFU0939F1ZV'
  where id = :'sunrise';
update aarogyam.branches set state_code = '27' where org_id = :'sunrise' and is_default;
insert into aarogyam.price_items (code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps)
values
  ('CONS', 'Consultation', 'consultation', '9993', 50000, false, 0),
  ('XRAY', 'X-ray (IOPA)', 'diagnostics', '9993', 30000, false, 0),
  ('SCAL', 'Scaling and polishing', 'preventive', '9993', 150000, false, 0),
  ('FILL', 'Composite filling', 'restorative', '9993', 200000, false, 0),
  ('RCT', 'Root canal treatment', 'endodontics', '9993', 650000, false, 0),
  ('EXT', 'Extraction', 'surgery', '9993', 150000, false, 0),
  ('CRWN', 'Ceramic crown', 'prosthodontics', '9993', 900000, false, 0),
  ('TPST', 'Sensitivity toothpaste', 'products', '3306', 18000, true, 1800),
  ('MWSH', 'Chlorhexidine mouthwash', 'products', '3004', 15000, true, 1200);
-- Sunrise's stock: synthetic materials in the shapes of the dashboard (critical, low, ok) and
-- one batch about to expire.
select set_config('app.tenant_id', :'sunrise', true) \gset
insert into aarogyam.suppliers (id, name, phone_e164, gstin) values
  ('01920000-0000-7000-8000-00000000d001', 'Pune Dental Depot', '+919800010001', '27AABCP1234F1Z5'),
  ('01920000-0000-7000-8000-00000000d002', 'MedSupply Traders', '+919800010002', null);
insert into aarogyam.inventory_items (id, name, category, unit, reorder_level) values
  ('01920000-0000-7000-8000-00000000d101', 'Composite A2', 'restorative', 'piece', 40),
  ('01920000-0000-7000-8000-00000000d102', 'Brackets 022', 'ortho', 'piece', 30),
  ('01920000-0000-7000-8000-00000000d103', 'Implant 4.2x10', 'surgical', 'piece', 30),
  ('01920000-0000-7000-8000-00000000d104', 'Gloves (box)', 'disposables', 'box', 50),
  ('01920000-0000-7000-8000-00000000d105', 'Anesthetic cartridges', 'anesthesia', 'piece', 20),
  ('01920000-0000-7000-8000-00000000d106', 'Polish cups', 'disposables', 'piece', 40);
insert into aarogyam.stock_batches (id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity, unit_cost_paise, received_on)
values
  ('01920000-0000-7000-8000-00000000d201', '01920000-0000-7000-8000-00000000d101', '01920000-0000-7000-8000-00000000d001', 'CMP-2611', current_date + 400, 4, 4, 45000, current_date - 40),
  ('01920000-0000-7000-8000-00000000d202', '01920000-0000-7000-8000-00000000d102', '01920000-0000-7000-8000-00000000d001', 'BRK-0942', null, 32, 32, 8000, current_date - 60),
  ('01920000-0000-7000-8000-00000000d203', '01920000-0000-7000-8000-00000000d103', '01920000-0000-7000-8000-00000000d002', 'IMP-7710', current_date + 700, 12, 12, 320000, current_date - 90),
  ('01920000-0000-7000-8000-00000000d204', '01920000-0000-7000-8000-00000000d104', '01920000-0000-7000-8000-00000000d002', 'GLV-3320', current_date + 500, 58, 58, 28000, current_date - 20),
  ('01920000-0000-7000-8000-00000000d205', '01920000-0000-7000-8000-00000000d105', '01920000-0000-7000-8000-00000000d001', 'ANE-1180', current_date + 21, 10, 10, 1800, current_date - 200),
  ('01920000-0000-7000-8000-00000000d206', '01920000-0000-7000-8000-00000000d105', '01920000-0000-7000-8000-00000000d001', 'ANE-1275', current_date + 300, 12, 12, 1850, current_date - 15),
  ('01920000-0000-7000-8000-00000000d207', '01920000-0000-7000-8000-00000000d106', '01920000-0000-7000-8000-00000000d002', null, null, 9, 9, 600, current_date - 30);
insert into aarogyam.stock_movements (item_id, batch_id, kind, quantity, reason)
select item_id, id, 'receive', received_quantity, null from aarogyam.stock_batches;
-- Front desk at Sunrise: two chairs, two doctors with hours, and today's appointments and queue
-- placed around the moment the seed runs, so Today has live data.
select set_config('app.tenant_id', :'sunrise', true) \gset
select id as sunrise_branch, replace(id::text, '-', '') as sunrise_series
from aarogyam.branches where org_id = :'sunrise' and is_default \gset
select date_trunc('hour', now()) + floor(extract(minute from now()) / 5) * interval '5 minutes' as base,
       (now() at time zone 'Asia/Kolkata')::date::text as clinic_day \gset

insert into aarogyam.rooms (id, branch_id, name, sort_order) values
  ('01920000-0000-7000-8000-00000000c101', :'sunrise_branch', 'Chair 1', 1),
  ('01920000-0000-7000-8000-00000000c102', :'sunrise_branch', 'Chair 2', 2);

insert into aarogyam.practitioners (id, membership_id, display_name, registration_number, specialty, calendar_color)
select d.id, m.id, d.name, d.registration, d.specialty, d.color
from (values
  ('01920000-0000-7000-8000-00000000d101'::uuid, '01920000-0000-7000-8000-0000000000a2'::uuid,
   'Dr Dev Rao', 'A-12345', 'Endodontics', '#136650'),
  ('01920000-0000-7000-8000-00000000d102'::uuid, '01920000-0000-7000-8000-0000000000a1'::uuid,
   'Dr Asha Kulkarni', 'A-23456', 'Orthodontics', '#4F46E5')
) as d(id, user_id, name, registration, specialty, color)
join aarogyam.memberships m on m.org_id = :'sunrise' and m.user_id = d.user_id;

-- Every day, so the dashboard always has a team; Dev works split shifts.
insert into aarogyam.working_hours (practitioner_id, branch_id, weekday, starts, ends)
select h.doctor, :'sunrise_branch', d, h.starts::time, h.ends::time
from (values
  ('01920000-0000-7000-8000-00000000d101'::uuid, '09:00', '13:00'),
  ('01920000-0000-7000-8000-00000000d101'::uuid, '17:00', '21:00'),
  ('01920000-0000-7000-8000-00000000d102'::uuid, '10:00', '14:00')
) as h(doctor, starts, ends)
cross join generate_series(1, 7) as d;

-- Offsets from now: one seen, one in the chair, one late, one waiting, one no-show, two to come.
insert into aarogyam.appointments
  (id, patient_id, practitioner_id, branch_id, room_id, starts_at, ends_at, status, kind, reason,
   arrived_at, seated_at, completed_at)
select a.id, p.id, a.doctor, :'sunrise_branch', a.room,
       :'base'::timestamptz + a.starts, :'base'::timestamptz + a.starts + a.length, a.status, a.kind, a.reason,
       :'base'::timestamptz + a.arrived, :'base'::timestamptz + a.seated, :'base'::timestamptz + a.completed
from (values
  ('01920000-0000-7000-8000-00000000e101'::uuid, 'SD-1', '01920000-0000-7000-8000-00000000d101'::uuid,
   '01920000-0000-7000-8000-00000000c101'::uuid, interval '-2 hours', interval '30 minutes', 'completed',
   'follow_up', 'Scaling', interval '-125 minutes', interval '-2 hours', interval '-90 minutes'),
  ('01920000-0000-7000-8000-00000000e102'::uuid, 'SD-2', '01920000-0000-7000-8000-00000000d101'::uuid,
   '01920000-0000-7000-8000-00000000c101'::uuid, interval '-20 minutes', interval '45 minutes', 'in_chair',
   'procedure', 'Root canal, sitting 2', interval '-30 minutes', interval '-20 minutes', null::interval),
  ('01920000-0000-7000-8000-00000000e103'::uuid, 'SD-3', '01920000-0000-7000-8000-00000000d102'::uuid,
   '01920000-0000-7000-8000-00000000c102'::uuid, interval '-25 minutes', interval '30 minutes', 'booked',
   'follow_up', 'Braces review', null::interval, null::interval, null::interval),
  ('01920000-0000-7000-8000-00000000e104'::uuid, 'SD-4', '01920000-0000-7000-8000-00000000d102'::uuid,
   '01920000-0000-7000-8000-00000000c102'::uuid, interval '10 minutes', interval '30 minutes', 'arrived',
   'new', 'Toothache', interval '-35 minutes', null::interval, null::interval),
  ('01920000-0000-7000-8000-00000000e105'::uuid, 'SD-5', '01920000-0000-7000-8000-00000000d101'::uuid,
   '01920000-0000-7000-8000-00000000c102'::uuid, interval '-3 hours', interval '30 minutes', 'no_show',
   'follow_up', 'Filling check', null::interval, null::interval, null::interval),
  ('01920000-0000-7000-8000-00000000e106'::uuid, 'SD-6', '01920000-0000-7000-8000-00000000d101'::uuid,
   '01920000-0000-7000-8000-00000000c101'::uuid, interval '1 hour', interval '30 minutes', 'booked',
   'new', 'Consultation', null::interval, null::interval, null::interval),
  ('01920000-0000-7000-8000-00000000e107'::uuid, 'SD-7', '01920000-0000-7000-8000-00000000d102'::uuid,
   '01920000-0000-7000-8000-00000000c102'::uuid, interval '90 minutes', interval '30 minutes', 'confirmed',
   'procedure', 'Aligner fitting', null::interval, null::interval, null::interval)
) as a(id, number, doctor, room, starts, length, status, kind, reason, arrived, seated, completed)
join aarogyam.patients p on p.org_id = :'sunrise' and p.number = a.number;

insert into aarogyam.appointment_events (appointment_id, kind, at)
select id, 'booked', starts_at - interval '1 day' from aarogyam.appointments where org_id = :'sunrise';

-- Queue tokens for the arrivals, numbered in arrival order; the sequence continues from them.
insert into aarogyam.queue_tokens
  (branch_id, day, token_number, patient_id, appointment_id, practitioner_id, status, issued_at, called_at, done_at)
select branch_id, :'clinic_day'::date, row_number() over (order by arrived_at), patient_id, id, practitioner_id,
       case status when 'arrived' then 'waiting' when 'in_chair' then 'in_chair' else 'done' end,
       arrived_at, seated_at, completed_at
from aarogyam.appointments
where org_id = :'sunrise' and arrived_at is not null;
select app.reserve_numbers('queue_token', 3, :'sunrise_series', :'clinic_day') as next_token \gset
-- A past visit for Priya Sharma (SD-1) at Sunrise with Dr Dev Rao: a signed note, vitals, an
-- allergy, a flagged condition, a few dental chart entries and a done procedure.
select p.id as priya from aarogyam.patients p where p.number = 'SD-1' \gset
select m.id as dev from aarogyam.memberships m
where m.user_id = '01920000-0000-7000-8000-0000000000a2' and m.org_id = :'sunrise' \gset
select b.id as branch from aarogyam.branches b where b.org_id = :'sunrise' order by b.is_default desc limit 1 \gset
insert into aarogyam.encounters (id, number, patient_id, clinician_id, branch_id, status, chief_complaint, started_at, ended_at)
values ('01920000-0000-7000-8000-00000000e001', 'V-' || app.next_number('visit'), :'priya', :'dev', :'branch',
        'closed', 'Sensitivity to cold, lower left', now() - interval '12 days', now() - interval '12 days' + interval '40 minutes');
update aarogyam.patients set last_visit_at = now() - interval '12 days' where id = :'priya';
insert into aarogyam.clinical_notes (encounter_id, patient_id, author_id, kind, body, status, signed_at, signed_by)
values ('01920000-0000-7000-8000-00000000e001', :'priya', :'dev', 'soap',
        '{"subjective": "Sensitivity to cold on the lower left for two weeks.",
          "objective": "Occlusal caries on 36; old restorations on 46 intact.",
          "assessment": "Reversible pulpitis, 36.",
          "plan": "Composite restoration on 36 at the next visit. Scaling done today."}',
        'signed', now() - interval '12 days' + interval '35 minutes', :'dev');
insert into aarogyam.observations (patient_id, encounter_id, kind, value_num, unit, code_system, code, recorded_at, verified_by, verified_at)
select :'priya', '01920000-0000-7000-8000-00000000e001', v.kind, v.value, v.unit, 'loinc', v.code,
       now() - interval '12 days' + interval '5 minutes', :'dev', now() - interval '12 days'
from (values ('bp_systolic', 118, 'mmHg', '8480-6'), ('bp_diastolic', 76, 'mmHg', '8462-4'),
             ('pulse', 74, '/min', '8867-4'), ('spo2', 99, '%', '59408-5')) as v(kind, value, unit, code);
insert into aarogyam.allergies (patient_id, substance, reaction, severity, source, verified_by, verified_at)
values (:'priya', 'Penicillin', 'Hives and swelling', 'severe', 'patient', :'dev', now() - interval '12 days');
insert into aarogyam.conditions (patient_id, encounter_id, display_text, flagged, source, verified_by, verified_at)
values (:'priya', '01920000-0000-7000-8000-00000000e001', 'Hypothyroidism, on levothyroxine', true, 'patient',
        :'dev', now() - interval '12 days');
insert into aarogyam.specialty_records (patient_id, encounter_id, module, kind, schema_version, data, effective_at, verified_by, verified_at)
select :'priya', '01920000-0000-7000-8000-00000000e001', 'dental', 'tooth', 1, e.data::jsonb,
       now() - interval '12 days', :'dev', now() - interval '12 days'
from (values ('{"tooth": 36, "surface": "O", "finding": "caries"}'),
             ('{"tooth": 46, "surface": "O", "finding": "filled"}'),
             ('{"tooth": 46, "surface": "M", "finding": "filled"}'),
             ('{"tooth": 18, "finding": "missing"}')) as e(data);
insert into aarogyam.procedures (encounter_id, patient_id, clinician_id, name, status, performed_at, price_paise)
values ('01920000-0000-7000-8000-00000000e001', :'priya', :'dev', 'Scaling and polishing', 'done',
        now() - interval '12 days' + interval '30 minutes', 120000);

commit;

-- Synthetic billing for Sunrise (bills, receipts, balances); also usable on its own on a seeded database.
\ir demo-billing.sql
