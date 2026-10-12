-- The assistant can run the front of the visit journey: check a booked patient in, add a walk-in
-- to the queue and register one in a single step (docs/decisions.md, "Visit roles"). Those need
-- appointments.write and patients.write (with intake.write, which the assistant already has);
-- the assistant had neither, so every one of them answered 403.
--   Same scope as front_desk ('all'). Not granted: patients.contact (phones stay masked),
--   billing.read, billing.write, finance.view. Collecting stays payments.collect.
-- Clinics that exist already got their standard roles from the templates; give those the same.
-- Clinics can change this in the roles editor. Expand only.
set local lock_timeout = '5s';

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, p.permission, 'all'
from (values
  ('assistant', 'appointments.write'),
  ('assistant', 'patients.write')
) as p(template, permission)
join aarogyam.role_templates t on t.key = p.template
on conflict do nothing;

insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null
  and t.key = 'assistant' and tp.permission in ('appointments.write', 'patients.write')
on conflict do nothing;
