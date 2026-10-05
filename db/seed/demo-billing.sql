-- Synthetic billing for Sunrise Dental: 15 bills over the last 30 days (paid, part paid, unpaid and
-- one voided and billed again), with GST on the products, and cash, UPI and card receipts, so
-- Billing, the collections charts, pending payments and patient balances look lived in.
-- Adds to an already seeded database (db/seed/local.sql runs it last). Safe to run again: each bill,
-- payment and price item has a fixed id or code and is skipped when it is already there. Every name
-- is synthetic; dates are relative to the moment the data is first added.
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/seed/demo-billing.sql
\set ON_ERROR_STOP 1
begin;

select id as sunrise from aarogyam.organizations where slug = 'sunrise' \gset
select set_config('app.tenant_id', :'sunrise', true) \gset
-- psql variables are not expanded inside the DO block, so hand the ids over as settings.
select set_config('demo.branch', id::text, true) from aarogyam.branches where org_id = :'sunrise' and is_default;
select set_config('demo.desk', m.id::text, true) from aarogyam.memberships m
where m.org_id = :'sunrise' and m.user_id = '01920000-0000-7000-8000-0000000000a3';

-- A little more on the price list: clinical services are exempt, like the rest of it.
insert into aarogyam.price_items (code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps) values
  ('FLUO', 'Fluoride application', 'preventive', '9993', 80000, false, 0),
  ('WHTN', 'Teeth whitening', 'cosmetic', '9993', 600000, false, 0)
on conflict (org_id, code) where code is not null and deleted_at is null do nothing;

do $$
declare
  org uuid := current_setting('app.tenant_id')::uuid;
  v_branch uuid := current_setting('demo.branch')::uuid;
  v_desk uuid := current_setting('demo.desk')::uuid;
  v_prefix text;
  spec record;
  line jsonb;
  pay jsonb;
  inv uuid;
  pat uuid;
  item record;
  n int;
  line_no int;
  at timestamptz;
  fy text;
  serial bigint;
  gross bigint;
  disc bigint;
  taxable bigint;
  tax bigint;
  cgst bigint;
  sum_taxable bigint;
  sum_tax bigint;
  sum_disc bigint;
  sum_sub bigint;
  raw bigint;
  total bigint;
  k int;
  pid uuid;
  amount bigint;
  paid bigint;
  key text;
begin
  select number_prefix into v_prefix from aarogyam.organizations where id = org;
  for spec in
    select * from (values
      -- n, patient, days ago, lines [code, qty, discount paise], payments [days after, method, paise or -1 for the rest], void reason, replaces
      (1,  'SD-1',  29, '[["CONS",1,0],["XRAY",1,0]]',              '[[0,"cash",-1]]',                          null, null),
      (2,  'SD-2',  27, '[["SCAL",1,0],["TPST",1,0]]',              '[[0,"upi",-1]]',                           null, null),
      (3,  'SD-4',  25, '[["RCT",1,0]]',                            '[[0,"card",300000],[6,"upi",200000]]',     null, null),
      (4,  'SD-3',  23, '[["FILL",2,0]]',                           '[[0,"cash",-1]]',                          null, null),
      (5,  'SD-5',  21, '[["CONS",1,0],["SCAL",1,0],["FLUO",1,0]]', '[[0,"upi",-1]]',                           null, null),
      (6,  'SD-6',  19, '[["CRWN",1,50000]]',                       '[[0,"card",500000]]',                      null, null),
      (7,  'SD-7',  17, '[["EXT",1,0],["CONS",1,0]]',               '[[0,"cash",-1]]',                          null, null),
      (8,  'SD-8',  15, '[["RCT",1,0],["XRAY",1,0]]',               '[[0,"upi",400000],[3,"card",-1]]',         null, null),
      (9,  'SD-9',  13, '[["SCAL",1,0],["MWSH",2,0]]',              '[]',                    'Billed to the wrong patient', null),
      (10, 'SD-8',  13, '[["SCAL",1,0],["MWSH",2,0]]',              '[[0,"upi",-1]]',                           null, 9),
      (11, 'SD-10',  9, '[["CONS",1,0],["XRAY",1,0],["FILL",1,0]]', '[[0,"cash",100000]]',                      null, null),
      (12, 'SD-12',  7, '[["CRWN",1,0]]',                           '[]',                                       null, null),
      (13, 'SD-1',   5, '[["FILL",1,0],["TPST",2,0]]',              '[[0,"cash",-1]]',                          null, null),
      (14, 'SD-4',   3, '[["CONS",1,0],["MWSH",1,0]]',              '[]',                                       null, null),
      (15, 'SD-2',   0, '[["CONS",1,0]]',                           '[[0,"cash",-1]]',                          null, null)
    ) as t(n, patient, days_ago, lines, pays, void_reason, replaces)
    order by n
  loop
    n := spec.n;
    inv := ('01920000-0000-7000-8000-00000000f1' || lpad(n::text, 2, '0'))::uuid;
    continue when exists (select 1 from aarogyam.invoices where org_id = org and id = inv);
    select id into pat from aarogyam.patients where org_id = org and number = spec.patient;
    -- Mornings and afternoons, never in the future.
    at := least(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                  - spec.days_ago * interval '1 day' + (9 + n % 8) * interval '1 hour',
                now() - interval '30 minutes');
    fy := case when extract(month from at at time zone 'Asia/Kolkata') >= 4
               then to_char(at at time zone 'Asia/Kolkata', 'YY') || '-' || to_char((at at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
               else to_char((at at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || '-' || to_char(at at time zone 'Asia/Kolkata', 'YY') end;

    insert into aarogyam.invoices (id, patient_id, branch_id, place_of_supply, created_at, updated_at, replaces_invoice_id)
    values (inv, pat, v_branch, '27', at, at,
            case when spec.replaces is null then null
                 else ('01920000-0000-7000-8000-00000000f1' || lpad(spec.replaces::text, 2, '0'))::uuid end);

    line_no := 0;
    sum_taxable := 0; sum_tax := 0; sum_disc := 0; sum_sub := 0;
    for line in select * from jsonb_array_elements(spec.lines::jsonb) loop
      line_no := line_no + 1;
      select * into item from aarogyam.price_items where org_id = org and code = line ->> 0 and deleted_at is null;
      gross := item.price_paise * (line ->> 1)::int;
      disc := (line ->> 2)::bigint;
      taxable := gross - disc;
      tax := round(taxable * item.tax_rate_bps / 10000.0);
      cgst := tax / 2;
      insert into aarogyam.invoice_items
        (invoice_id, line_no, price_item_id, description, sac_hsn, category, quantity, unit_price_paise, discount_paise,
         tax_rate_bps, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at, updated_at)
      values (inv, line_no, item.id, item.name, item.sac_hsn, item.category, (line ->> 1)::int, item.price_paise, disc,
              item.tax_rate_bps, taxable, cgst, tax - cgst, 0, taxable + tax, at, at);
      sum_sub := sum_sub + gross; sum_disc := sum_disc + disc; sum_taxable := sum_taxable + taxable; sum_tax := sum_tax + tax;
    end loop;

    raw := sum_taxable + sum_tax;
    total := round(raw / 100.0) * 100;
    serial := app.next_number('invoice', 'main', fy);
    update aarogyam.invoices set
      status = 'issued',
      number = v_prefix || '/' || fy || '/' || lpad(serial::text, 6, '0'),
      financial_year = fy,
      doc_type = case when sum_tax > 0 then 'tax_invoice' else 'bill_of_supply' end,
      issued_at = at, issued_by = v_desk,
      supplier = (select jsonb_build_object('name', o.name, 'legal_name', coalesce(o.legal_name, o.name), 'gstin', o.gstin,
                                            'state_code', '27')
                  from aarogyam.organizations o where o.id = org),
      recipient = (select jsonb_build_object('name', p.full_name, 'number', p.number) from aarogyam.patients p where p.id = pat),
      subtotal_paise = sum_sub, discount_paise = sum_disc, taxable_paise = sum_taxable,
      cgst_paise = (select coalesce(sum(cgst_paise), 0) from aarogyam.invoice_items where invoice_id = inv),
      sgst_paise = (select coalesce(sum(sgst_paise), 0) from aarogyam.invoice_items where invoice_id = inv),
      igst_paise = 0, tax_paise = sum_tax, round_off_paise = total - raw, total_paise = total
    where org_id = org and id = inv;

    k := 0;
    paid := 0;
    for pay in select * from jsonb_array_elements(spec.pays::jsonb) loop
      k := k + 1;
      amount := case when (pay ->> 2)::bigint < 0 then total - paid else (pay ->> 2)::bigint end;
      paid := paid + amount;
      pid := ('01920000-0000-7000-8000-00000000f' || (1 + k)::text || lpad(n::text, 2, '0'))::uuid;
      key := 'demo-billing-' || pid::text;
      serial := app.next_number('receipt', 'main', fy);
      insert into aarogyam.payments
        (id, number, patient_id, received_at, amount_paise, method, reference, received_by, idempotency_key, request_hash,
         created_at, updated_at)
      values (pid, 'RC/' || fy || '/' || lpad(serial::text, 6, '0'), pat, least(at + (pay ->> 0)::int * interval '1 day', now() - interval '10 minutes'),
              amount, pay ->> 1, case pay ->> 1 when 'upi' then 'UPI-' || lpad(n::text, 4, '0') || k::text when 'card' then 'CARD-' || lpad(n::text, 4, '0') || k::text end,
              v_desk, key, md5(key) || md5(key || 'x'), at, at);
      insert into aarogyam.payment_allocations (payment_id, invoice_id, patient_id, amount_paise)
      values (pid, inv, pat, amount);
    end loop;

    if spec.void_reason is not null then
      update aarogyam.invoices set status = 'void', void_reason = spec.void_reason, voided_at = at + interval '40 minutes', voided_by = v_desk
      where org_id = org and id = inv;
    end if;
  end loop;
end
$$;

commit;
