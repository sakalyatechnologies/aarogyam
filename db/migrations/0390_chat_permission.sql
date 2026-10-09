-- chat.use lets a member chat with other staff of the clinic (one to one and in groups, 0391 and
-- 0392). Every standard role has it; a clinic can take it away from a role. It is not in the
-- support-grant read set: Sakalya support never reads staff chat. Its catalogue module is `chat`.
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('chat.use', 'chat', 'Chat with other staff of the clinic');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'chat.use', 'all'
from aarogyam.role_templates t
where t.key in ('owner', 'doctor', 'consultant', 'front_desk', 'assistant', 'finance');

-- Clinics that exist already got their standard roles from the templates; give those the same.
insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null and tp.permission = 'chat.use'
on conflict do nothing;
