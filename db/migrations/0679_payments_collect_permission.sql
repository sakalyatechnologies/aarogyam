-- payments.collect: take payment against a bill that still has a balance, and read what there
-- is to collect (docs/decisions.md, "Visit notifications"). It lets the assistant, who checks
-- patients in and collects at the desk, record a payment without billing.read or billing.write:
-- no creating, listing, voiding or reading bills, no reports. billing.write and billing.read
-- keep working as before.
--   Granted to: owner, front_desk, assistant. The assistant gets no appointments.write here.
-- Clinics that exist already got their standard roles from the templates; give those the same.
-- Clinics can change this in the roles editor. Expand only.
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('payments.collect', 'payments', 'Take payment against a bill with a balance; no other billing access');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, p.permission, 'all'
from (values
  ('owner', 'payments.collect'),
  ('front_desk', 'payments.collect'),
  ('assistant', 'payments.collect')
) as p(template, permission)
join aarogyam.role_templates t on t.key = p.template;

insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null
  and t.key in ('owner', 'front_desk', 'assistant') and tp.permission = 'payments.collect'
on conflict do nothing;
