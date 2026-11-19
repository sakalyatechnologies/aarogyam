-- Walk-ins for the review clinic (slug `review`), so the calendar's walk-in view has something to
-- show: 15 visits that were never booked over the last 14 days (10:00-19:00 India time), each with a
-- done queue token, a closed visit, a signed note, one procedure and a bill (most paid), plus one
-- walk-in in the chair right now. Synthetic, like db/seed/review-clinic.sql, and in the same style:
-- runs as the schema owner, in one transaction, picks from hashtext() of fixed keys, numbers from
-- number_sequences. Does nothing when the clinic is missing or already has 10 or more walk-in visits:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/seed/review-walk-ins.sql
\set ON_ERROR_STOP 1
begin;

select o.id as org,
       o.id is not null and (select count(*) from aarogyam.encounters e
                             where e.org_id = o.id and e.appointment_id is null) < 10 as run
from (select 1) x left join aarogyam.organizations o on o.slug = 'review' \gset
\if :run

select set_config('app.tenant_id', :'org', true) \gset

create function pg_temp.h(p_key text, p_n int) returns int language sql immutable
  as $$ select ((hashtext(p_key)::bigint % p_n) + p_n)::int % p_n $$;
create function pg_temp.fy(t timestamptz) returns text language sql immutable as $$
  select case when extract(month from t at time zone 'Asia/Kolkata') >= 4
              then to_char(t at time zone 'Asia/Kolkata', 'YY') || '-' || to_char((t at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
              else to_char((t at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || '-' || to_char(t at time zone 'Asia/Kolkata', 'YY') end $$;

-- The next token number for a branch's day, past any token already there (scripts/demo-refresh.sh
-- moves tokens between days without their counters).
create function pg_temp.next_token(p_branch uuid, p_day date) returns int language plpgsql as $$
declare
  v_series text := replace(p_branch::text, '-', '');
  v_max int := coalesce((select max(token_number) from aarogyam.queue_tokens
                         where org_id = app.tenant_id() and branch_id = p_branch and day = p_day), 0);
  v_n int := app.next_number('queue_token', v_series, p_day::text);
begin
  if v_n <= v_max then
    perform app.reserve_numbers('queue_token', v_max - v_n + 1, v_series, p_day::text);
    v_n := v_max + 1;
  end if;
  return v_n;
end
$$;

-- A bill for a visit, issued and paid in full ('paid') or not yet ('due'); as in review-clinic.sql.
create function pg_temp.add_invoice(p_pat uuid, p_enc uuid, p_at timestamptz, p_lines jsonb, p_mode text, p_key text,
                                    p_branch uuid, p_desk uuid)
returns uuid language plpgsql as $$
declare
  org uuid := current_setting('app.tenant_id')::uuid;
  inv uuid := md5('review-wi-inv-' || p_key)::uuid;
  pid uuid := md5('review-wi-pay-' || p_key)::uuid;
  line jsonb;
  item record;
  n int := 0;
  amt bigint;
  sub bigint := 0;
  v_fy text := pg_temp.fy(p_at);
  v_method text := (array['upi', 'upi', 'upi', 'cash', 'cash', 'card'])[1 + pg_temp.h('wi-m' || p_key, 6)];
  v_key text := 'review-seed-' || pid::text;
  paid_at timestamptz := least(p_at + interval '5 minutes', now() - interval '1 minute');
begin
  insert into aarogyam.invoices (id, patient_id, encounter_id, branch_id, place_of_supply)
  values (inv, p_pat, p_enc, p_branch, '27');
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
  update aarogyam.invoices i set
    subtotal_paise = sub, taxable_paise = sub, total_paise = sub,
    status = 'issued',
    number = o.number_prefix || '/' || v_fy || '/' || lpad(app.next_number('invoice', 'main', v_fy)::text, 6, '0'),
    financial_year = v_fy, doc_type = 'bill_of_supply', issued_at = p_at, issued_by = p_desk,
    supplier = jsonb_build_object('name', o.name, 'legal_name', coalesce(o.legal_name, o.name), 'gstin', o.gstin, 'state_code', '27'),
    recipient = (select jsonb_build_object('name', p.full_name, 'number', p.number)
                 from aarogyam.patients p where p.org_id = org and p.id = p_pat)
  from aarogyam.organizations o
  where o.id = org and i.org_id = org and i.id = inv;
  if p_mode = 'paid' then
    insert into aarogyam.payments (id, number, patient_id, received_at, amount_paise, method, reference, received_by,
                                   idempotency_key, request_hash)
    values (pid, 'RC/' || pg_temp.fy(paid_at) || '/' || lpad(app.next_number('receipt', 'main', pg_temp.fy(paid_at))::text, 6, '0'),
            p_pat, paid_at, sub, v_method,
            case v_method when 'upi' then 'UPI' || lpad((abs(hashtext(v_key)) % 1000000000)::text, 9, '0')
                          when 'card' then 'CARD-' || lpad((abs(hashtext(v_key)) % 10000)::text, 4, '0') end,
            p_desk, v_key, md5(v_key) || md5(v_key || 'x'));
    insert into aarogyam.payment_allocations (payment_id, invoice_id, patient_id, amount_paise)
    values (pid, inv, p_pat, sub);
  end if;
  return inv;
end
$$;

do $$
declare
  org uuid := current_setting('app.tenant_id')::uuid;
  tz text := 'Asia/Kolkata';
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_branch uuid;
  v_desk uuid;
  pats uuid[];
  docs uuid[];
  pracs uuid[];
  rooms uuid[];
  k int;
  v_key text;
  v_day date;
  v_doc int;
  v_pat uuid;
  v_vt int;
  v_tooth int;
  st timestamptz;
  en timestamptz;
  v_open boolean;
  v_tok uuid;
  v_enc uuid;
  v_proc uuid;
  v_code text;
  v_soap jsonb;
begin
  select id into v_branch from aarogyam.branches where org_id = org and is_default;
  select array_agg(id order by id) into pats from aarogyam.patients where org_id = org and deleted_at is null;
  select array_agg(m.id order by pr.display_name, pr.id), array_agg(pr.id order by pr.display_name, pr.id) into docs, pracs
    from aarogyam.practitioners pr
    join aarogyam.memberships m on m.org_id = pr.org_id and m.id = pr.membership_id
    where pr.org_id = org and pr.deleted_at is null and m.status = 'active';
  select array_agg(id order by sort_order, id) into rooms from aarogyam.rooms where org_id = org and deleted_at is null;
  select m.id into v_desk from aarogyam.memberships m join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
    where m.org_id = org and m.status = 'active' and r.key = 'front_desk' order by m.id limit 1;
  v_desk := coalesce(v_desk, docs[1]);

  -- 1-15: the last 14 days (yesterday twice); 16: today, in the chair since half an hour ago.
  for k in 1 .. 16 loop
    v_key := k::text;
    v_open := k = 16;
    v_doc := 1 + pg_temp.h('wi-doc' || v_key, array_length(docs, 1));
    v_pat := pats[1 + pg_temp.h('wi-pat' || v_key, array_length(pats, 1))];
    v_vt := 1 + pg_temp.h('wi-vt' || v_key, 6);
    if v_open then
      v_day := v_today;
      st := now() - interval '30 minutes';
      en := null;
    else
      v_day := v_today - (1 + (k - 1) % 14);
      st := (v_day + time '10:00') at time zone tz + pg_temp.h('wi-st' || v_key, 33) * interval '15 minutes';
      en := st + (20 + pg_temp.h('wi-len' || v_key, 26)) * interval '1 minute';
    end if;
    v_tooth := case v_vt when 3 then (1 + pg_temp.h('wi-q' || v_key, 4)) * 10 + 4 + pg_temp.h('wi-t' || v_key, 4)
                         when 4 then (1 + pg_temp.h('wi-q' || v_key, 4)) * 10 + 8 end;
    v_code := (array['CONS', 'SCAL', 'FILL', 'EXT', 'FLUO', 'CONS'])[v_vt];
    v_soap := case v_vt
      when 2 then jsonb_build_object('subjective', 'Walked in: gums bleed while brushing.',
                                     'objective', 'Plaque and calculus, mild gingival inflammation.',
                                     'assessment', 'Chronic generalised gingivitis.',
                                     'plan', 'Scaling and polishing done. Recall in six months.')
      when 3 then jsonb_build_object('subjective', format('Walked in: a filling fell out near %s.', v_tooth),
                                     'objective', format('Lost restoration on %s, no tenderness.', v_tooth),
                                     'assessment', format('Lost restoration, %s.', v_tooth),
                                     'plan', format('Composite filling on %s done.', v_tooth))
      when 4 then jsonb_build_object('subjective', format('Walked in: pain behind the last tooth, %s.', v_tooth),
                                     'objective', format('Partially erupted %s with pericoronitis.', v_tooth),
                                     'assessment', format('Pericoronitis, %s.', v_tooth),
                                     'plan', format('Extraction of %s under local anaesthesia. Instructions given.', v_tooth))
      when 5 then jsonb_build_object('subjective', 'Walked in for a quick check-up.',
                                     'objective', 'No active caries. Good oral hygiene.',
                                     'assessment', 'Healthy dentition.',
                                     'plan', 'Fluoride varnish applied. Review in six months.')
      else jsonb_build_object('subjective', 'Walked in: sensitivity to cold drinks for a few days.',
                              'objective', 'Mild cervical abrasion, no caries.',
                              'assessment', 'Dentine hypersensitivity.',
                              'plan', 'Desensitising toothpaste advised. Review if it persists.')
    end;
    v_tok := md5('review-wi-token-' || v_key)::uuid;
    v_enc := md5('review-wi-enc-' || v_key)::uuid;
    v_proc := md5('review-wi-proc-' || v_key)::uuid;

    insert into aarogyam.queue_tokens (id, branch_id, day, token_number, patient_id, appointment_id, practitioner_id, room_id,
                                       status, issued_at, called_at, done_at, reason)
    values (v_tok, v_branch, v_day, pg_temp.next_token(v_branch, v_day), v_pat, null, pracs[v_doc],
            rooms[1 + (v_doc - 1) % array_length(rooms, 1)], case when v_open then 'in_chair' else 'done' end,
            st - (5 + pg_temp.h('wi-arr' || v_key, 20)) * interval '1 minute', st, en,
            'Walk-in: ' || (array['sensitivity', 'bleeding gums', 'lost filling', 'pain at the back', 'check-up', 'sensitivity'])[v_vt]);

    insert into aarogyam.encounters (id, number, patient_id, clinician_id, branch_id, appointment_id, queue_token_id, status,
                                     chief_complaint, started_at, ended_at)
    values (v_enc, 'V-' || app.next_number('visit'), v_pat, docs[v_doc], v_branch, null, v_tok,
            case when v_open then 'open' else 'closed' end, v_soap ->> 'subjective', st, en);

    insert into aarogyam.clinical_notes (encounter_id, patient_id, author_id, kind, body, status, signed_at, signed_by)
    values (v_enc, v_pat, docs[v_doc], 'soap', v_soap, case when v_open then 'draft' else 'signed' end,
            en, case when v_open then null else docs[v_doc] end);

    insert into aarogyam.procedures (id, encounter_id, patient_id, clinician_id, name, tooth, surfaces, status, performed_at, price_paise)
    select v_proc, v_enc, v_pat, docs[v_doc], pi.name, v_tooth, case when v_vt = 3 then array['O'] else '{}'::text[] end,
           case when v_open then 'planned' else 'done' end, case when v_open then null else st + interval '15 minutes' end,
           pi.price_paise
    from aarogyam.price_items pi where pi.org_id = org and pi.code = v_code and pi.deleted_at is null;

    if not v_open then
      perform pg_temp.add_invoice(v_pat, v_enc, en, jsonb_build_array(jsonb_build_array(v_code, 1, v_proc)),
                                  case when k % 5 = 0 then 'due' else 'paid' end, v_key, v_branch, v_desk);
    end if;
  end loop;
end
$$;

select count(*) filter (where status = 'closed') as walk_ins_closed, count(*) filter (where status = 'open') as walk_ins_open
from aarogyam.encounters where org_id = :'org' and appointment_id is null;
commit;

\else
\echo 'clinic review missing, or it already has walk-in visits: nothing to do'
rollback;
\endif
