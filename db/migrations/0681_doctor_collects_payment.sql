-- A doctor may take the payment themselves as well as send the bill to the desk
-- (docs/decisions.md, "Visit roles"). The seeded `doctor` template gets payments.collect, which
-- opens POST /payments against named bills and GET /invoices/{id}/collect-summary and nothing
-- else: no voiding, no bill list changes, no reports, no finance. Scope 'all' like the others.
-- Clinics that exist already got their standard roles from the templates; give those the same.
-- Clinics can change this in the roles editor. Expand only.
set local lock_timeout = '5s';

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'payments.collect', 'all'
from aarogyam.role_templates t
where t.key = 'doctor'
on conflict do nothing;

insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null
  and t.key = 'doctor' and tp.permission = 'payments.collect'
on conflict do nothing;
