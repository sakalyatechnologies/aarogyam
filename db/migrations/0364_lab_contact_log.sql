-- Lab follow-up (docs/decisions.md, "Labs"): items change after an order is recorded, and staff
-- log each call, WhatsApp, email or visit to the lab. Both are lab_order_events. The order keeps
-- when the lab was last contacted and by whom (a manual reminder counts), and its JSON gains
-- who that was and how to reach the order's contact, so the portal can offer a dialler or
-- WhatsApp. Event notes are cleared when a patient is erased.
set local lock_timeout = '5s';

alter table aarogyam.lab_orders
  add column last_contacted_at timestamptz,
  add column last_contacted_by uuid;
alter table aarogyam.lab_orders add constraint lab_orders_last_contacted_by
  foreign key (org_id, last_contacted_by) references aarogyam.memberships (org_id, id) not valid;
alter table aarogyam.lab_orders validate constraint lab_orders_last_contacted_by;
create index lab_orders_last_contacted_by on aarogyam.lab_orders (org_id, last_contacted_by)
  where last_contacted_by is not null;

-- Items can now be removed (each removal is audited and recorded as an event), which only
-- ephemeral tables allow.
comment on table aarogyam.lab_order_items is 'sensitivity=health offline=server_only lifecycle=ephemeral';
grant delete on aarogyam.lab_order_items to app_user;

alter table aarogyam.lab_order_events drop constraint lab_order_events_kind_check;
alter table aarogyam.lab_order_events add constraint lab_order_events_kind_check
  check (kind in ('created', 'status_changed', 'stage_changed', 'due_changed', 'reminded',
                  'reminder_skipped', 'overdue', 'contacted', 'item_added', 'item_changed',
                  'item_removed'));
alter table aarogyam.lab_order_events
  -- How the lab was contacted, for `contacted`.
  add column channel text check (channel in ('call', 'whatsapp', 'email', 'visit')),
  add column outcome text check (outcome in ('reached', 'no_answer', 'promised_date', 'other')),
  add column contact_id uuid,
  -- The item's position, for item_added, item_changed and item_removed.
  add column line_no smallint check (line_no between 1 and 50),
  add constraint lab_order_events_channel check ((kind = 'contacted') = (channel is not null));
alter table aarogyam.lab_order_events add constraint lab_order_events_contact
  foreign key (org_id, contact_id) references aarogyam.lab_contacts (org_id, id) not valid;
alter table aarogyam.lab_order_events validate constraint lab_order_events_contact;
create index lab_order_events_contact on aarogyam.lab_order_events (org_id, contact_id)
  where contact_id is not null;

-- The order's JSON, as in 0361, plus who last contacted the lab and the contact's reach.
create or replace function app.lab_order_json(o aarogyam.lab_orders, p_costs boolean)
  returns jsonb
  language sql stable set search_path = ''
  as $$
    select to_jsonb(o) - '{org_id,created_by,updated_at,updated_by,due_soon_reminded_on,due_today_reminded_on,overdue_flagged_on}'::text[]
      || jsonb_build_object(
        'vendor_name', v.name, 'vendor_phone', v.phone_e164,
        'contact_name', c.name, 'contact_phone', c.phone_e164, 'contact_email', c.email,
        'contact_whatsapp', c.whatsapp,
        'patient_number', p.number, 'patient_name', p.full_name,
        'doctor_name', (select u.display_name from aarogyam.memberships m
                        join aarogyam.users u on u.id = m.user_id
                        where m.org_id = o.org_id and m.id = o.doctor_id),
        'last_contacted_by_name', (select u.display_name from aarogyam.memberships m
                                   join aarogyam.users u on u.id = m.user_id
                                   where m.org_id = o.org_id and m.id = o.last_contacted_by),
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', i.id, 'line_no', i.line_no, 'work_type', i.work_type,
                             'teeth', to_jsonb(i.teeth), 'shade', i.shade, 'material', i.material,
                             'qty', i.qty,
                             'unit_cost_paise', case when p_costs then i.unit_cost_paise end)
                           order by i.line_no)
                           from aarogyam.lab_order_items i
                           where i.org_id = o.org_id and i.lab_order_id = o.id), '[]'::jsonb))
    from aarogyam.patients p
    join aarogyam.lab_vendors v on v.org_id = o.org_id and v.id = o.vendor_id
    left join aarogyam.lab_contacts c on c.org_id = o.org_id and c.id = o.contact_id
    where p.org_id = o.org_id and p.id = o.patient_id
  $$;

-- Erasing a patient clears the free-text notes on their orders' history (contact log, status
-- changes); the events themselves stay with the order. Notes stay masked in the change history.
update audit.erasure_steps
  set action = 'update', set_clause = 'note = null', note = 'order history kept; notes cleared'
  where table_name = 'aarogyam.lab_order_events';
