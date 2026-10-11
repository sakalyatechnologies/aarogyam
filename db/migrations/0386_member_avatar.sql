-- A staff avatar: one of the app's preset pictures (an id the apps know) or the member's own
-- photo (PNG or JPEG kept in file storage under the clinic's folder, shown through signed
-- links). Per clinic, on the membership. Not patient data. Additive; the clinic switcher
-- (app.my_clinics) now also returns the member's avatar at each clinic.
set local lock_timeout = '5s';

alter table aarogyam.memberships
  add column avatar_preset text check (avatar_preset ~ '^[a-z][a-z0-9_]{0,31}$'),
  add column avatar_file_id uuid,
  add column avatar_mime text check (avatar_mime in ('image/png', 'image/jpeg')),
  add constraint memberships_avatar_one check (
    (avatar_preset is null or avatar_file_id is null) and ((avatar_file_id is null) = (avatar_mime is null)));

drop function app.my_clinics(uuid);
create function app.my_clinics(p_auth_uid uuid)
  returns table (org_id uuid, slug text, name text, org_status text, role_key text, role_name text,
                 membership_status text, portal_host text, avatar_preset text, avatar_file_id uuid)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.name, o.status, r.key, r.name, m.status,
           (select d.hostname from aarogyam.org_domains d
             where d.org_id = o.id and d.kind = 'portal' and d.is_primary and d.verified_at is not null),
           m.avatar_preset, m.avatar_file_id
    from aarogyam.users u
    join aarogyam.memberships m on m.user_id = u.id
    join aarogyam.organizations o on o.id = m.org_id
    join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
    where u.auth_uid = p_auth_uid and m.status in ('invited', 'active')
    order by o.name
  $$;
grant execute on function app.my_clinics(uuid) to aarogyam_api;
