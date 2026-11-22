-- The App Store review clinic (slug `review`, db/seed/review-clinic.sql) must look alive on any day
-- a reviewer signs in, and Apple takes 1-3 days. The outbox job calls app.refresh_review_demo
-- every run; it is idempotent per day and adds only what is missing:
--   * at least 10 active synthetic patients (invented names, +91 98000 00xxx numbers);
--   * at least 3 past closed visits with signed notes, a prescription and a paid bill;
--   * when the day has no queue token: 5 tokens (2 waiting, in chair, ready to bill, done);
--   * 3 appointments that day and 2 the next, when fewer exist.
-- Hard guard: it acts only on the organization whose slug is `review`, whose name and legal name
-- are the synthetic 'Aarogyam Demo Dental' and whose default branch has the seed's made-up phone
-- +919000009000. Any other clinic, or a `review` lookalike, is left alone (returns null). Changes
-- are audited as actor kind `system` (the audit triggers read app.actor_kind). Returns counts only.
set local lock_timeout = '5s';

create function app.review_demo_id(p_org uuid, p_key text) returns uuid
  language sql immutable set search_path = ''
  as $$ select overlay(overlay(md5(p_org::text || '/' || p_key) placing '4' from 13) placing '8' from 17)::uuid $$;
revoke execute on function app.review_demo_id(uuid, text) from public;

-- One synthetic visit: encounter, SOAP note, optional prescription, and a bill (paid, or a draft).
create function app.review_demo_visit(p_org uuid, p_branch uuid, p_patient uuid, p_member uuid, p_desk uuid,
                                      p_token uuid, p_key text, p_started timestamptz, p_ended timestamptz,
                                      p_bill text, p_rx boolean)
  returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_enc uuid := app.review_demo_id(p_org, 'enc-' || p_key);
    v_open boolean := p_ended is null;
    v_soap jsonb := jsonb_build_object(
      'subjective', 'Pain while chewing on one side for a few days.',
      'objective', 'Caries on the occlusal surface, no tenderness on percussion.',
      'assessment', 'Dental caries.',
      'plan', 'Composite filling advised; brushing and flossing advice given.');
    v_item aarogyam.price_items%rowtype;
    v_inv uuid := app.review_demo_id(p_org, 'inv-' || p_key);
    v_rx uuid := app.review_demo_id(p_org, 'rx-' || p_key);
    v_fy text;
    v_pay uuid;
    v_key text;
    v_doc text;
    v_reg text;
    v_pat aarogyam.patients%rowtype;
  begin
    insert into aarogyam.encounters (id, number, patient_id, clinician_id, branch_id, queue_token_id, status,
                                     chief_complaint, started_at, ended_at)
    values (v_enc, 'V-' || app.next_number('visit'), p_patient, p_member, p_branch, p_token,
            case when v_open then 'open' else 'closed' end, 'Pain while chewing', p_started, p_ended);
    insert into aarogyam.clinical_notes (encounter_id, patient_id, author_id, kind, body, status, signed_at, signed_by)
    values (v_enc, p_patient, p_member, 'soap', v_soap, case when v_open then 'draft' else 'signed' end,
            p_ended, case when v_open then null else p_member end);
    if v_open then
      return v_enc;
    end if;

    select * into v_item from aarogyam.price_items where org_id = p_org and code = 'CONS' and deleted_at is null;
    if v_item.id is null then
      insert into aarogyam.price_items (code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps)
      values ('CONS', 'Consultation', 'consultation', '9993', 50000, false, 0)
      returning * into v_item;
    end if;
    select * into v_pat from aarogyam.patients where org_id = p_org and id = p_patient;
    insert into aarogyam.invoices (id, patient_id, encounter_id, branch_id, place_of_supply)
    values (v_inv, p_patient, v_enc, p_branch, '27');
    insert into aarogyam.invoice_items (invoice_id, line_no, price_item_id, description, sac_hsn, category, quantity,
                                        unit_price_paise, discount_paise, tax_rate_bps, taxable_paise, cgst_paise,
                                        sgst_paise, igst_paise, total_paise)
    values (v_inv, 1, v_item.id, v_item.name, v_item.sac_hsn, v_item.category, 1, v_item.price_paise, 0, 0,
            v_item.price_paise, 0, 0, 0, v_item.price_paise);
    update aarogyam.invoices set subtotal_paise = v_item.price_paise, taxable_paise = v_item.price_paise,
           total_paise = v_item.price_paise where org_id = p_org and id = v_inv;
    if p_bill = 'paid' then
      v_fy := case when extract(month from p_ended at time zone 'Asia/Kolkata') >= 4
                   then to_char(p_ended at time zone 'Asia/Kolkata', 'YY') || '-' || to_char((p_ended at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
                   else to_char((p_ended at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || '-' || to_char(p_ended at time zone 'Asia/Kolkata', 'YY') end;
      update aarogyam.invoices i set
        status = 'issued',
        number = o.number_prefix || '/' || v_fy || '/' || lpad(app.next_number('invoice', 'main', v_fy)::text, 6, '0'),
        financial_year = v_fy, doc_type = 'bill_of_supply', issued_at = p_ended, issued_by = p_desk,
        supplier = jsonb_build_object('name', o.name, 'legal_name', coalesce(o.legal_name, o.name), 'gstin', o.gstin, 'state_code', '27'),
        recipient = jsonb_build_object('name', v_pat.full_name, 'number', v_pat.number)
      from aarogyam.organizations o
      where o.id = p_org and i.org_id = p_org and i.id = v_inv;
      v_pay := app.review_demo_id(p_org, 'pay-' || p_key);
      v_key := 'review-demo-' || v_pay::text;
      insert into aarogyam.payments (id, number, patient_id, received_at, amount_paise, method, reference, received_by,
                                     idempotency_key, request_hash)
      values (v_pay, 'RC/' || v_fy || '/' || lpad(app.next_number('receipt', 'main', v_fy)::text, 6, '0'),
              p_patient, p_ended + interval '5 minutes', v_item.price_paise, 'cash', null, p_desk, v_key,
              md5(v_key) || md5(v_key || 'x'));
      insert into aarogyam.payment_allocations (payment_id, invoice_id, patient_id, amount_paise)
      values (v_pay, v_inv, p_patient, v_item.price_paise);
    end if;

    if p_rx then
      select pr.display_name, pr.registration_number into v_doc, v_reg
        from aarogyam.practitioners pr where pr.org_id = p_org and pr.membership_id = p_member;
      insert into aarogyam.prescriptions (id, patient_id, encounter_id, diagnosis_text, advice, follow_up_on, language)
      values (v_rx, p_patient, v_enc, 'Dental caries.', 'Avoid chewing on the treated side until the next visit.',
              (p_ended at time zone 'Asia/Kolkata')::date + 10, 'en-IN');
      insert into aarogyam.prescription_items (prescription_id, line_no, drug_id, drug_name, strength, form, dose,
                                               frequency, timing, duration_days)
      select v_rx, 1, d.id, d.generic_name, d.strength, d.form, d.default_dose, d.default_frequency,
             d.default_timing, d.default_duration_days
      from aarogyam.drug_catalog d where d.generic_name = 'Ibuprofen' and d.strength = '400 mg' and d.active limit 1;
      update aarogyam.prescriptions rx set number = 'RX-' || app.next_number('prescription'), status = 'issued',
             issued_at = p_ended, issued_by = p_member,
             verify_token = substr(translate(encode(sha256(convert_to('review-demo-rx-' || v_rx::text, 'UTF8')), 'base64'), '+/', '-_'), 1, 43),
             letterhead = jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'address', b.address, 'phone', b.phone_e164, 'brand', null),
             doctor = jsonb_build_object('name', v_doc, 'registration_number', v_reg),
             recipient = jsonb_build_object('name', v_pat.full_name, 'number', v_pat.number, 'sex', v_pat.sex)
      from aarogyam.organizations o
      join aarogyam.branches b on b.org_id = o.id and b.id = p_branch
      where o.id = p_org and rx.org_id = p_org and rx.id = v_rx;
    end if;
    update aarogyam.patients set last_visit_at = greatest(coalesce(last_visit_at, p_started), p_started)
      where org_id = p_org and id = p_patient;
    return v_enc;
  end
  $$;
revoke execute on function app.review_demo_visit(uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, boolean) from public;

create function app.refresh_review_demo(p_today date)
  returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    tz constant text := 'Asia/Kolkata';
    v_in_today date := (now() at time zone 'Asia/Kolkata')::date;
    v_org uuid;
    v_branch uuid;
    v_series text;
    v_member uuid;
    v_prac uuid;
    v_desk uuid;
    v_room uuid;
    females constant text[] := array['Aarti', 'Anjali', 'Bhavna', 'Deepa', 'Divya', 'Gauri', 'Isha', 'Jyoti', 'Kavya', 'Neha', 'Nisha', 'Swati'];
    males constant text[] := array['Aakash', 'Ajay', 'Amit', 'Chetan', 'Deepak', 'Karan', 'Manoj', 'Nikhil', 'Rajesh', 'Sameer', 'Tushar', 'Varun'];
    surnames constant text[] := array['Agarwal', 'Bhosale', 'Chavan', 'Desai', 'Gaikwad', 'Hegde', 'Jadhav', 'Joshi', 'Kamath', 'Mehta', 'Pawar', 'Shinde'];
    pool uuid[];
    v_n int;
    v_k int := 0;
    v_added int;
    v_pat_added int := 0;
    v_visits_added int := 0;
    v_tokens_added int := 0;
    v_appts_added int := 0;
    v_sex text;
    v_base timestamptz;
    v_first int;
    v_tok uuid;
    v_appt uuid;
    v_at timestamptz;
    i int;
    s record;
  begin
    if p_today is null or abs(p_today - v_in_today) > 3650 then
      return null;
    end if;
    -- The guard: the synthetic review clinic and nothing else.
    select o.id into v_org from aarogyam.organizations o
      where o.slug = 'review' and o.status = 'active' and o.name = 'Aarogyam Demo Dental'
        and o.legal_name = 'Aarogyam Demo Dental'
        and exists (select 1 from aarogyam.branches b where b.org_id = o.id and b.is_default and b.phone_e164 = '+919000009000');
    if v_org is null then
      return null;
    end if;
    select b.id into v_branch from aarogyam.branches b where b.org_id = v_org and b.is_default;
    select pr.id, pr.membership_id into v_prac, v_member from aarogyam.practitioners pr
      where pr.org_id = v_org and pr.deleted_at is null order by pr.created_at, pr.id limit 1;
    if v_prac is null then
      return jsonb_build_object('skipped', 'no practitioner');
    end if;
    select m.id into v_desk from aarogyam.memberships m join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
      where m.org_id = v_org and r.key = 'front_desk' and m.status = 'active' order by m.id limit 1;
    v_desk := coalesce(v_desk, v_member);
    select r.id into v_room from aarogyam.rooms r where r.org_id = v_org order by r.sort_order, r.id limit 1;
    v_series := replace(v_branch::text, '-', '');

    perform set_config('app.tenant_id', v_org::text, true);
    perform set_config('app.actor_kind', 'system', true);

    -- Patients: at least 10 active.
    select count(*) into v_n from aarogyam.patients where org_id = v_org and status = 'active' and deleted_at is null;
    while v_n + v_pat_added < 10 and v_k < 200 loop
      v_k := v_k + 1;
      continue when exists (select 1 from aarogyam.patients where org_id = v_org and id = app.review_demo_id(v_org, 'patient-' || v_k));
      v_sex := case when v_k % 2 = 0 then 'female' else 'male' end;
      insert into aarogyam.patients (id, number, full_name, sex, date_of_birth, phone_e164, preferred_language)
      values (app.review_demo_id(v_org, 'patient-' || v_k), 'AD-' || app.next_number('patient'),
              case when v_sex = 'female' then females[1 + (v_k % 12)] else males[1 + (v_k % 12)] end
                || ' ' || surnames[1 + ((v_k * 5 + 3) % 12)],
              v_sex, date '1990-01-01' + (v_k * 397 % 9000), '+919800000' || lpad(v_k::text, 3, '0'), 'en-IN');
      v_pat_added := v_pat_added + 1;
    end loop;

    -- The day's cast: ten active patients in an order that changes daily.
    select array_agg(x.id) into pool from (
      select p.id from aarogyam.patients p
      where p.org_id = v_org and p.status = 'active' and p.deleted_at is null and p.phone_e164 is not null
      order by hashtext(p.id::text || p_today::text), p.id limit 10) x;
    if coalesce(cardinality(pool), 0) < 10 then
      return jsonb_build_object('skipped', 'too few patients');
    end if;

    -- Past closed, signed, billed visits: at least 3.
    select count(*) into v_n from aarogyam.encounters e
      where e.org_id = v_org and e.status = 'closed' and e.ended_at < (p_today::timestamp at time zone tz)
        and exists (select 1 from aarogyam.clinical_notes c where c.org_id = v_org and c.encounter_id = e.id and c.status = 'signed');
    v_k := 0;
    while v_n + v_visits_added < 3 and v_k < 20 loop
      v_k := v_k + 1;
      continue when exists (select 1 from aarogyam.encounters where org_id = v_org and id = app.review_demo_id(v_org, 'enc-past-' || v_k));
      v_at := (p_today::timestamp at time zone tz) - (v_k * interval '1 day') + interval '11 hours';
      perform app.review_demo_visit(v_org, v_branch, pool[v_k], v_member, v_desk, null, 'past-' || v_k,
                                    v_at, v_at + interval '25 minutes', 'paid', true);
      v_visits_added := v_visits_added + 1;
    end loop;

    -- The queue, only when the day has none (and not before the clinic opens when the day is today).
    v_base := case when p_today = v_in_today
                   then least(greatest(now(), (p_today + time '09:30') at time zone tz), (p_today + time '17:00') at time zone tz)
                   else (p_today + time '12:00') at time zone tz end;
    if not exists (select 1 from aarogyam.queue_tokens where org_id = v_org and day = p_today)
       and (p_today <> v_in_today or now() >= (p_today + time '09:30') at time zone tz) then
      v_first := app.reserve_numbers('queue_token', 5, v_series, p_today::text);
      for s in select * from (values
          (1, 'done',          interval '-100 minutes', 'Walk-in: check-up and cleaning'),
          (2, 'ready_to_bill', interval '-45 minutes',  'Filling, sitting 2'),
          (3, 'in_chair',      interval '-20 minutes',  'Root canal, sitting 1'),
          (4, 'waiting',       interval '-12 minutes',  'Walk-in: sensitivity'),
          (5, 'waiting',       interval '-4 minutes',   'Walk-in: broken front tooth')) as t(n, status, issued_off, reason) loop
        v_tok := app.review_demo_id(v_org, 'token-' || p_today || '-' || s.n);
        insert into aarogyam.queue_tokens (id, branch_id, day, token_number, patient_id, practitioner_id, room_id, status,
                                           issued_at, called_at, done_at, reason)
        values (v_tok, v_branch, p_today, v_first + s.n - 1, pool[s.n], v_prac,
                case when s.status in ('in_chair', 'ready_to_bill', 'done') then v_room end,
                s.status, v_base + s.issued_off,
                case when s.status in ('in_chair', 'ready_to_bill', 'done') then v_base + s.issued_off + interval '8 minutes' end,
                case when s.status = 'done' then v_base + s.issued_off + interval '30 minutes' end, s.reason);
        v_tokens_added := v_tokens_added + 1;
        if s.status = 'done' then
          perform app.review_demo_visit(v_org, v_branch, pool[s.n], v_member, v_desk, v_tok, 'today-' || p_today || '-' || s.n,
                                        v_base + s.issued_off + interval '8 minutes', v_base + s.issued_off + interval '30 minutes', 'paid', false);
        elsif s.status = 'ready_to_bill' then
          perform app.review_demo_visit(v_org, v_branch, pool[s.n], v_member, v_desk, v_tok, 'today-' || p_today || '-' || s.n,
                                        v_base + s.issued_off + interval '8 minutes', v_base + s.issued_off + interval '25 minutes', 'draft', false);
        elsif s.status = 'in_chair' then
          perform app.review_demo_visit(v_org, v_branch, pool[s.n], v_member, v_desk, v_tok, 'today-' || p_today || '-' || s.n,
                                        v_base + s.issued_off + interval '8 minutes', null, 'draft', false);
        end if;
      end loop;
    end if;

    -- Appointments: 3 on the day (later than the queue), 2 the day after.
    for s in select * from (values (0, 3), (1, 2)) as t(plus_days, want) loop
      select count(*) into v_n from aarogyam.appointments a
        where a.org_id = v_org and a.deleted_at is null
          and a.status in ('requested', 'booked', 'confirmed', 'arrived', 'in_chair', 'completed')
          and (a.starts_at at time zone tz)::date = p_today + s.plus_days;
      v_added := 0;
      for i in 1 .. 5 loop
        exit when v_n + v_added >= s.want;
        v_appt := app.review_demo_id(v_org, 'appt-' || (p_today + s.plus_days) || '-' || i);
        continue when exists (select 1 from aarogyam.appointments where org_id = v_org and id = v_appt);
        v_at := case when s.plus_days = 0 then v_base + (i * interval '45 minutes') + interval '30 minutes'
                     else ((p_today + 1) + time '10:00') at time zone tz + (i - 1) * interval '90 minutes' end;
        begin
          insert into aarogyam.appointments (id, patient_id, practitioner_id, branch_id, room_id, starts_at, ends_at, status, kind, reason, source)
          values (v_appt, pool[5 + i], v_prac, v_branch, v_room, v_at, v_at + interval '30 minutes',
                  case when i % 2 = 0 then 'confirmed' else 'booked' end,
                  (array['new', 'follow_up', 'procedure'])[1 + i % 3],
                  (array['Consultation', 'Scaling', 'Crown fitting', 'Check-up', 'Filling'])[i],
                  (array['front_desk', 'phone', 'website'])[1 + i % 3]);
          insert into aarogyam.appointment_events (appointment_id, kind, at) values (v_appt, 'booked', now());
          v_added := v_added + 1;
        exception when exclusion_violation then
          null;  -- that slot is taken: try the next
        end;
      end loop;
      v_appts_added := v_appts_added + v_added;
    end loop;

    return jsonb_build_object('org_id', v_org, 'patients', v_pat_added, 'visits', v_visits_added,
                              'tokens', v_tokens_added, 'appointments', v_appts_added);
  end
  $$;
revoke execute on function app.refresh_review_demo(date) from public;
grant execute on function app.refresh_review_demo(date) to aarogyam_api;
