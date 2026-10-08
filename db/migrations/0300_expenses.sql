-- What the clinic spends: categories (six system ones per clinic: salary, material,
-- electricity, lab, rent, other) and expense entries. An entry is never deleted or edited: a
-- mistake is voided with a reason, like a payment. Stock deliveries are not copied in here;
-- the analytics report counts them as `material` from stock_batches (docs/decisions.md).
--
-- Two permissions: expenses.write (record expenses; owner and finance) and analytics.view
-- (the owner's Analytics page; its money figures also need finance.view). Their catalogue
-- modules are `expenses` and `analytics` (a key's module is its prefix).
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('expenses.write', 'expenses', 'Record clinic expenses'),
  ('analytics.view', 'analytics', 'See the Analytics page: chair use, patients and busy hours');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, p.permission, 'all'
from (values
  ('owner', 'expenses.write'), ('owner', 'analytics.view'),
  ('finance', 'expenses.write')
) as p(template, permission)
join aarogyam.role_templates t on t.key = p.template;

-- Clinics that exist already got their standard roles from the templates; give those the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null
  and tp.permission in ('expenses.write', 'analytics.view')
on conflict do nothing;

create table aarogyam.expense_categories (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Seeded for every clinic; the analytics report relies on them existing.
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, key)
);
comment on table aarogyam.expense_categories is 'sensitivity=internal offline=read_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.expense_categories', 'mutable');

create table aarogyam.expenses (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  category_id uuid not null,
  -- The clinic day the money went out.
  spent_on date not null,
  amount_paise bigint not null check (amount_paise > 0),
  note text check (char_length(btrim(note)) between 1 and 300),
  recorded_by uuid not null,
  status text not null default 'recorded' check (status in ('recorded', 'void')),
  void_reason text check (char_length(btrim(void_reason)) between 3 and 500),
  voided_at timestamptz,
  voided_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, category_id) references aarogyam.expense_categories (org_id, id),
  foreign key (org_id, recorded_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, voided_by) references aarogyam.memberships (org_id, id),
  check ((status = 'void') = (void_reason is not null and voided_at is not null))
);
create index expenses_spent_on on aarogyam.expenses (org_id, spent_on);
create index expenses_category on aarogyam.expenses (org_id, category_id);
create index expenses_recorded_by on aarogyam.expenses (org_id, recorded_by);
create index expenses_voided_by on aarogyam.expenses (org_id, voided_by) where voided_by is not null;
comment on table aarogyam.expenses is 'sensitivity=financial offline=server_only lifecycle=finalizable';
select app.protect_clinic_table('aarogyam.expenses', 'finalizable');
-- A recorded expense only changes by being voided.
create trigger freeze_when_final before update on aarogyam.expenses
  for each row execute function app.freeze_when_final('', 'void', 'void_reason', 'voided_at', 'voided_by');

-- The system categories, for one clinic. Safe to run again.
create function app.seed_expense_categories(p_org uuid) returns void
  language sql volatile security definer set search_path = ''
  as $$
    insert into aarogyam.expense_categories (org_id, key, name, is_system)
    select p_org, c.key, c.name, true
    from (values ('salary', 'Salaries'), ('material', 'Materials'), ('electricity', 'Electricity'),
                 ('lab', 'Lab work'), ('rent', 'Rent'), ('other', 'Other')) as c(key, name)
    on conflict (org_id, key) do nothing
  $$;

-- Every new clinic gets them, whichever path creates it (console, applications, seeds).
create function app.organization_seed_expense_categories() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform app.seed_expense_categories(new.id);
    return null;
  end
  $$;
create trigger seed_expense_categories after insert on aarogyam.organizations
  for each row execute function app.organization_seed_expense_categories();

select app.seed_expense_categories(id) from aarogyam.organizations;
