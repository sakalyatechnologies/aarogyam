-- Lab work (docs/decisions.md, "Labs"): the outside labs a clinic sends work to, the people
-- there, the orders with their items, and each order's history. Dental first; pathology and
-- radiology requisitions, which carry patient identity, are printed or shared later and never
-- go into a reminder. Reminders to a lab name the clinic, the order number, the work, teeth,
-- shade and due date, never the patient (0363).
set local lock_timeout = '5s';

-- FDI tooth numbers: 11-48 permanent, 51-85 primary; at most 32 in one item.
create function app.fdi_teeth_valid(p_teeth smallint[]) returns boolean
  language sql immutable set search_path = ''
  as $$
    select coalesce(array_length(p_teeth, 1), 0) <= 32
       and not exists (select 1 from unnest(p_teeth) t
                       where t is null
                          or not ((t / 10 between 1 and 4 and t % 10 between 1 and 8)
                                  or (t / 10 between 5 and 8 and t % 10 between 1 and 5)))
  $$;
grant execute on function app.fdi_teeth_valid(smallint[]) to app_user;

create table aarogyam.lab_vendors (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'dental_lab' check (kind in ('dental_lab', 'pathology', 'radiology', 'other')),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (char_length(email) between 3 and 320 and email like '%_@_%'),
  address text check (char_length(btrim(address)) between 1 and 500),
  note text check (char_length(btrim(note)) between 1 and 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id)
);
create unique index lab_vendors_name on aarogyam.lab_vendors (org_id, lower(btrim(name)))
  where deleted_at is null;
comment on table aarogyam.lab_vendors is 'sensitivity=internal offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.lab_vendors', 'soft_delete');
insert into audit.audit_config (table_name, mask) values
  ('aarogyam.lab_vendors', '{phone_e164,email,address,note}');

-- The people at a lab: several per lab, each reachable their own way.
create table aarogyam.lab_contacts (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  vendor_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role text check (char_length(btrim(role)) between 1 and 80),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email text check (char_length(email) between 3 and 320 and email like '%_@_%'),
  whatsapp boolean not null default false,
  preferred_channel text not null default 'email' check (preferred_channel in ('email', 'whatsapp', 'phone')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (org_id, id),
  unique (org_id, id, vendor_id),
  foreign key (org_id, vendor_id) references aarogyam.lab_vendors (org_id, id),
  check (not whatsapp or phone_e164 is not null)
);
create index lab_contacts_vendor on aarogyam.lab_contacts (org_id, vendor_id) where deleted_at is null;
comment on table aarogyam.lab_contacts is 'sensitivity=personal offline=server_only lifecycle=soft_delete';
select app.protect_clinic_table('aarogyam.lab_contacts', 'soft_delete');
insert into audit.audit_config (table_name, mask) values
  ('aarogyam.lab_contacts', '{name,phone_e164,email}');

-- Each order on a patient may also name the procedure it is for, of the same patient.
alter table aarogyam.procedures add constraint procedures_id_patient unique (org_id, id, patient_id);

create table aarogyam.lab_orders (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  -- LAB-<n> from number_sequences kind lab_order.
  number text not null check (number ~ '^LAB-[0-9]{1,12}$'),
  vendor_id uuid not null,
  contact_id uuid,
  patient_id uuid not null,
  -- The member responsible (app.clinical_in_reach).
  doctor_id uuid not null,
  procedure_id uuid,
  encounter_id uuid,
  status text not null default 'draft' check (status in
    ('draft', 'sent', 'in_progress', 'received', 'fitted', 'returned_for_rework', 'cancelled')),
  -- Where dental work is between trials: wax try-in, framework trial, bisque.
  stage text check (char_length(btrim(stage)) between 1 and 80),
  instructions text check (char_length(btrim(instructions)) between 1 and 2000),
  sent_at timestamptz,
  due_on date,
  received_at timestamptz,
  rework_of_id uuid,
  -- The reminder job's steps, each the clinic day it ran; cleared when due_on changes.
  due_soon_reminded_on date,
  due_today_reminded_on date,
  overdue_flagged_on date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, number),
  unique (org_id, id, patient_id),
  unique (org_id, id, vendor_id),
  foreign key (org_id, vendor_id) references aarogyam.lab_vendors (org_id, id),
  foreign key (org_id, contact_id, vendor_id) references aarogyam.lab_contacts (org_id, id, vendor_id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, doctor_id) references aarogyam.memberships (org_id, id),
  foreign key (org_id, procedure_id, patient_id) references aarogyam.procedures (org_id, id, patient_id),
  foreign key (org_id, encounter_id, patient_id) references aarogyam.encounters (org_id, id, patient_id),
  -- A rework is of the same patient's order.
  foreign key (org_id, rework_of_id, patient_id) references aarogyam.lab_orders (org_id, id, patient_id),
  check (status = 'draft' or status = 'cancelled' or sent_at is not null),
  check (status not in ('received', 'fitted', 'returned_for_rework') or received_at is not null),
  check (rework_of_id is null or rework_of_id <> id)
);
create index lab_orders_vendor on aarogyam.lab_orders (org_id, vendor_id, created_at desc);
create index lab_orders_contact on aarogyam.lab_orders (org_id, contact_id, vendor_id) where contact_id is not null;
create index lab_orders_patient on aarogyam.lab_orders (org_id, patient_id, created_at desc);
create index lab_orders_doctor on aarogyam.lab_orders (org_id, doctor_id);
create index lab_orders_procedure on aarogyam.lab_orders (org_id, procedure_id, patient_id) where procedure_id is not null;
create index lab_orders_encounter on aarogyam.lab_orders (org_id, encounter_id, patient_id) where encounter_id is not null;
create index lab_orders_rework on aarogyam.lab_orders (org_id, rework_of_id, patient_id) where rework_of_id is not null;
-- The reminder job's queue across clinics: work still at the lab, by due date.
create index lab_orders_open on aarogyam.lab_orders (due_on) where status in ('sent', 'in_progress');
comment on table aarogyam.lab_orders is 'sensitivity=health offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.lab_orders', 'mutable');
insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.lab_orders', '{due_soon_reminded_on,due_today_reminded_on,overdue_flagged_on}', '{instructions}');

-- A new due date is a new schedule: the reminder steps run again for it.
create function app.lab_order_due_changed() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.due_on is distinct from old.due_on then
      new.due_soon_reminded_on := null;
      new.due_today_reminded_on := null;
      new.overdue_flagged_on := null;
    end if;
    return new;
  end
  $$;
create trigger due_changed before update of due_on on aarogyam.lab_orders
  for each row execute function app.lab_order_due_changed();

-- What the lab makes: a crown on 36 in A2 zirconia, a three-unit bridge.
create table aarogyam.lab_order_items (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  lab_order_id uuid not null,
  line_no smallint not null check (line_no between 1 and 50),
  work_type text not null check (char_length(btrim(work_type)) between 1 and 80),
  teeth smallint[] not null default '{}' check (app.fdi_teeth_valid(teeth)),
  shade text check (char_length(btrim(shade)) between 1 and 20),
  material text check (char_length(btrim(material)) between 1 and 80),
  qty integer not null default 1 check (qty between 1 and 100),
  -- What the lab charges for one; seen and set only with finance.view.
  unit_cost_paise bigint check (unit_cost_paise between 0 and 100000000),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, lab_order_id, line_no),
  foreign key (org_id, lab_order_id) references aarogyam.lab_orders (org_id, id)
);
comment on table aarogyam.lab_order_items is 'sensitivity=health offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.lab_order_items', 'mutable');
insert into audit.audit_config (table_name, mask) values
  ('aarogyam.lab_order_items', '{work_type,shade,material}');

-- What happened to an order, in order: created, sent, a new stage or due date, a reminder.
create table aarogyam.lab_order_events (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  lab_order_id uuid not null,
  kind text not null check (kind in ('created', 'status_changed', 'stage_changed', 'due_changed',
                                     'reminded', 'reminder_skipped', 'overdue')),
  from_status text,
  to_status text,
  stage text check (char_length(stage) <= 80),
  due_on date,
  -- due_soon, due_today or manual for a reminder.
  reminder text check (reminder in ('due_soon', 'due_today', 'manual')),
  note text check (char_length(btrim(note)) between 1 and 500),
  -- The member; null when the reminder job did it.
  actor_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, lab_order_id) references aarogyam.lab_orders (org_id, id),
  foreign key (org_id, actor_id) references aarogyam.memberships (org_id, id)
);
create index lab_order_events_order on aarogyam.lab_order_events (org_id, lab_order_id, id);
create index lab_order_events_actor on aarogyam.lab_order_events (org_id, actor_id) where actor_id is not null;
comment on table aarogyam.lab_order_events is 'sensitivity=health offline=server_only lifecycle=append_only';
select app.protect_clinic_table('aarogyam.lab_order_events', 'append_only');
insert into audit.audit_config (table_name, mask) values ('aarogyam.lab_order_events', '{note}');

-- One order as the API shows it, with its lab, patient, doctor and items, for the list, detail
-- and patient queries alike (one statement each). Unit costs only when p_costs (finance.view).
create function app.lab_order_json(o aarogyam.lab_orders, p_costs boolean)
  returns jsonb
  language sql stable set search_path = ''
  as $$
    select to_jsonb(o) - '{org_id,created_by,updated_at,updated_by,due_soon_reminded_on,due_today_reminded_on,overdue_flagged_on}'::text[]
      || jsonb_build_object(
        'vendor_name', (select v.name from aarogyam.lab_vendors v where v.org_id = o.org_id and v.id = o.vendor_id),
        'contact_name', (select c.name from aarogyam.lab_contacts c where c.org_id = o.org_id and c.id = o.contact_id),
        'patient_number', p.number, 'patient_name', p.full_name,
        'doctor_name', (select u.display_name from aarogyam.memberships m
                        join aarogyam.users u on u.id = m.user_id
                        where m.org_id = o.org_id and m.id = o.doctor_id),
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', i.id, 'line_no', i.line_no, 'work_type', i.work_type,
                             'teeth', to_jsonb(i.teeth), 'shade', i.shade, 'material', i.material,
                             'qty', i.qty,
                             'unit_cost_paise', case when p_costs then i.unit_cost_paise end)
                           order by i.line_no)
                           from aarogyam.lab_order_items i
                           where i.org_id = o.org_id and i.lab_order_id = o.id), '[]'::jsonb))
    from aarogyam.patients p
    where p.org_id = o.org_id and p.id = o.patient_id
  $$;
grant execute on function app.lab_order_json(aarogyam.lab_orders, boolean) to app_user;
