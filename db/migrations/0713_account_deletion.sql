-- Staff delete their own account (Apple guideline 5.1.1(v); docs/decisions.md, 2026-11-15 "Staff
-- account deletion"). One call, app.delete_own_account, does everything the database owns in
-- one transaction: the person leaves every clinic, is signed out everywhere, loses their push
-- tokens and their name, email and phone, and a row in account_deletions asks the outbox job to
-- delete the sign-in identity in Supabase Auth, which can't be part of this transaction.
--
-- Like app.revoke_other_sessions (0615) it runs before any clinic is known, for a person
-- identified only by the Supabase Auth id in their verified token: SECURITY DEFINER, touching
-- only that person's rows, executable only by the API's login. The change history records the
-- person as the actor (app.user_id, actor kind staff), as for any change they make.
--
-- Clinic records stay, and so does who made them. Many clinic reads show a person's name through
-- their membership (the visit's clinician, who recorded a consent, who signed a note), so each
-- membership keeps a snapshot of the name, memberships.display_name, owned by the clinic: it
-- follows the person's own name while they are active and is left alone when they delete their
-- account, and those reads show it in preference to users.display_name. The users row stays,
-- anonymised and disabled, so the change history still points at a row.
set local lock_timeout = '5s';

-- The clinic's copy of a member's name, for attribution on its records. Filled from the user
-- when the membership is made; follows the user's name while they are active; never cleared when
-- they delete their account.
-- Names are personal data: the change history records that the copy changed, not the name. This
-- comes before the backfill below, which would otherwise write every name into the history.
update audit.audit_config set mask = array_append(mask, 'display_name')
  where table_name = 'aarogyam.memberships' and not ('display_name' = any(mask));

alter table aarogyam.memberships
  add column display_name text check (char_length(display_name) between 1 and 200);
update aarogyam.memberships m set display_name = u.display_name
  from aarogyam.users u where u.id = m.user_id;
create function app.membership_name_snapshot() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.display_name is null then
      select u.display_name into new.display_name from aarogyam.users u where u.id = new.user_id;
    end if;
    return new;
  end
  $$;
create trigger name_snapshot before insert on aarogyam.memberships
  for each row execute function app.membership_name_snapshot();
create function app.users_name_to_memberships() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.status = 'active' and new.display_name is distinct from old.display_name then
      update aarogyam.memberships m set display_name = new.display_name where m.user_id = new.id;
    end if;
    return null;
  end
  $$;
create trigger name_to_memberships after update of display_name on aarogyam.users
  for each row execute function app.users_name_to_memberships();
-- The queue of Supabase identities to delete. Platform-level (no org_id): no grants, so only the
-- definer functions below reach it. A row is pending until the job has deleted the identity
-- (done). The job never gives up: after the retries of aarogyam_domain::outbox::retry_at it tries
-- again every hour, so an outage or a bad key delays the deletion and never drops it.
create table aarogyam.account_deletions (
  id uuid primary key default app.uuid_v7(),
  user_id uuid not null unique references aarogyam.users (id),
  auth_uid uuid not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  -- A short reason without secrets, names or addresses, such as "Supabase answered 500".
  last_error text check (char_length(last_error) <= 200),
  -- The person also has a patient-app account on the same sign-in identity, so the identity is
  -- kept (their patient links survive): decided when they delete, not when the job runs.
  keep_identity boolean not null default false,
  -- Why a row finished without deleting the identity, such as kept_for_patient_app.
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'pending') = (next_attempt_at is not null)),
  check ((status = 'pending') = (processed_at is null))
);
create index account_deletions_due on aarogyam.account_deletions (next_attempt_at)
  where status = 'pending';
comment on table aarogyam.account_deletions is 'sensitivity=internal offline=server_only lifecycle=mutable';
alter table aarogyam.account_deletions enable row level security;
create trigger set_row_times before insert or update on aarogyam.account_deletions
  for each row execute function app.set_row_times();
-- The change history keeps who and what outcome, not each attempt or error text.
create trigger audit after insert or update or delete on aarogyam.account_deletions
  for each row execute function app.audit_row();
insert into audit.audit_config (table_name, exclude)
  values ('aarogyam.account_deletions', '{attempts,next_attempt_at,last_error}');

-- A person's name and email are personal data: the change history records that they changed,
-- not the values (the phone is masked since 0615). Rows written before this migration keep the
-- values they hold.
update audit.audit_config
  set mask = mask || array(select c from unnest(array['email', 'display_name']) c where not (c = any(mask)))
  where table_name = 'aarogyam.users';

-- Deletes the person's own account. p_current_session is the caller's own token session: it is
-- recorded and revoked too, because a session that never made a clinic request has no row yet.
-- Returns rows of one outcome:
--   unknown         no staff account for this sign-in (a patient-only identity): nothing changed
--   noop            already deleted: nothing changed
--   platform_staff  active Sakalya staff are managed in the console: nothing changed
--   last_owner      one row per clinic where the person is the only active owner, with its id and
--                   name: nothing changed (make someone else an owner first)
--   deleted         done; one row per session just signed out (provider_session_id), or one row
--                   without a session, so the API can drop what it cached for them
--   avatar          after deleted: a photo the person had at a clinic (org_id, file id in
--                   provider_session_id), for the API to remove from storage
-- The owner memberships involved are locked first, in clinic order, so two owners deleting
-- themselves at once can't both be "not the last".
create function app.delete_own_account(p_auth_uid uuid, p_current_session uuid)
  returns table (outcome text, org_id uuid, org_name text, provider_session_id uuid)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_user_id uuid;
    v_status text;
    v_email text;
    v_solo uuid[];
    v_sessions uuid[];
    v_avatar_orgs uuid[];
    v_avatar_files uuid[];
  begin
    select u.id, u.status, u.email into v_user_id, v_status, v_email
      from aarogyam.users u where u.auth_uid = p_auth_uid
      for update;
    if v_user_id is null then
      return query select 'unknown'::text, null::uuid, null::text, null::uuid;
      return;
    end if;
    if v_status <> 'active' then
      return query select 'noop'::text, null::uuid, null::text, null::uuid;
      return;
    end if;
    if exists (select 1 from aarogyam.platform_users p where p.user_id = v_user_id and p.active) then
      return query select 'platform_staff'::text, null::uuid, null::text, null::uuid;
      return;
    end if;
    perform set_config('app.user_id', v_user_id::text, true);
    perform set_config('app.actor_kind', 'staff', true);

    perform 1
      from aarogyam.memberships m
      join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
      where r.key = 'owner' and m.status = 'active'
        and m.org_id in (
          select m2.org_id from aarogyam.memberships m2
          join aarogyam.roles r2 on r2.org_id = m2.org_id and r2.id = m2.role_id
          where m2.user_id = v_user_id and m2.status = 'active' and r2.key = 'owner')
      order by m.org_id, m.id
      for update of m;
    select coalesce(array_agg(m.org_id), '{}') into v_solo
      from aarogyam.memberships m
      join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
      where m.user_id = v_user_id and m.status = 'active' and r.key = 'owner'
        and not exists (
          select 1 from aarogyam.memberships o
          join aarogyam.roles ro on ro.org_id = o.org_id and ro.id = o.role_id
          where o.org_id = m.org_id and o.user_id <> v_user_id
            and o.status = 'active' and ro.key = 'owner');
    if cardinality(v_solo) > 0 then
      return query
        select 'last_owner'::text, o.id, o.name, null::uuid
          from aarogyam.organizations o where o.id = any (v_solo)
          order by o.name, o.id;
      return;
    end if;

    -- Photos to remove from storage, read before the memberships are cleared.
    select coalesce(array_agg(m.org_id), '{}'), coalesce(array_agg(m.avatar_file_id), '{}')
      into v_avatar_orgs, v_avatar_files
      from aarogyam.memberships m
      where m.user_id = v_user_id and m.avatar_file_id is not null;

    -- They leave every clinic. The clinic keeps memberships.display_name (the snapshot) and its
    -- practitioner row for the doctor, which stops being offered for new bookings; their
    -- future appointments stay for the clinic to reassign.
    update aarogyam.memberships m
      set status = 'left', pin_hash = null,
          avatar_preset = null, avatar_file_id = null, avatar_mime = null
      where m.user_id = v_user_id
        and (m.status in ('invited', 'active', 'suspended')
             or m.pin_hash is not null or m.avatar_preset is not null or m.avatar_file_id is not null);
    update aarogyam.practitioners pr set active = false
      from aarogyam.memberships m
      where m.user_id = v_user_id and pr.org_id = m.org_id and pr.membership_id = m.id
        and pr.active;
    -- An invitation sent to their address can't be accepted later.
    update aarogyam.invitations i set expires_at = now()
      where v_email is not null and i.email = lower(v_email)
        and i.accepted_at is null and i.expires_at > now();

    if p_current_session is not null then
      insert into aarogyam.sessions (user_id, provider_session_id, audience, expires_at)
        values (v_user_id, p_current_session, 'clinic', now() + interval '1 day')
        on conflict (provider_session_id) do nothing;
    end if;
    with revoked as (
      update aarogyam.sessions s
        set revoked_at = now(), revoke_reason = 'account_deleted'
        where s.user_id = v_user_id and s.revoked_at is null
        returning s.provider_session_id
    )
    select coalesce(array_agg(r.provider_session_id), '{}') into v_sessions from revoked r;
    update aarogyam.sessions s set device_id = null
      where s.user_id = v_user_id and s.device_id is not null;
    delete from aarogyam.devices d where d.user_id = v_user_id;

    update aarogyam.users u
      set display_name = 'Deleted user', email = null, phone_e164 = null, status = 'disabled'
      where u.id = v_user_id;
    insert into aarogyam.account_deletions (user_id, auth_uid, next_attempt_at, keep_identity)
      values (v_user_id, p_auth_uid, now(),
              exists (select 1 from aarogyam.patient_accounts a where a.auth_uid = p_auth_uid));

    return query
      select 'deleted'::text, null::uuid, null::text, s.id
        from unnest(case when cardinality(v_sessions) = 0 then array[null::uuid] else v_sessions end)
          as s(id);
    return query
      select 'avatar'::text, a.org_id, null::text, a.file_id
        from unnest(v_avatar_orgs, v_avatar_files) as a(org_id, file_id);
  end
  $$;

-- A deleted person's sign-in identity must not get a patient-app account made from it later (a
-- stray patient request with a still-valid token would otherwise create one, and the identity
-- would be kept). An account made before the deletion is kept: keep_identity.
create function app.refuse_deleted_patient_account() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if exists (select 1 from aarogyam.account_deletions d where d.auth_uid = new.auth_uid) then
      return null;
    end if;
    return new;
  end
  $$;
create trigger refuse_deleted before insert on aarogyam.patient_accounts
  for each row execute function app.refuse_deleted_patient_account();

-- Claims up to p_limit due identities for p_lease_seconds, like app.edge_hosts_claim (0160): a
-- job that dies mid-call leaves the row to be retried after the lease.
create function app.account_deletions_claim(p_limit int, p_lease_seconds int)
  returns table (id uuid, auth_uid uuid, attempts int, keep_identity boolean)
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select d.id
      from aarogyam.account_deletions d
      where d.status = 'pending' and d.next_attempt_at <= now()
      order by d.next_attempt_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
    )
    update aarogyam.account_deletions d
      set attempts = d.attempts + 1,
          next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 1))
      from due
      where d.id = due.id
      returning d.id, d.auth_uid, d.attempts, d.keep_identity
  $$;

-- Records that the row is finished: the identity is gone, or (with p_note) was kept on purpose.
create function app.account_deletion_done(p_id uuid, p_note text)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.account_deletions
      set status = 'done', processed_at = now(), next_attempt_at = null, last_error = null,
          note = left(p_note, 200)
      where id = p_id and status = 'pending'
  $$;

-- Records a failed attempt: retried at p_retry_at (never null: the job doesn't give up).
create function app.account_deletion_failed(p_id uuid, p_error text, p_retry_at timestamptz)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.account_deletions
      set last_error = left(p_error, 200), next_attempt_at = coalesce(p_retry_at, now() + interval '1 hour')
      where id = p_id and status = 'pending'
  $$;

-- Lab orders name the doctor and who last called the lab through the membership: the clinic's
-- copy of the name (as 0364, with the snapshot first).
create or replace function app.lab_order_json(o aarogyam.lab_orders, p_costs boolean)
  returns jsonb
  language sql stable set search_path = ''
  as $$
    select to_jsonb(o) - '{org_id,created_by,updated_at,updated_by,due_soon_reminded_on,due_today_reminded_on,overdue_flagged_on}'::text[]
      || jsonb_build_object(
        'vendor_name', v.name, 'vendor_phone', v.phone_e164,
        'contact_name', c.name, 'contact_phone', c.phone_e164, 'contact_email', c.email,
        'contact_whatsapp', c.whatsapp,
        'patient_number', p.number, 'patient_name', p.full_name,
        'doctor_name', (select coalesce(m.display_name, u.display_name) from aarogyam.memberships m
                        join aarogyam.users u on u.id = m.user_id
                        where m.org_id = o.org_id and m.id = o.doctor_id),
        'last_contacted_by_name', (select coalesce(m.display_name, u.display_name) from aarogyam.memberships m
                                   join aarogyam.users u on u.id = m.user_id
                                   where m.org_id = o.org_id and m.id = o.last_contacted_by),
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', i.id, 'line_no', i.line_no, 'work_type', i.work_type,
                             'teeth', to_jsonb(i.teeth), 'shade', i.shade, 'material', i.material,
                             'qty', i.qty,
                             'unit_cost_paise', case when p_costs then i.unit_cost_paise end)
                           order by i.line_no)
                           from aarogyam.lab_order_items i
                           where i.org_id = o.org_id and i.lab_order_id = o.id), '[]'::jsonb))
    from aarogyam.patients p
    join aarogyam.lab_vendors v on v.org_id = o.org_id and v.id = o.vendor_id
    left join aarogyam.lab_contacts c on c.org_id = o.org_id and c.id = o.contact_id
    where p.org_id = o.org_id and p.id = o.patient_id
  $$;

-- The console's list of support grants names who granted each from the clinic's copy (as 0341).
create or replace function app.my_support_grants(p_user_id uuid)
  returns table (grant_id uuid, org_id uuid, slug text, clinic_name text, portal_host text,
                 access text, reason text, starts_at timestamptz, ends_at timestamptz,
                 revoked_at timestamptz, granted_by_name text)
  language sql stable security definer set search_path = ''
  as $$
    select g.id, o.id, o.slug, o.name,
           (select d.hostname from aarogyam.org_domains d
             where d.org_id = o.id and d.kind = 'portal' and d.is_primary and d.verified_at is not null),
           g.access, g.reason, g.starts_at, g.ends_at, g.revoked_at, coalesce(m.display_name, gu.display_name)
    from aarogyam.platform_users p
    join aarogyam.support_grants g on g.platform_user_id = p.id
    join aarogyam.organizations o on o.id = g.org_id
    join aarogyam.memberships m on m.org_id = g.org_id and m.id = g.granted_by
    join aarogyam.users gu on gu.id = m.user_id
    where p.user_id = p_user_id
    order by g.ends_at desc, g.id
    limit 100
  $$;

-- The console's member list shows the clinic's copy of the name (as 0050).
create or replace function app.console_clinic_members(p_org_id uuid)
  returns table (membership_id uuid, display_name text, email text, role_key text, role_name text,
                 status text, joined_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select m.id, coalesce(m.display_name, u.display_name), u.email, r.key, r.name, m.status, m.joined_at
    from aarogyam.memberships m
    join aarogyam.users u on u.id = m.user_id
    join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
    where m.org_id = p_org_id
    order by m.status, coalesce(m.display_name, u.display_name)
  $$;

revoke execute on function app.delete_own_account(uuid, uuid) from public;
revoke execute on function app.account_deletions_claim(int, int) from public;
revoke execute on function app.account_deletion_done(uuid, text) from public;
revoke execute on function app.account_deletion_failed(uuid, text, timestamptz) from public;
grant execute on function app.delete_own_account(uuid, uuid) to aarogyam_api;
grant execute on function app.account_deletions_claim(int, int) to aarogyam_api;
grant execute on function app.account_deletion_done(uuid, text) to aarogyam_api;
grant execute on function app.account_deletion_failed(uuid, text, timestamptz) to aarogyam_api;
