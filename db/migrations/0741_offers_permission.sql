-- offers.give: issue a patient's offer and referral code from the visit's Done screen, and undo
-- one's own (docs/plans/visit-story-v2-offers-design.md §2.2, §2.6; docs/decisions.md, "Offers
-- and referral codes"). Each code is bounded by the role's caps in org_settings.billing.offers.
--   Granted to: owner and doctor; existing clinics' standard roles are backfilled as 0679 did.
-- Clinics can change this in the roles editor. Expand only.
set local lock_timeout = '5s';

insert into aarogyam.permissions (key, module, description) values
  ('offers.give', 'offers', 'Give patients offer and referral codes, within the role''s limits');

insert into aarogyam.role_template_permissions (role_template_id, permission, scope)
select t.id, 'offers.give', 'all'
from aarogyam.role_templates t
where t.key in ('owner', 'doctor')
on conflict do nothing;

insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
select r.org_id, r.id, tp.permission, tp.scope
from aarogyam.roles r
join aarogyam.role_templates t on t.key = r.key
join aarogyam.role_template_permissions tp on tp.role_template_id = t.id
where r.is_template and r.deleted_at is null
  and t.key in ('owner', 'doctor') and tp.permission = 'offers.give'
on conflict do nothing;
