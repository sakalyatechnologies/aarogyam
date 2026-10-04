-- Who may see and change the clinic's stock. Reading is for anyone who works the floor;
-- managing (receiving, using, adjusting, the item and supplier lists) is for the owner and
-- the front desk.
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('inventory.read', 'inventory', 'See stock levels, suppliers and expiry dates'),
  ('inventory.manage', 'inventory', 'Receive, use and adjust stock; edit items and suppliers');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, p.permission, 'all'
from (values
  ('owner', 'inventory.read'), ('owner', 'inventory.manage'),
  ('front_desk', 'inventory.read'), ('front_desk', 'inventory.manage'),
  ('doctor', 'inventory.read'),
  ('assistant', 'inventory.read')
) as p(template, permission)
join aarogyam.role_templates t on t.key = p.template;

-- Clinics that exist already got their roles from the templates; give those roles the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and tp.permission in ('inventory.read', 'inventory.manage')
on conflict do nothing;
