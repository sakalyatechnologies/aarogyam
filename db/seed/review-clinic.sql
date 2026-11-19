-- Aarogyam Demo Dental (slug `review`): the synthetic clinic App Store and Google Play reviewers
-- sign in to. Every portal tab has plenty to show: 150 patients (a few families sharing a mobile,
-- allergies, medical history, notes, consents), about 300 appointments over the last 60 days, today
-- and the next 14 days, today's queue (waiting, called, in the chair, ready to bill, done, walk-ins),
-- signed visits with procedures, dental chart findings, tooth statuses and prescriptions, treatment
-- plans, bills and receipts (paid, part paid, due, drafts), 12 months of expenses with three
-- recurring rules, two labs with orders at every stage and payments, stock with low and expiring
-- batches, and follow-ups. Staff notifications are whatever the database triggers make of it.
--
-- 100% synthetic: invented names, phones only in +91 90000 0xxxx, emails @example.com. Team members
-- are users that never sign in (random auth ids). The reviewer's own owner account is NOT made here:
-- run `aarogyam admin review-account --clinic review --email <email>` afterwards.
--
-- Runs as the schema owner, in one transaction; does nothing when the clinic `review` exists.
-- Deterministic: names, picks and amounts come from hashtext() of fixed keys; dates are relative to
-- the moment it runs (today's appointments sit around that moment, so apply it during clinic hours,
-- India time, or run scripts/demo-refresh.sh --clinic-hours after). scripts/demo-refresh.sh later
-- re-centres the dates. The portal host follows the API's hosts.portal_host_template:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v portal_host_template='{slug}.localtest.me' -f db/seed/review-clinic.sql
\set ON_ERROR_STOP 1
\if :{?portal_host_template}
\else
  \set portal_host_template '{slug}.localtest.me'
\endif
begin;

select exists (select 1 from aarogyam.organizations where slug = 'review') as review_exists \gset
\if :review_exists
\echo 'clinic review already exists: nothing to do'
rollback;
\else

-- Helpers for this session only: a stable pseudo-random pick, and the Indian financial year.
create function pg_temp.h(p_key text, p_n int) returns int language sql immutable
  as $$ select ((hashtext(p_key)::bigint % p_n) + p_n)::int % p_n $$;
create function pg_temp.fy(t timestamptz) returns text language sql immutable as $$
  select case when extract(month from t at time zone 'Asia/Kolkata') >= 4
              then to_char(t at time zone 'Asia/Kolkata', 'YY') || '-' || to_char((t at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
              else to_char((t at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || '-' || to_char(t at time zone 'Asia/Kolkata', 'YY') end $$;

-- The clinic, exactly as the console makes one: portal host (queued for the edge like any new
-- clinic), default branch, settings, expense categories and the template roles with their permissions.
select app.create_clinic('review', 'Aarogyam Demo Dental', 'AD', 'dental',
                         replace(:'portal_host_template', '{slug}', 'review'), null) as org \gset
select set_config('app.tenant_id', :'org', true) \gset
update aarogyam.organizations set status = 'active', timezone = 'Asia/Kolkata', legal_name = 'Aarogyam Demo Dental'
  where id = :'org';
update aarogyam.branches set
  address = '{"line1": "12 Demo Lane, Model Colony", "city": "Pune", "state": "Maharashtra", "pincode": "411016"}',
  phone_e164 = '+919000009000', state_code = '27'
  where org_id = :'org' and is_default;
-- No automatic patient messages from this clinic (reminders, receipts, recalls, welcome, visit
-- summaries, follow-ups, thanks): its phone numbers are made up and could belong to someone.
update aarogyam.org_settings set notifications = notifications || '{"reminder_24h": false, "reminder_2h": false,
  "receipts": false, "recall": false, "welcome": false, "visit_summary": false, "follow_up_booking": false, "thanks": false}'
  where org_id = :'org';
select id as branch, replace(id::text, '-', '') as series from aarogyam.branches where org_id = :'org' and is_default \gset
select set_config('review.branch', :'branch', true) \gset
insert into aarogyam.clinic_setup (org_id, practice, steps, completed_at)
values (:'org', 'multi', '{"clinic": "done", "hours": "done", "services": "done", "team": "done", "look": "done"}', now());

-- Open every day, so Today is never empty: Monday to Saturday 09:30-20:00, Sunday mornings.
insert into aarogyam.clinic_hours (branch_id, weekday, starts, ends)
select :'branch', d, '09:30', case when d = 7 then '14:00' else '20:00' end::time
from generate_series(1, 7) d;

insert into aarogyam.rooms (branch_id, name, sort_order)
values (:'branch', 'Chair 1', 1), (:'branch', 'Chair 2', 2), (:'branch', 'Chair 3', 3);

-- The team: three doctors, front desk, an assistant and finance. They never sign in.
insert into aarogyam.users (id, auth_uid, display_name, email)
select md5('review-user-' || t.k)::uuid, md5('review-auth-' || t.k)::uuid, t.name, t.email
from (values (1, 'Dr Kavita Menon', 'kavita.menon@example.com'),
             (2, 'Dr Rohan Iyer', 'rohan.iyer@example.com'),
             (3, 'Dr Sneha Kulkarni', 'sneha.kulkarni@example.com'),
             (4, 'Pooja Nair', 'pooja.nair@example.com'),
             (5, 'Imran Sheikh', 'imran.sheikh@example.com'),
             (6, 'Lata Deshpande', 'lata.deshpande@example.com')) as t(k, name, email)
on conflict (id) do nothing;
insert into aarogyam.memberships (id, org_id, user_id, role_id, status, joined_at)
select md5('review-member-' || t.k)::uuid, :'org', md5('review-user-' || t.k)::uuid, r.id, 'active', now() - interval '400 days'
from (values (1, 'doctor'), (2, 'consultant'), (3, 'doctor'), (4, 'front_desk'), (5, 'assistant'), (6, 'finance')) as t(k, role_key)
join aarogyam.roles r on r.org_id = :'org' and r.key = t.role_key;
insert into aarogyam.membership_branches (membership_id, branch_id)
select md5('review-member-' || k)::uuid, :'branch' from generate_series(1, 6) k;
insert into aarogyam.practitioners (id, membership_id, display_name, registration_number, specialty, qualifications, calendar_color)
values (md5('review-prac-1')::uuid, md5('review-member-1')::uuid, 'Dr Kavita Menon', 'A-90001', 'General dentistry', 'BDS', '#136650'),
       (md5('review-prac-2')::uuid, md5('review-member-2')::uuid, 'Dr Rohan Iyer', 'A-90002', 'Endodontics', 'BDS, MDS (Endodontics)', '#4F46E5'),
       (md5('review-prac-3')::uuid, md5('review-member-3')::uuid, 'Dr Sneha Kulkarni', 'A-90003', 'Orthodontics', 'BDS, MDS (Orthodontics)', '#B45309');
insert into aarogyam.working_hours (practitioner_id, branch_id, weekday, starts, ends)
select md5('review-prac-' || h.p)::uuid, :'branch', d, h.starts::time, h.ends::time
from (values (1, '09:30', '13:30'), (1, '16:30', '20:00'), (2, '10:00', '18:00'), (3, '11:00', '19:00')) as h(p, starts, ends)
cross join generate_series(1, 7) d;
select set_config('review.desk', md5('review-member-4')::uuid::text, true) \gset

-- Price list: clinical services, exempt (bill of supply); the clinic is not GST-registered.
insert into aarogyam.price_items (code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps) values
  ('CONS', 'Consultation', 'consultation', '9993', 50000, false, 0),
  ('XRAY', 'X-ray (IOPA)', 'diagnostics', '9993', 30000, false, 0),
  ('OPG', 'OPG (full mouth X-ray)', 'diagnostics', '9993', 80000, false, 0),
  ('SCAL', 'Scaling and polishing', 'preventive', '9993', 150000, false, 0),
  ('FLUO', 'Fluoride application', 'preventive', '9993', 80000, false, 0),
  ('SEAL', 'Pit and fissure sealant', 'preventive', '9993', 70000, false, 0),
  ('FILL', 'Composite filling', 'restorative', '9993', 200000, false, 0),
  ('GIC', 'GIC filling', 'restorative', '9993', 120000, false, 0),
  ('RCT', 'Root canal treatment', 'endodontics', '9993', 650000, false, 0),
  ('PULP', 'Pulpectomy (child)', 'endodontics', '9993', 300000, false, 0),
  ('EXT', 'Extraction', 'surgery', '9993', 150000, false, 0),
  ('SEXT', 'Surgical extraction (wisdom tooth)', 'surgery', '9993', 450000, false, 0),
  ('CRWN', 'Ceramic crown', 'prosthodontics', '9993', 900000, false, 0),
  ('ZCRN', 'Zirconia crown', 'prosthodontics', '9993', 1400000, false, 0),
  ('DENT', 'Complete denture (per arch)', 'prosthodontics', '9993', 1800000, false, 0),
  ('ORTH', 'Orthodontic adjustment', 'orthodontics', '9993', 150000, false, 0),
  ('BRCS', 'Metal braces (full course)', 'orthodontics', '9993', 4500000, false, 0),
  ('WHTN', 'Teeth whitening', 'cosmetic', '9993', 600000, false, 0),
  ('NGRD', 'Night guard', 'prosthodontics', '9993', 350000, false, 0),
  ('IMPL', 'Dental implant', 'implants', '9993', 3000000, false, 0);

-- Visits made below, for the treatment plans, lab orders and follow-ups at the end.
create temp table _visits (enc uuid, pat uuid, member uuid, started timestamptz, vt int, tooth int, proc uuid) on commit drop;

-- A bill for a visit: a draft with its lines, then (unless p_mode is 'draft') issued and paid in
-- full ('paid'), in two receipts ('split'), in part ('part') or not yet ('due').
create function pg_temp.add_invoice(p_pat uuid, p_enc uuid, p_at timestamptz, p_lines jsonb, p_mode text, p_key text)
returns uuid language plpgsql as $$
declare
  org uuid := current_setting('app.tenant_id')::uuid;
  inv uuid := md5('review-inv-' || p_key)::uuid;
  line jsonb;
  item record;
  n int := 0;
  amt bigint;
  sub bigint := 0;
  v_fy text;
  serial bigint;
  pays bigint[];
  methods text[];
  k int;
  pid uuid;
  paid_at timestamptz;
  v_key text;
begin
  insert into aarogyam.invoices (id, patient_id, encounter_id, branch_id, place_of_supply)
  values (inv, p_pat, p_enc, current_setting('review.branch')::uuid, '27');
  for line in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    select * into item from aarogyam.price_items where org_id = org and code = line ->> 0 and deleted_at is null;
    amt := item.price_paise * (line ->> 1)::int;
    insert into aarogyam.invoice_items
      (invoice_id, line_no, price_item_id, procedure_id, description, sac_hsn, category, quantity, unit_price_paise,
       discount_paise, tax_rate_bps, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
    values (inv, n, item.id, nullif(line ->> 2, '')::uuid, item.name, item.sac_hsn, item.category, (line ->> 1)::int,
            item.price_paise, 0, 0, amt, 0, 0, 0, amt);
    sub := sub + amt;
  end loop;
  update aarogyam.invoices set subtotal_paise = sub, taxable_paise = sub, total_paise = sub
  where org_id = org and id = inv;
  if p_mode = 'draft' then
    return inv;
  end if;

  v_fy := pg_temp.fy(p_at);
  serial := app.next_number('invoice', 'main', v_fy);
  update aarogyam.invoices i set
    status = 'issued',
    number = o.number_prefix || '/' || v_fy || '/' || lpad(serial::text, 6, '0'),
    financial_year = v_fy, doc_type = 'bill_of_supply', issued_at = p_at,
    issued_by = current_setting('review.desk')::uuid,
    supplier = jsonb_build_object('name', o.name, 'legal_name', coalesce(o.legal_name, o.name), 'gstin', o.gstin, 'state_code', '27'),
    recipient = (select jsonb_build_object('name', p.full_name, 'number', p.number)
                 from aarogyam.patients p where p.org_id = org and p.id = p_pat)
  from aarogyam.organizations o
  where o.id = org and i.org_id = org and i.id = inv;

  methods := array[(array['upi', 'upi', 'upi', 'cash', 'cash', 'card'])[1 + pg_temp.h('m' || p_key, 6)]];
  if p_mode = 'paid' then
    pays := array[sub];
  elsif p_mode = 'split' then
    pays := array[(sub / 2 / 10000) * 10000, sub - (sub / 2 / 10000) * 10000];
    methods := array['upi', 'cash'];
  elsif p_mode = 'part' then
    pays := array[greatest(10000, (sub * 4 / 10 / 10000) * 10000)];
  else
    pays := '{}';
  end if;
  for k in 1 .. coalesce(array_length(pays, 1), 0) loop
    continue when pays[k] <= 0;
    pid := md5('review-pay-' || p_key || '-' || k)::uuid;
    v_key := 'review-seed-' || pid::text;
    paid_at := least(p_at + (k * 5) * interval '1 minute' + (k - 1) * interval '3 days', now() - interval '1 minute');
    insert into aarogyam.payments (id, number, patient_id, received_at, amount_paise, method, reference, received_by,
                                   idempotency_key, request_hash)
    values (pid, 'RC/' || pg_temp.fy(paid_at) || '/' || lpad(app.next_number('receipt', 'main', pg_temp.fy(paid_at))::text, 6, '0'),
            p_pat, paid_at, pays[k], methods[k],
            case methods[k] when 'upi' then 'UPI' || lpad((abs(hashtext(v_key)) % 1000000000)::text, 9, '0')
                            when 'card' then 'CARD-' || lpad((abs(hashtext(v_key)) % 10000)::text, 4, '0') end,
            current_setting('review.desk')::uuid, v_key, md5(v_key) || md5(v_key || 'x'));
    insert into aarogyam.payment_allocations (payment_id, invoice_id, patient_id, amount_paise)
    values (pid, inv, p_pat, pays[k]);
  end loop;
  return inv;
end
$$;

-- One visit: the encounter, a SOAP note (signed when the visit is over), the procedure, chart
-- findings, sometimes vitals, a tooth status and a prescription, and the bill.
create function pg_temp.make_visit(p_appt uuid, p_token uuid, p_pat uuid, p_member uuid, p_started timestamptz,
                                   p_ended timestamptz, p_vt int, p_key text, p_bill text)
returns uuid language plpgsql as $$
declare
  org uuid := current_setting('app.tenant_id')::uuid;
  enc uuid := md5('review-enc-' || p_key)::uuid;
  v_proc uuid := md5('review-proc-' || p_key)::uuid;
  v_q int := 1 + pg_temp.h('q' || p_key, 4);
  v_tooth int;
  v_surf text;
  v_code text := (array['CONS', 'SCAL', 'FILL', 'RCT', 'EXT', 'CRWN', 'FLUO', 'ORTH', 'WHTN'])[p_vt];
  v_name text := (array['Consultation and IOPA X-ray', 'Scaling and polishing', 'Composite filling', 'Root canal treatment',
                        'Extraction', 'Ceramic crown', 'Fluoride application', 'Orthodontic adjustment', 'Teeth whitening'])[p_vt];
  v_finding text := (array['caries', null, 'filled', 'root_canal', 'missing', 'crown', null, null, null])[p_vt];
  v_complaint text := (array['Pain while chewing on one side', 'Bleeding gums while brushing', 'Food getting stuck between teeth',
                             'Severe toothache at night', 'Loose, painful back tooth', 'Crown after root canal',
                             'Routine check-up', 'Braces review', 'Wants whiter teeth'])[p_vt];
  v_done timestamptz := p_started + interval '20 minutes';
  v_open boolean := p_ended is null;
  v_doc text;
  v_reg text;
  v_soap jsonb;
  v_lines jsonb;
  v_rx uuid := md5('review-rx-' || p_key)::uuid;
  v_token text;
  pat record;
  x int;
begin
  select * into pat from aarogyam.patients where org_id = org and id = p_pat;
  select pr.display_name, pr.registration_number into v_doc, v_reg
    from aarogyam.practitioners pr where pr.org_id = org and pr.membership_id = p_member;
  v_tooth := case p_vt
    when 1 then v_q * 10 + 4 + pg_temp.h('t' || p_key, 4)
    when 3 then v_q * 10 + 4 + pg_temp.h('t' || p_key, 4)
    when 4 then v_q * 10 + 5 + pg_temp.h('t' || p_key, 3)
    when 5 then v_q * 10 + (array[8, 8, 6, 7])[1 + pg_temp.h('t' || p_key, 4)]
    when 6 then v_q * 10 + 4 + pg_temp.h('t' || p_key, 4)
  end;
  v_surf := case p_vt when 1 then 'O' when 3 then (array['O', 'M', 'D', 'B'])[1 + pg_temp.h('s' || p_key, 4)] end;
  v_soap := case p_vt
    when 1 then jsonb_build_object('subjective', format('Pain while chewing near tooth %s for about a week.', v_tooth),
                                   'objective', format('Occlusal caries on %s, no tenderness on percussion. IOPA: caries close to enamel-dentine junction.', v_tooth),
                                   'assessment', format('Dental caries, %s.', v_tooth),
                                   'plan', format('Composite restoration on %s at the next visit. Brushing advice given.', v_tooth))
    when 2 then jsonb_build_object('subjective', 'Gums bleed while brushing; last cleaning over a year ago.',
                                   'objective', 'Generalised plaque and calculus, mild gingival inflammation.',
                                   'assessment', 'Chronic generalised gingivitis.',
                                   'plan', 'Full mouth scaling and polishing done. Recall in six months.')
    when 3 then jsonb_build_object('subjective', format('Food gets stuck near %s.', v_tooth),
                                   'objective', format('Caries on the %s surface of %s.', v_surf, v_tooth),
                                   'assessment', format('Dental caries, %s.', v_tooth),
                                   'plan', format('Composite filling on %s (%s) done under isolation.', v_tooth, v_surf))
    when 4 then jsonb_build_object('subjective', format('Throbbing pain near %s, worse at night.', v_tooth),
                                   'objective', format('Deep caries on %s, tender on percussion. IOPA: periapical widening.', v_tooth),
                                   'assessment', format('Symptomatic irreversible pulpitis, %s.', v_tooth),
                                   'plan', format('Root canal treatment started on %s. Crown advised after completion.', v_tooth))
    when 5 then jsonb_build_object('subjective', format('Loose, painful tooth %s.', v_tooth),
                                   'objective', format('Grade III mobility on %s.', v_tooth),
                                   'assessment', format('Non-restorable %s.', v_tooth),
                                   'plan', format('Extraction of %s under local anaesthesia. Post-extraction instructions given.', v_tooth))
    when 6 then jsonb_build_object('subjective', format('Root canal treated %s, here for the crown.', v_tooth),
                                   'objective', format('Tooth %s asymptomatic, adequate structure.', v_tooth),
                                   'assessment', format('Endodontically treated %s needing full coverage.', v_tooth),
                                   'plan', format('Tooth preparation and impression for ceramic crown on %s. Temporary crown placed.', v_tooth))
    when 7 then jsonb_build_object('subjective', 'Routine check-up.',
                                   'objective', 'No active caries. Good oral hygiene.',
                                   'assessment', 'Healthy dentition.',
                                   'plan', 'Fluoride varnish applied. Review in six months.')
    when 8 then jsonb_build_object('subjective', 'Monthly braces review; mild discomfort after the last adjustment.',
                                   'objective', 'Brackets intact, oral hygiene fair.',
                                   'assessment', 'Fixed orthodontic treatment in progress.',
                                   'plan', 'Archwire changed. Review in four weeks.')
    else jsonb_build_object('subjective', 'Wants whiter teeth before a family wedding.',
                            'objective', 'Extrinsic stains, shade A3.',
                            'assessment', 'Discoloured teeth.',
                            'plan', 'In-office whitening done; shade A1 achieved. Avoid tea and coffee for 48 hours.')
  end;

  insert into aarogyam.encounters (id, number, patient_id, clinician_id, branch_id, appointment_id, queue_token_id, status,
                                   chief_complaint, started_at, ended_at)
  values (enc, 'V-' || app.next_number('visit'), p_pat, p_member, current_setting('review.branch')::uuid, p_appt, p_token,
          case when v_open then 'open' else 'closed' end, v_complaint, p_started, p_ended);

  insert into aarogyam.clinical_notes (encounter_id, patient_id, author_id, kind, body, status, signed_at, signed_by)
  values (enc, p_pat, p_member, 'soap', v_soap, case when v_open then 'draft' else 'signed' end,
          case when v_open then null else p_ended end, case when v_open then null else p_member end);

  insert into aarogyam.procedures (id, encounter_id, patient_id, clinician_id, name, tooth, surfaces, status, performed_at, price_paise)
  select v_proc, enc, p_pat, p_member, v_name, v_tooth, case when v_surf is null then '{}'::text[] else array[v_surf] end,
         case when v_open then 'planned' else 'done' end, case when v_open then null else v_done end, pi.price_paise
  from aarogyam.price_items pi where pi.org_id = org and pi.code = v_code and pi.deleted_at is null;

  -- Chart: the visit's finding, plus older work found on a first look.
  if v_finding is not null then
    insert into aarogyam.specialty_records (patient_id, encounter_id, module, kind, schema_version, data, effective_at, source, verified_by, verified_at)
    values (p_pat, enc, 'dental', 'tooth', 3,
            jsonb_strip_nulls(jsonb_build_object('tooth', v_tooth, 'surface', v_surf, 'finding', v_finding)),
            p_started, 'clinician', p_member, p_started)
    on conflict do nothing;
  end if;
  if p_vt in (1, 2, 7) then
    for x in 1 .. 1 + pg_temp.h('extra' || p_key, 3) loop
      insert into aarogyam.specialty_records (patient_id, encounter_id, module, kind, schema_version, data, effective_at, source, verified_by, verified_at)
      values (p_pat, enc, 'dental', 'tooth', 3,
              case pg_temp.h('ef' || p_key || x, 4)
                when 0 then jsonb_build_object('tooth', (1 + pg_temp.h('eq' || p_key || x, 4)) * 10 + 6, 'surface', 'O', 'finding', 'filled')
                when 1 then jsonb_build_object('tooth', (1 + pg_temp.h('eq' || p_key || x, 4)) * 10 + 8, 'finding', 'missing')
                when 2 then jsonb_build_object('tooth', (1 + pg_temp.h('eq' || p_key || x, 4)) * 10 + 7, 'surface', 'D', 'finding', 'watch')
                else jsonb_build_object('tooth', (1 + pg_temp.h('eq' || p_key || x, 4)) * 10 + 5, 'surface', 'M', 'finding', 'caries')
              end,
              p_started, 'clinician', p_member, p_started)
      on conflict do nothing;
    end loop;
  end if;
  if p_vt in (1, 4) or (p_vt = 3 and pg_temp.h('ts' || p_key, 3) = 0) then
    insert into aarogyam.specialty_records (patient_id, encounter_id, module, kind, schema_version, data, effective_at, source, verified_by, verified_at)
    values (p_pat, enc, 'dental', 'tooth_status', 1,
            case p_vt
              when 1 then jsonb_build_object('tooth', v_tooth, 'health', 'needs_treatment', 'note', 'Caries close to the pulp; restore soon.', 'treat_within_months', 1)
              when 4 then jsonb_build_object('tooth', v_tooth, 'health', 'needs_treatment', 'note', 'Root canal in progress; crown after completion.', 'treat_within_months', 3)
              else jsonb_build_object('tooth', v_tooth, 'health', 'watch', 'note', 'Filling close to the pulp; check sensitivity.', 'treat_within_months', 6)
            end,
            p_started, 'clinician', p_member, p_started)
    on conflict do nothing;
  end if;

  -- Vitals for about a third of visits.
  if pg_temp.h('vit' || p_key, 3) = 0 then
    insert into aarogyam.observations (patient_id, encounter_id, kind, value_num, unit, code_system, code, recorded_at, source, verified_by, verified_at)
    select p_pat, enc, v.kind, v.val, v.unit, 'loinc', v.code, p_started + interval '3 minutes', 'assistant', p_member, p_started + interval '3 minutes'
    from (values ('bp_systolic', 110 + pg_temp.h('sys' || p_key, 35), 'mmHg', '8480-6'),
                 ('bp_diastolic', 70 + pg_temp.h('dia' || p_key, 20), 'mmHg', '8462-4'),
                 ('pulse', 66 + pg_temp.h('pul' || p_key, 25), '/min', '8867-4')) as v(kind, val, unit, code);
  end if;

  -- Prescriptions after root canals and extractions, and for some consultations.
  if not v_open and (p_vt in (4, 5) or (p_vt = 1 and pg_temp.h('rx' || p_key, 3) = 0)) then
    v_token := substr(translate(encode(sha256(convert_to('review-rx-token-' || p_key, 'UTF8')), 'base64'), '+/', '-_'), 1, 43);
    -- A draft first (its lines can only be added to a draft), then issued.
    insert into aarogyam.prescriptions (id, patient_id, encounter_id, diagnosis_text, advice, follow_up_on, language)
    values (v_rx, p_pat, enc, v_soap ->> 'assessment',
           case p_vt when 5 then 'Bite on the gauze for 30 minutes. Cold food only today; no spitting or rinsing for 24 hours.'
                     else 'Avoid chewing on the treated side until the next visit.' end,
           (p_ended at time zone 'Asia/Kolkata')::date + case p_vt when 5 then 7 else 10 end, 'en-IN');
    insert into aarogyam.prescription_items (prescription_id, line_no, drug_id, drug_name, strength, form, dose, frequency, timing, duration_days)
    select v_rx, row_number() over (order by r.ord), d.id, d.generic_name, d.strength, d.form, d.default_dose, d.default_frequency,
           d.default_timing, d.default_duration_days
    from (values (1, 'Amoxicillin', '500 mg'), (2, case when p_vt = 5 then 'Paracetamol' else 'Ibuprofen' end,
                                                  case when p_vt = 5 then '650 mg' else '400 mg' end),
                 (3, case when p_vt = 4 then 'Pantoprazole' end, '40 mg')) as r(ord, generic, strength)
    join aarogyam.drug_catalog d on d.generic_name = r.generic and d.strength = r.strength and d.active;
    update aarogyam.prescriptions rx set number = 'RX-' || app.next_number('prescription'), status = 'issued', issued_at = p_ended,
           issued_by = p_member, verify_token = v_token,
           letterhead = jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'address', b.address, 'phone', b.phone_e164, 'brand', null),
           doctor = jsonb_build_object('name', v_doc, 'registration_number', v_reg),
           recipient = jsonb_build_object('name', pat.full_name, 'number', pat.number,
                                          'age_years', extract(year from age(pat.date_of_birth))::int, 'sex', pat.sex)
    from aarogyam.organizations o
    join aarogyam.branches b on b.org_id = o.id and b.is_default
    where o.id = org and rx.org_id = org and rx.id = v_rx;
  end if;

  insert into _visits values (enc, p_pat, p_member, p_started, p_vt, v_tooth, v_proc);

  if v_open or p_bill = 'none' then
    return enc;
  end if;
  v_lines := case when p_vt = 1 then jsonb_build_array(jsonb_build_array('CONS', 1, v_proc), jsonb_build_array('XRAY', 1, ''))
                  when pg_temp.h('cons' || p_key, 4) = 0 then jsonb_build_array(jsonb_build_array(v_code, 1, v_proc), jsonb_build_array('CONS', 1, ''))
                  else jsonb_build_array(jsonb_build_array(v_code, 1, v_proc)) end;
  perform pg_temp.add_invoice(p_pat, enc, p_ended, v_lines, p_bill, p_key);
  return enc;
end
$$;

do $$
declare
  org uuid := current_setting('app.tenant_id')::uuid;
  tz text := 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_branch uuid := current_setting('review.branch')::uuid;
  v_series text := replace(current_setting('review.branch'), '-', '');
  v_desk uuid := md5('review-member-4')::uuid;
  v_finance uuid := md5('review-member-6')::uuid;
  females text[] := array['Aarti', 'Anjali', 'Bhavna', 'Deepa', 'Divya', 'Gauri', 'Isha', 'Jyoti', 'Kavya', 'Kiran',
                          'Lakshmi', 'Madhuri', 'Meena', 'Neha', 'Nisha', 'Pallavi', 'Priyanka', 'Radhika', 'Rekha', 'Ritu',
                          'Sakshi', 'Shalini', 'Shreya', 'Sunita', 'Swati', 'Tanvi', 'Uma', 'Vaishali', 'Vidya', 'Yamini'];
  males text[] := array['Aakash', 'Abhishek', 'Ajay', 'Amit', 'Anand', 'Arvind', 'Ashok', 'Chetan', 'Deepak', 'Ganesh',
                        'Harish', 'Jatin', 'Karan', 'Manoj', 'Mahesh', 'Nikhil', 'Omkar', 'Pranav', 'Rajesh', 'Rakesh',
                        'Sachin', 'Sameer', 'Sanjay', 'Suresh', 'Tushar', 'Varun', 'Vijay', 'Vinod', 'Yash', 'Yogesh'];
  surnames text[] := array['Agarwal', 'Bhosale', 'Chavan', 'Das', 'Desai', 'Dubey', 'Gaikwad', 'Ghosh', 'Hegde', 'Jadhav',
                           'Joshi', 'Kamath', 'Khanna', 'Mehta', 'Mishra', 'Naidu', 'Pandey', 'Patel', 'Pawar', 'Rao',
                           'Reddy', 'Saxena', 'Shetty', 'Shinde', 'Sinha', 'Srinivasan', 'Thakur', 'Trivedi', 'Varma', 'Yadav',
                           'Bose', 'Chopra', 'Fernandes', 'Pillai', 'Banerjee'];
  langs text[] := array['en-IN', 'en-IN', 'en-IN', 'hi-IN', 'hi-IN', 'mr-IN', 'mr-IN', 'ta-IN', 'kn-IN', 'gu-IN', 'te-IN', 'bn-IN'];
  bloods text[] := array['O+', 'B+', 'A+', 'AB+', 'O-', 'B-', 'A-'];
  pats uuid[] := '{}';
  ages int[] := '{}';
  pracs uuid[] := array[md5('review-prac-1')::uuid, md5('review-prac-2')::uuid, md5('review-prac-3')::uuid];
  docs uuid[] := array[md5('review-member-1')::uuid, md5('review-member-2')::uuid, md5('review-member-3')::uuid];
  rooms uuid[];
  n int; j int; head int; v_sex text; v_first text; v_last text; v_age int; v_dob date; v_id uuid;
  d int; i int; s int; cnt int; tok int; slot int; v_chair int; v_r int; pn int; vt int; len int;
  v_day date; st timestamptz; v_key text; v_status text; v_kind text; v_appt uuid; v_tokid uuid; v_bill text;
  v_base timestamptz; v_arr timestamptz; v_seat timestamptz; v_comp timestamptz;
  rec record;
  lab1 uuid := md5('review-lab-1')::uuid;
  lab2 uuid := md5('review-lab-2')::uuid;
  v_order uuid; v_ostatus text; v_sent timestamptz; v_recv timestamptz; v_due date; v_vendor uuid; v_contact uuid;
  v_exp uuid; v_rule uuid;
begin
  select array_agg(id order by sort_order) into rooms from aarogyam.rooms where org_id = org;

  -- Patients. Families share the head's mobile and surname: 1-4, 20-22, 40-43, 60-61, 80-82, 100-101, 120-122.
  for n in 1 .. 150 loop
    head := case when n between 1 and 4 then 1 when n between 20 and 22 then 20 when n between 40 and 43 then 40
                 when n between 60 and 61 then 60 when n between 80 and 82 then 80 when n between 100 and 101 then 100
                 when n between 120 and 122 then 120 else n end;
    j := n - head;  -- 0 head, 1 spouse, 2+ children
    v_sex := case when j = 0 then (array['female', 'male'])[1 + pg_temp.h('sex' || n, 2)]
                  when j = 1 then case when pg_temp.h('sex' || head, 2) = 0 then 'male' else 'female' end
                  else (array['female', 'male'])[1 + pg_temp.h('sex' || n, 2)] end;
    v_first := case when v_sex = 'female' then females[1 + pg_temp.h('fn' || n, 30)] else males[1 + pg_temp.h('fn' || n, 30)] end;
    v_last := surnames[1 + pg_temp.h('ln' || head, 35)];
    v_age := case when j >= 2 then 4 + pg_temp.h('age' || n, 13)
                  when j = 1 then 30 + pg_temp.h('age' || head, 20)
                  when head <> n then 32 + pg_temp.h('age' || n, 20)
                  else 6 + pg_temp.h('age' || n, 74) end;
    v_dob := v_today - make_interval(years => v_age) - (pg_temp.h('dob' || n, 360)) * interval '1 day';
    v_id := md5('review-patient-' || n)::uuid;
    insert into aarogyam.patients (id, number, full_name, sex, date_of_birth, birth_date_estimated, phone_e164, email,
                                   preferred_language, blood_group, allergies_reviewed, allergies_reviewed_at, tags)
    values (v_id, 'AD-' || app.next_number('patient'), v_first || ' ' || v_last, v_sex, v_dob, v_age > 70,
            '+9190000' || lpad(head::text, 5, '0'),
            case when pg_temp.h('em' || n, 3) = 0 and j < 2 then lower(v_first) || '.' || lower(v_last) || n || '@example.com' end,
            langs[1 + pg_temp.h('lang' || head, 12)],
            case when pg_temp.h('bg' || n, 5) < 3 then bloods[1 + pg_temp.h('bgv' || n, 7)] end,
            case when n % 7 = 3 then 'has_allergies' when pg_temp.h('ar' || n, 10) < 6 then 'none_known' else 'unknown' end,
            case when n % 7 = 3 or pg_temp.h('ar' || n, 10) < 6 then now() - interval '30 days' end,
            case when n % 11 = 0 then array['vip'] when n % 13 = 0 then array['anxious'] else '{}' end);
    pats := pats || v_id;
    ages := ages || v_age;
  end loop;

  -- Family links, both ways.
  insert into aarogyam.patient_relations (patient_id, related_patient_id, relation, is_primary_contact)
  select md5('review-patient-' || m)::uuid, md5('review-patient-' || h)::uuid,
         case when m - h = 1 then 'spouse' else 'parent' end, true
  from (values (1, 4), (20, 22), (40, 43), (60, 61), (80, 82), (100, 101), (120, 122)) as f(h, last)
  cross join lateral generate_series(f.h + 1, f.last) m;
  insert into aarogyam.patient_relations (patient_id, related_patient_id, relation, is_primary_contact)
  select md5('review-patient-' || h)::uuid, md5('review-patient-' || m)::uuid,
         case when m - h = 1 then 'spouse' else 'child' end, false
  from (values (1, 4), (20, 22), (40, 43), (60, 61), (80, 82), (100, 101), (120, 122)) as f(h, last)
  cross join lateral generate_series(f.h + 1, f.last) m;

  -- Allergies on about 21 patients, medical history on about 37.
  insert into aarogyam.allergies (patient_id, substance, reaction, severity, source, verified_by, verified_at)
  select pats[g], (array['Penicillin', 'Ibuprofen', 'Latex', 'Sulfa drugs', 'Aspirin', 'Lidocaine', 'Chlorhexidine'])[1 + pg_temp.h('al' || g, 7)],
         (array['Hives and itching', 'Swelling of lips', 'Skin rash', 'Breathlessness'])[1 + pg_temp.h('rx' || g, 4)],
         (array['mild', 'moderate', 'severe'])[1 + pg_temp.h('sv' || g, 3)], 'patient', docs[1], now() - interval '30 days'
  from generate_series(1, 150) g where g % 7 = 3;
  insert into aarogyam.conditions (patient_id, display_text, flagged, onset, source, verified_by, verified_at)
  select pats[g], c.text, c.flagged, v_today - (365 * (1 + pg_temp.h('on' || g, 8))), 'patient', docs[1], now() - interval '30 days'
  from generate_series(1, 150) g
  cross join lateral (select (array['Type 2 diabetes, on metformin', 'High blood pressure', 'Asthma, uses an inhaler',
                                    'Hypothyroidism, on levothyroxine', 'On blood thinners (aspirin 75 mg)',
                                    'Heart valve replacement', 'Acid reflux'])[1 + pg_temp.h('cd' || g, 7)] as text) t
  cross join lateral (select t.text, t.text ~ '(diabetes|blood thinners|Heart)' as flagged) c
  where g % 4 = 1 and ages[g] >= 25;

  insert into aarogyam.patient_notes (patient_id, body)
  select pats[g], (array['Prefers evening appointments after 6 pm.', 'Anxious about injections; explain each step first.',
                         'Pays by company insurance claim; needs itemised bills.', 'Hard of hearing: speak slowly and face the patient.',
                         'Usually comes with a family member; call the family mobile.'])[1 + pg_temp.h('note' || g, 5)]
  from generate_series(1, 150) g where g % 9 = 2;

  -- The clinic's privacy notice, version 1; consents below were given on it.
  insert into aarogyam.consent_notices (id, version, label, body, published_at, published_by)
  values (md5('review-notice-1')::uuid, 1, 'v1 2026-10',
          'Aarogyam Demo Dental keeps your health records to treat you, and with your permission sends reminders and offers. '
          || 'You can withdraw any permission at the front desk at any time.', now() - interval '300 days', md5('review-member-1')::uuid);

  -- Consents: care for most, reminders for many, promotional for some; one promotional withdrawn.
  insert into aarogyam.patient_consents (patient_id, purpose, notice_version, notice_id, given_at, method, recorded_by)
  select pats[g], p.purpose, 'v1 2026-10', md5('review-notice-1')::uuid, now() - (70 + pg_temp.h('cg' || g, 200)) * interval '1 day',
         (array['paper', 'app', 'verbal'])[1 + pg_temp.h('cm' || g, 3)], v_desk
  from generate_series(1, 150) g
  cross join (values ('care'), ('reminders'), ('promotional')) as p(purpose)
  where g % 10 <> 0
    and (p.purpose = 'care' or (p.purpose = 'reminders' and g % 3 <> 0) or (p.purpose = 'promotional' and g % 5 = 0));
  update aarogyam.patient_consents set status = 'withdrawn', withdrawn_at = now() - interval '9 days', withdrawn_by = v_desk,
         withdrawn_method = 'verbal', withdrawal_note = 'Does not want offers on WhatsApp.'
  where org_id = org and patient_id = pats[15] and purpose = 'promotional';

  -- The last 60 days: 2-5 appointments a day at fixed clinic hours, one chair each, never overlapping.
  for d in reverse 60 .. 1 loop
    v_day := v_today - d;
    cnt := case when extract(isodow from v_day) = 7 then 2 else 3 + pg_temp.h('cnt' || d, 3) end;
    tok := 0;
    for i in 1 .. cnt loop
      v_key := 'p' || d || '-' || i;
      slot := (i - 1) * 3 + pg_temp.h('slot' || d, 3);
      v_chair := 1 + pg_temp.h('chair' || v_key, 3);
      st := (v_day + time '09:30') at time zone tz + slot * interval '30 minutes';
      len := case when pg_temp.h('len' || v_key, 3) = 0 then 45 else 30 end;
      pn := 1 + pg_temp.h('pat' || v_key, 150);
      v_r := pg_temp.h('vt' || v_key, 20);
      vt := case when ages[pn] < 13 then (array[7, 1, 2])[1 + v_r % 3]
                 when v_r < 5 then 1 when v_r < 9 then 2 when v_r < 12 then 3 when v_r < 14 then 4 when v_r < 15 then 5
                 when v_r < 16 then 6 when v_r < 18 then 8 when v_r < 19 then 9 else 2 end;
      v_r := pg_temp.h('st' || v_key, 100);
      v_status := case when v_r < 7 then 'no_show' when v_r < 14 then 'cancelled' else 'completed' end;
      -- The first visit of each of the last three days left with a balance: the desk's "To collect".
      if d <= 3 and i = 1 then
        v_status := 'completed';
        v_r := 88 + d;
      end if;
      v_kind := case vt when 1 then 'new' when 7 then 'follow_up' when 8 then 'follow_up' else 'procedure' end;
      if vt = 4 and v_r % 3 = 0 then v_kind := 'emergency'; end if;
      v_appt := md5('review-appt-' || v_key)::uuid;
      v_arr := st - (5 + pg_temp.h('arr' || v_key, 15)) * interval '1 minute';
      v_seat := st + pg_temp.h('seat' || v_key, 10) * interval '1 minute';
      v_comp := v_seat + (len - 5) * interval '1 minute';
      insert into aarogyam.appointments (id, patient_id, practitioner_id, branch_id, room_id, starts_at, ends_at, status, kind,
                                         reason, source, cancel_reason, arrived_at, seated_at, completed_at)
      values (v_appt, pats[pn], pracs[v_chair], v_branch, rooms[v_chair], st, st + len * interval '1 minute', v_status, v_kind,
              (array['Consultation', 'Scaling', 'Filling', 'Root canal', 'Extraction', 'Crown', 'Check-up', 'Braces review', 'Whitening'])[vt],
              (array['front_desk', 'front_desk', 'front_desk', 'phone', 'phone', 'website'])[1 + pg_temp.h('src' || v_key, 6)],
              case when v_status = 'cancelled' then (array['Patient called to reschedule', 'Out of town', 'Feeling unwell'])[1 + v_r % 3] end,
              case when v_status = 'completed' then v_arr end, case when v_status = 'completed' then v_seat end,
              case when v_status = 'completed' then v_comp end);
      insert into aarogyam.appointment_events (appointment_id, kind, at)
      values (v_appt, 'booked', st - (1 + pg_temp.h('bk' || v_key, 6)) * interval '1 day');
      insert into aarogyam.appointment_events (appointment_id, kind, from_status, to_status, at)
      values (v_appt, 'status', 'booked', v_status, case v_status when 'completed' then v_comp when 'no_show' then st + interval '30 minutes'
                                                                  else st - interval '1 day' end);
      if v_status = 'completed' then
        tok := tok + 1;
        v_tokid := md5('review-token-' || v_key)::uuid;
        insert into aarogyam.queue_tokens (id, branch_id, day, token_number, patient_id, appointment_id, practitioner_id, room_id,
                                           status, issued_at, called_at, done_at)
        values (v_tokid, v_branch, v_day, tok, pats[pn], v_appt, pracs[v_chair], rooms[v_chair],
                case when d <= 3 and i = 1 then 'ready_to_bill' else 'done' end, v_arr, v_seat,
                case when d <= 3 and i = 1 then null else v_comp end);
        v_bill := case when v_r < 80 then 'paid' when v_r < 86 then 'split' when v_r < 93 then 'part' else 'due' end;
        perform pg_temp.make_visit(v_appt, v_tokid, pats[pn], docs[v_chair], v_seat, v_comp, vt, v_key, v_bill);
      end if;
    end loop;
    if tok > 0 then
      perform app.reserve_numbers('queue_token', tok, v_series, v_day::text);
    end if;
  end loop;

  -- Today, around this moment: 18 half-hour appointments over three chairs, 8 before now, 10 after.
  v_base := date_trunc('hour', now()) + floor(extract(minute from now()) / 5) * interval '5 minutes';
  create temp table _today_tokens (id uuid, appt uuid, pat uuid, prac uuid, room uuid, status text, issued timestamptz,
                                   called timestamptz, done timestamptz, reason text, left_reason text) on commit drop;
  create temp table _today_visits (appt uuid, token uuid, pat uuid, member uuid, started timestamptz, ended timestamptz,
                                   vt int, key text, bill text) on commit drop;
  for s in 0 .. 17 loop
    v_key := 't' || s;
    st := v_base + (s - 8) * interval '30 minutes';
    v_chair := 1 + s % 3;
    pn := 1 + pg_temp.h('tpat' || s, 150);
    v_r := pg_temp.h('tvt' || s, 20);
    vt := case when ages[pn] < 13 then 7 when v_r < 5 then 1 when v_r < 9 then 2 when v_r < 12 then 3 when v_r < 14 then 4
               when v_r < 15 then 5 when v_r < 16 then 6 when v_r < 18 then 8 else 9 end;
    v_status := case when s in (0, 1, 3, 5, 6) then 'completed' when s = 2 then 'no_show' when s = 4 then 'cancelled'
                     when s = 7 then 'in_chair' when s in (8, 9) then 'arrived' when s % 2 = 0 then 'confirmed' else 'booked' end;
    v_appt := md5('review-appt-' || v_key)::uuid;
    v_arr := case when s = 8 then now() - interval '8 minutes' when s = 9 then now() - interval '15 minutes'
                  else st - interval '10 minutes' end;
    v_seat := st;
    v_comp := st + interval '25 minutes';
    insert into aarogyam.appointments (id, patient_id, practitioner_id, branch_id, room_id, starts_at, ends_at, status, kind,
                                       reason, source, cancel_reason, arrived_at, seated_at, completed_at)
    values (v_appt, pats[pn], pracs[v_chair], v_branch, rooms[v_chair], st, st + interval '30 minutes', v_status,
            case vt when 1 then 'new' when 7 then 'follow_up' when 8 then 'follow_up' else 'procedure' end,
            (array['Consultation', 'Scaling', 'Filling', 'Root canal', 'Extraction', 'Crown', 'Check-up', 'Braces review', 'Whitening'])[vt],
            (array['front_desk', 'phone', 'website'])[1 + s % 3],
            case when v_status = 'cancelled' then 'Patient called to reschedule' end,
            case when v_status in ('completed', 'in_chair', 'arrived') then v_arr end,
            case when v_status in ('completed', 'in_chair') then v_seat end,
            case when v_status = 'completed' then v_comp end);
    insert into aarogyam.appointment_events (appointment_id, kind, at)
    values (v_appt, 'booked', st - (1 + s % 5) * interval '1 day');
    if v_status <> 'booked' then
      insert into aarogyam.appointment_events (appointment_id, kind, from_status, to_status, at)
      values (v_appt, 'status', 'booked', v_status, least(now(), coalesce(v_comp, st)));
    end if;
    if v_status in ('completed', 'in_chair', 'arrived') then
      v_tokid := md5('review-token-' || v_key)::uuid;
      insert into _today_tokens values (v_tokid, v_appt, pats[pn], pracs[v_chair], rooms[v_chair],
        case when s in (5, 6) then 'ready_to_bill' when v_status = 'completed' then 'done' when s = 7 then 'in_chair'
             when s = 9 then 'called' else 'waiting' end,
        v_arr, case when s = 9 then now() - interval '1 minute' when s <= 7 then v_seat end,
        case when v_status = 'completed' and s not in (5, 6) then v_comp end, null, null);
      if s <= 7 then
        insert into _today_visits values (v_appt, v_tokid, pats[pn], docs[v_chair], v_seat, case when s < 7 then v_comp end, vt, v_key,
                                          case when s in (5, 6) then 'draft' else 'paid' end);
      end if;
    end if;
  end loop;
  -- Walk-ins: two waiting, one who left.
  insert into _today_tokens values
    (md5('review-token-walkin-1')::uuid, null, pats[33], pracs[1], null, 'waiting', now() - interval '22 minutes', null, null, 'Walk-in: swelling near a lower tooth', null),
    (md5('review-token-walkin-2')::uuid, null, pats[57], null, null, 'waiting', now() - interval '4 minutes', null, null, 'Walk-in: broken front tooth', null),
    (md5('review-token-walkin-3')::uuid, null, pats[88], pracs[2], null, 'left', now() - interval '95 minutes', null, now() - interval '60 minutes', 'Walk-in: sensitivity', 'Could not wait');
  insert into aarogyam.queue_tokens (id, branch_id, day, token_number, patient_id, appointment_id, practitioner_id, room_id, status,
                                     issued_at, called_at, done_at, reason, left_reason)
  select id, v_branch, v_today, row_number() over (order by issued), pat, appt, prac, room, status, issued, called, done, reason, left_reason
  from _today_tokens;
  perform app.reserve_numbers('queue_token', (select count(*)::int from _today_tokens), v_series, v_today::text);
  for rec in select * from _today_visits order by started loop
    perform pg_temp.make_visit(rec.appt, rec.token, rec.pat, rec.member, rec.started, rec.ended, rec.vt, rec.key, rec.bill);
  end loop;

  -- The next 14 days: 2-4 a day; a couple of online requests to confirm.
  for d in 1 .. 14 loop
    v_day := v_today + d;
    cnt := case when extract(isodow from v_day) = 7 then 2 else 4 end;
    for i in 1 .. cnt loop
      v_key := 'f' || d || '-' || i;
      slot := (i - 1) * 3 + pg_temp.h('slot' || v_key, 3);
      v_chair := 1 + pg_temp.h('chair' || v_key, 3);
      st := (v_day + time '09:30') at time zone tz + slot * interval '30 minutes';
      pn := 1 + pg_temp.h('pat' || v_key, 150);
      v_r := pg_temp.h('st' || v_key, 100);
      v_status := case when d in (2, 5) and i = 1 then 'requested' when v_r < 45 then 'confirmed' else 'booked' end;
      v_appt := md5('review-appt-' || v_key)::uuid;
      insert into aarogyam.appointments (id, patient_id, practitioner_id, branch_id, room_id, starts_at, ends_at, status, kind, reason, source)
      values (v_appt, pats[pn], pracs[v_chair], v_branch, rooms[v_chair], st, st + interval '30 minutes', v_status,
              (array['new', 'follow_up', 'procedure', 'procedure'])[1 + v_r % 4],
              (array['Consultation', 'Follow-up', 'Root canal, sitting 2', 'Crown fitting', 'Scaling', 'Braces review'])[1 + v_r % 6],
              case when v_status = 'requested' then 'website' else (array['front_desk', 'phone'])[1 + v_r % 2] end);
      insert into aarogyam.appointment_events (appointment_id, kind, at)
      values (v_appt, 'booked', now() - (1 + v_r % 5) * interval '1 day');
    end loop;
  end loop;

  update aarogyam.patients p set last_visit_at = v.last
  from (select pat, max(started) as last from _visits group by pat) v
  where p.org_id = org and p.id = v.pat;

  -- Treatment plans for 15 patients whose consultation found caries.
  for rec in select distinct on (pat) * from _visits x where x.vt = 1 and tooth is not null order by pat, started limit 15 loop
    i := pg_temp.h('plan' || rec.enc::text, 3);
    v_id := md5('review-plan-' || rec.enc::text)::uuid;
    insert into aarogyam.treatment_plans (id, patient_id, clinician_id, encounter_id, title, status, accepted_at)
    values (v_id, rec.pat, rec.member, rec.enc, 'Restore and protect', (array['proposed', 'accepted', 'in_progress'])[1 + i],
            case when i > 0 then rec.started + interval '30 minutes' end);
    insert into aarogyam.treatment_plan_items (plan_id, patient_id, name, tooth, surfaces, phase, estimate_paise, status)
    values (v_id, rec.pat, 'Composite filling', rec.tooth, '{O}', 1, 200000, case when i = 2 then 'done' when i = 1 then 'accepted' else 'proposed' end),
           (v_id, rec.pat, 'Root canal treatment', rec.tooth, '{}', 2, 650000, case when i > 0 then 'accepted' else 'proposed' end),
           (v_id, rec.pat, 'Ceramic crown', rec.tooth, '{}', 3, 900000, case when i > 0 then 'accepted' else 'proposed' end),
           (v_id, rec.pat, 'Scaling and polishing', null, '{}', 1, 150000, 'proposed');
  end loop;

  -- Follow-ups: six-monthly recalls after scaling (due later), and older patients due, overdue or handled.
  insert into aarogyam.recalls (patient_id, kind, reason, due_on, source_procedure_id)
  select pat, 'recall', 'Six-monthly scaling', (started at time zone tz)::date + 180, proc from _visits x where x.vt = 2;
  insert into aarogyam.recalls (patient_id, kind, reason, due_on, status, done_at, dismissed_at, dismiss_reason)
  select pats[g], (array['recall', 'follow_up', 'review'])[1 + g % 3],
         (array['Six-monthly check-up', 'Review after filling', 'Crown check'])[1 + g % 3],
         v_today + (pg_temp.h('rd' || g, 45) - 25),
         case when g % 17 = 0 then 'done' when g % 19 = 0 then 'dismissed' when g % 3 = 0 then 'notified' else 'due' end,
         case when g % 17 = 0 then now() - interval '2 days' end,
         case when g % 19 = 0 and g % 17 <> 0 then now() - interval '3 days' end,
         case when g % 19 = 0 and g % 17 <> 0 then 'Moved to another city' end
  from generate_series(2, 150, 5) g;

  -- Labs: two vendors with contacts.
  insert into aarogyam.lab_vendors (id, name, kind, phone_e164, email, address, city, work_types, turnaround_days, note)
  values (lab1, 'Navratna Dental Lab', 'dental_lab', '+919000009101', 'orders.navratna@example.com', 'Unit 4, Demo Industrial Estate', 'Pune',
          array['PFM crown', 'Zirconia crown', 'Bridge', 'Denture'], 7, 'Pickup every weekday at 5 pm.'),
         (lab2, 'Crestline Ceramics', 'dental_lab', '+919000009102', 'hello.crestline@example.com', 'Shop 9, Sample Market', 'Pune',
          array['Zirconia crown', 'Night guard', 'Aligners'], 10, null);
  insert into aarogyam.lab_contacts (id, vendor_id, name, role, phone_e164, email, whatsapp, preferred_channel)
  values (md5('review-labc-1')::uuid, lab1, 'Mahesh Gokhale', 'Owner', '+919000009111', 'mahesh.g@example.com', true, 'whatsapp'),
         (md5('review-labc-2')::uuid, lab1, 'Ritu Sawant', 'Front office', '+919000009112', null, false, 'phone'),
         (md5('review-labc-3')::uuid, lab2, 'Arun Pillai', 'Technician', '+919000009113', 'arun.p@example.com', true, 'email');

  -- About 22 lab orders: the newest are drafts and sent, older ones in progress, back, fitted; one rework, one cancelled.
  i := 0;
  for rec in (select * from _visits x where x.vt in (4, 6) order by started desc limit 18)
             union all (select * from _visits x where x.vt in (8, 2) order by started limit 4) loop
    i := i + 1;
    v_order := md5('review-lab-order-' || i)::uuid;
    v_vendor := case when i % 3 = 0 then lab2 else lab1 end;
    v_contact := case when i % 3 = 0 then md5('review-labc-3')::uuid else md5('review-labc-1')::uuid end;
    v_ostatus := case when i <= 2 then 'draft' when i <= 5 then 'sent' when i <= 9 then 'in_progress' when i <= 12 then 'received'
                      when i = 21 then 'returned_for_rework' when i = 22 then 'cancelled' else 'fitted' end;
    v_sent := case when v_ostatus in ('draft', 'cancelled') then null else least(rec.started + interval '1 day', now() - interval '2 hours') end;
    v_recv := case when v_ostatus in ('received', 'fitted', 'returned_for_rework') then least(v_sent + interval '6 days', now() - interval '1 hour') end;
    v_due := case when v_sent is null then (now() at time zone tz)::date + 7
                  when i in (8, 9) then v_today - 2  -- overdue
                  else (v_sent at time zone tz)::date + case when i % 3 = 0 then 10 else 7 end end;
    insert into aarogyam.lab_orders (id, number, vendor_id, contact_id, patient_id, doctor_id, procedure_id, encounter_id, status, stage,
                                     instructions, sent_at, due_on, received_at, last_contacted_at, last_contacted_by)
    values (v_order, 'LAB-' || app.next_number('lab_order'), v_vendor, v_contact, rec.pat, rec.member,
            rec.proc, rec.enc, v_ostatus,
            case v_ostatus when 'in_progress' then (array['Coping trial', 'Bisque trial', 'Final glaze'])[1 + i % 3]
                           when 'received' then 'Final' end,
            case when rec.vt = 8 then 'Upper and lower night guard, 2 mm, clear.' else 'Shade A2, match adjacent teeth. Please send trial first.' end,
            v_sent, v_due, v_recv,
            case when i in (8, 9) then now() - interval '1 day' end, case when i in (8, 9) then v_desk end);
    insert into aarogyam.lab_order_items (lab_order_id, line_no, work_type, teeth, shade, material, qty, unit_cost_paise)
    values (v_order, 1,
            case when rec.vt in (8, 2) then 'Night guard' when i % 3 = 0 then 'Zirconia crown' else 'PFM crown' end,
            case when rec.tooth is null then '{}' else array[rec.tooth]::smallint[] end,
            case when rec.vt in (8, 2) then null else 'A2' end,
            case when rec.vt in (8, 2) then 'Hard acrylic' when i % 3 = 0 then 'Zirconia' else 'PFM' end,
            1, case when rec.vt in (8, 2) then 150000 when i % 3 = 0 then 450000 else 220000 end);
    insert into aarogyam.lab_order_events (lab_order_id, kind, to_status, actor_id)
    values (v_order, 'created', 'draft', v_desk);
    if v_ostatus <> 'draft' then
      insert into aarogyam.lab_order_events (lab_order_id, kind, from_status, to_status, actor_id)
      values (v_order, 'status_changed', 'draft', v_ostatus, v_desk);
    end if;
    if i in (8, 9) then
      insert into aarogyam.lab_order_events (lab_order_id, kind, channel, outcome, contact_id, note, actor_id)
      values (v_order, 'contacted', 'call', 'promised_date', v_contact, 'Lab says it ships tomorrow.', v_desk);
    end if;
  end loop;

  -- Two lab payments, each recorded as a lab expense too.
  for i in 1 .. 2 loop
    v_exp := md5('review-labpay-exp-' || i)::uuid;
    insert into aarogyam.expenses (id, category_id, spent_on, amount_paise, note, recorded_by, method)
    select v_exp, c.id, v_today - (5 + i * 9), case i when 1 then 660000 else 450000 end,
           'Lab payment: ' || case i when 1 then 'Navratna Dental Lab' else 'Crestline Ceramics' end, v_finance, 'bank'
    from aarogyam.expense_categories c where c.org_id = org and c.key = 'lab';
    insert into aarogyam.lab_payments (vendor_id, lab_order_id, paid_on, amount_paise, lab_invoice_ref, note, expense_id, recorded_by, method)
    values (case i when 1 then lab1 else lab2 end, md5('review-lab-order-' || case i when 1 then 13 else 15 end)::uuid,
            v_today - (5 + i * 9), case i when 1 then 660000 else 450000 end, 'INV-DEMO-' || (400 + i),
            'Monthly settlement', v_exp, v_finance, 'bank');
  end loop;

  -- Recurring rules: salaries on the 1st, rent on the 5th, internet on the 12th.
  insert into aarogyam.recurring_expenses (id, category_id, amount_paise, method, note, cadence, day_of_month, starts_on, next_due_on, recorded_by)
  select md5('review-rule-' || r.k)::uuid, c.id, r.amount, 'bank', r.note, 'monthly', r.dom,
         (date_trunc('month', v_today) - interval '11 months')::date + (r.dom - 1),
         case when extract(day from v_today) < r.dom then date_trunc('month', v_today)::date + (r.dom - 1)
              else (date_trunc('month', v_today) + interval '1 month')::date + (r.dom - 1) end,
         v_finance
  from (values ('salary', 'salary', 18500000, 'Demo: staff salaries', 1),
               ('rent', 'rent', 6500000, 'Demo: clinic rent', 5),
               ('internet', 'other', 149900, 'Demo: internet', 12)) as r(k, cat, amount, note, dom)
  join aarogyam.expense_categories c on c.org_id = org and c.key = r.cat;

  -- Twelve months of expenses, the same lines scripts/demo-expenses.sql adds (so it tops them up
  -- later without doubles), plus internet and a monthly material order. Rent, salaries and internet
  -- were recorded by their rules.
  insert into aarogyam.expenses (category_id, spent_on, amount_paise, note, recorded_by, method, recurring_expense_id)
  select c.id, m.first_day + (p.day - 1),
         case when p.rule is not null then p.fixed
              else (p.base_rupees + (abs(hashtext(org::text || m.first_day::text || p.note)) % (p.spread_rupees + 1))) * 100 end,
         p.note, v_finance, p.method, case when p.rule is not null then md5('review-rule-' || p.rule)::uuid end
  from (select (date_trunc('month', v_today) - make_interval(months => k))::date as first_day from generate_series(0, 11) k) m
  cross join (values ('salary', 1, 185000, 6000, 'Demo: staff salaries', 'bank', 'salary', 18500000::bigint),
                     ('rent', 5, 65000, 0, 'Demo: clinic rent', 'bank', 'rent', 6500000),
                     ('electricity', 10, 8000, 5000, 'Demo: electricity bill', 'upi', null, null),
                     ('lab', 8, 7000, 7000, 'Demo: crowns and bridges', 'bank', null, null),
                     ('lab', 21, 5000, 6000, 'Demo: aligners lab', 'bank', null, null),
                     ('material', 14, 3000, 4500, 'Demo: gloves and masks, local shop', 'cash', null, null),
                     ('other', 18, 2000, 4000, 'Demo: housekeeping and repairs', 'cash', null, null),
                     ('other', 12, 1499, 0, 'Demo: internet', 'bank', 'internet', 149900),
                     ('material', 3, 12000, 9000, 'Demo: composite, files and burs order', 'upi', null, null))
       as p(category, day, base_rupees, spread_rupees, note, method, rule, fixed)
  join aarogyam.expense_categories c on c.org_id = org and c.key = p.category
  where m.first_day + (p.day - 1) <= v_today;

  -- Stock: suppliers, 30 items, batches (some low, some expiring, one expired) and movements.
  insert into aarogyam.suppliers (id, name, phone_e164)
  values (md5('review-sup-1')::uuid, 'Deccan Dental Supplies', '+919000009201'),
         (md5('review-sup-2')::uuid, 'Sahyadri Medical Traders', '+919000009202'),
         (md5('review-sup-3')::uuid, 'Konkan Surgicals', '+919000009203');
  insert into aarogyam.inventory_items (id, name, category, unit, reorder_level, max_level, lead_time_days)
  select md5('review-item-' || t.k)::uuid, t.name, t.cat, t.unit, t.reorder, t.reorder * 4, t.lead
  from (values (1, 'Composite A2 syringe', 'restorative', 'piece', 10, 7), (2, 'Composite A3 syringe', 'restorative', 'piece', 8, 7),
               (3, 'GIC restorative kit', 'restorative', 'pack', 3, 10), (4, 'Bonding agent', 'restorative', 'piece', 4, 7),
               (5, 'Etchant gel 37%', 'restorative', 'piece', 5, 7), (6, 'K-files 21 mm assorted', 'endodontic', 'box', 6, 10),
               (7, 'Rotary files X2', 'endodontic', 'pack', 5, 14), (8, 'Gutta-percha points', 'endodontic', 'box', 4, 10),
               (9, 'Sodium hypochlorite 3%', 'endodontic', 'ml', 1000, 5), (10, 'Paper points', 'endodontic', 'box', 4, 10),
               (11, 'Lignocaine 2% cartridges', 'anesthesia', 'piece', 50, 5), (12, 'Topical anaesthetic gel', 'anesthesia', 'piece', 3, 5),
               (13, 'Needles 27G short', 'anesthesia', 'box', 4, 5), (14, 'Nitrile gloves M', 'disposables', 'box', 10, 3),
               (15, 'Nitrile gloves S', 'disposables', 'box', 6, 3), (16, 'Face masks 3-ply', 'disposables', 'box', 8, 3),
               (17, 'Patient bibs', 'disposables', 'pack', 5, 3), (18, 'Saliva ejectors', 'disposables', 'pack', 6, 3),
               (19, 'Cotton rolls', 'disposables', 'pack', 6, 3), (20, 'Alginate impression material', 'impression', 'pack', 3, 7),
               (21, 'Addition silicone putty', 'impression', 'pack', 2, 10), (22, 'Impression trays', 'impression', 'pack', 2, 7),
               (23, 'Orthodontic brackets kit', 'ortho', 'pack', 2, 21), (24, 'NiTi archwires 014', 'ortho', 'pack', 3, 14),
               (25, 'Elastomeric ligatures', 'ortho', 'pack', 3, 14), (26, 'Sutures 3-0 silk', 'surgical', 'box', 2, 7),
               (27, 'Haemostatic gelatin sponge', 'surgical', 'pack', 3, 7), (28, 'Fluoride varnish', 'preventive', 'piece', 4, 7),
               (29, 'Prophy paste', 'preventive', 'piece', 4, 7), (30, 'Sterilisation pouches', 'sterilization', 'box', 5, 5))
       as t(k, name, cat, unit, reorder, lead);
  for n in 1 .. 30 loop
    -- Received about 90 days ago; used since. Items 3, 7, 11, 14, 21 and 26 end up below their reorder level.
    select reorder_level into cnt from aarogyam.inventory_items where org_id = org and id = md5('review-item-' || n)::uuid;
    tok := cnt * (3 + pg_temp.h('rq' || n, 3));                                    -- received
    i := case when n in (3, 7, 11, 14, 21, 26) then tok - greatest(cnt / 2, 1) else tok / 3 end;  -- used
    v_id := md5('review-batch-' || n)::uuid;
    insert into aarogyam.stock_batches (id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity, unit_cost_paise, received_on)
    values (v_id, md5('review-item-' || n)::uuid, md5('review-sup-' || (1 + n % 3))::uuid, 'B' || (2600 + n * 7),
            case when n in (11, 28) then v_today + 20 when n = 12 then v_today + 9 when n in (14, 15, 16, 17, 18, 19, 22, 30) then null
                 else v_today + 300 + pg_temp.h('exp' || n, 400) end,
            tok, tok - i, 500 + pg_temp.h('cost' || n, 40) * 500, v_today - 90);
    insert into aarogyam.stock_movements (item_id, batch_id, kind, quantity, reason)
    values (md5('review-item-' || n)::uuid, v_id, 'receive', tok, null);
    if i > 0 then
      insert into aarogyam.stock_movements (item_id, batch_id, kind, quantity, reason)
      select md5('review-item-' || n)::uuid, v_id, 'use', -q, null
      from unnest(array[i - i / 2, i / 2]) q where q > 0;
    end if;
  end loop;
  -- A second, older batch of lignocaine that expired.
  insert into aarogyam.stock_batches (id, item_id, supplier_id, batch_no, expiry, received_quantity, quantity, unit_cost_paise, received_on)
  values (md5('review-batch-expired')::uuid, md5('review-item-11')::uuid, md5('review-sup-1')::uuid, 'B2550', v_today - 10, 20, 0, 1800, v_today - 400);
  insert into aarogyam.stock_movements (item_id, batch_id, kind, quantity, reason)
  values (md5('review-item-11')::uuid, md5('review-batch-expired')::uuid, 'receive', 20, null),
         (md5('review-item-11')::uuid, md5('review-batch-expired')::uuid, 'use', -14, null),
         (md5('review-item-11')::uuid, md5('review-batch-expired')::uuid, 'expire', -6, 'Expired on the shelf');

  -- Purchase orders: one received, one ordered, one draft.
  for i in 1 .. 3 loop
    v_id := md5('review-po-' || i)::uuid;
    insert into aarogyam.purchase_orders (id, number, supplier_id, status, expected_on, notes, ordered_at, received_at)
    values (v_id, 'PO-' || app.next_number('purchase_order'), md5('review-sup-' || i)::uuid,
            (array['received', 'ordered', 'draft'])[i], v_today + (array[-80, 3, 10])[i],
            (array['Quarterly restock', 'Gloves and masks running low', 'Endo files for next month'])[i],
            case when i < 3 then now() - (array[95, 2, 0])[i] * interval '1 day' end,
            case when i = 1 then now() - interval '90 days' end);
    insert into aarogyam.purchase_order_lines (order_id, line_no, item_id, quantity, unit_cost_paise, received_quantity)
    select v_id, row_number() over (order by k), md5('review-item-' || k)::uuid, 10 + k, 1000 + k * 250,
           case when i = 1 then 10 + k else 0 end
    from unnest((array[array[1, 6, 11], array[14, 15, 16], array[7, 8, 10]])[i:i]) as u(k);
  end loop;

  -- Saved prescription sets for the doctors.
  insert into aarogyam.medicine_sets (label, items) values
    ('After extraction', '[{"drug_name": "Amoxicillin", "strength": "500 mg", "form": "capsule", "dose": "1 capsule", "frequency": "1-1-1", "timing": "after_food", "duration_days": 5},
                           {"drug_name": "Paracetamol", "strength": "650 mg", "form": "tablet", "dose": "1 tablet", "frequency": "1-1-1", "timing": "after_food", "duration_days": 3}]'),
    ('Root canal pain', '[{"drug_name": "Ibuprofen", "strength": "400 mg", "form": "tablet", "dose": "1 tablet", "frequency": "1-1-1", "timing": "after_food", "duration_days": 3},
                          {"drug_name": "Pantoprazole", "strength": "40 mg", "form": "tablet", "dose": "1 tablet", "frequency": "1-0-0", "timing": "before_food", "duration_days": 3}]'),
    ('Gum care', '[{"drug_name": "Chlorhexidine gluconate", "strength": "0.2%", "form": "mouthwash", "dose": "10 ml", "frequency": "1-0-1", "timing": "after_food", "duration_days": 14}]');

  -- Time off: one approved, one waiting for the owner, one declined.
  insert into aarogyam.leave_blocks (id, practitioner_id, starts_at, ends_at, reason)
  values (md5('review-leave-1')::uuid, pracs[2], (v_today + 20)::timestamp at time zone tz, (v_today + 24)::timestamp at time zone tz, 'Vacation'),
         (md5('review-leave-2')::uuid, pracs[3], (v_today + 2 + time '15:00') at time zone tz, (v_today + 2 + time '19:00') at time zone tz, 'Conference');
  insert into aarogyam.time_off_requests (membership_id, kind, starts_at, ends_at, all_day, status, reason, decided_by, decided_at, decision_note, leave_block_id)
  values (md5('review-member-2')::uuid, 'vacation', (v_today + 20)::timestamp at time zone tz, (v_today + 24)::timestamp at time zone tz, true,
          'approved', 'Family trip', md5('review-member-1')::uuid, now() - interval '3 days', 'Enjoy!', md5('review-leave-1')::uuid),
         (md5('review-member-5')::uuid, 'personal', (v_today + 6 + time '14:00') at time zone tz, (v_today + 6 + time '18:00') at time zone tz, false,
          'pending', 'Bank work', null, null, null, null),
         (md5('review-member-4')::uuid, 'sick', (v_today - 12)::timestamp at time zone tz, (v_today - 11)::timestamp at time zone tz, true,
          'declined', 'Fever', md5('review-member-1')::uuid, now() - interval '13 days', 'Please take it as sick leave in the register.', null);

  -- The standard daily tasks every clinic gets, plus one of the clinic's own.
  perform app.seed_default_tasks(org);
  insert into aarogyam.task_templates (title, description, assignee_role_id, schedule_kind, weekdays, due_time, starts_on, action)
  select 'Check the oxygen cylinder', 'Note the pressure in the register every Monday and Thursday.', r.id, 'weekdays', 1 | 8, '10:00',
         v_today - 30, 'none'
  from aarogyam.roles r where r.org_id = org and r.key = 'assistant';
end
$$;

-- What was made.
select 'review seeded: ' || (select count(*) from aarogyam.patients where org_id = :'org') || ' patients, '
       || (select count(*) from aarogyam.appointments where org_id = :'org') || ' appointments, '
       || (select count(*) from aarogyam.encounters where org_id = :'org') || ' visits, '
       || (select count(*) from aarogyam.invoices where org_id = :'org') || ' bills, '
       || (select count(*) from aarogyam.expenses where org_id = :'org') || ' expenses' as summary;

commit;
\endif
