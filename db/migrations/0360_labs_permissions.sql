-- Lab work (docs/decisions.md, "Labs"): labs.read (see labs, their contacts and lab orders)
-- and labs.write (keep labs and contacts, record and move lab orders, remind a lab). Both can
-- be narrowed to `own`: the orders a member is the doctor on, created, or treats the visit of
-- (app.clinical_in_reach). Costs also need finance.view; payments need expenses.write and
-- finance.view. Their catalogue module is `labs` (a key's module is its prefix).
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description, scopes) values
  ('labs.read', 'labs', 'See labs, their contacts and lab orders', '{all,own,assigned}'),
  ('labs.write', 'labs', 'Keep labs and contacts, record lab orders and remind labs', '{all,own,assigned}');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, p.permission, 'all'
from aarogyam.role_templates t
cross join (values ('labs.read'), ('labs.write')) as p(permission)
where t.key in ('owner', 'doctor', 'assistant', 'front_desk');

-- Clinics that exist already got their standard roles from the templates; give those the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null
  and tp.permission in ('labs.read', 'labs.write')
on conflict do nothing;
