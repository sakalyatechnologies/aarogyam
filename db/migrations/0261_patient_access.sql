-- How a patient account reads its records, enforced by row-level security.
--
-- The API reads each linked clinic in a normal clinic transaction (app.tenant_id() is the clinic)
-- with actor kind `patient_account` and app.user_id() set to the patient account. Every clinic
-- table gets a RESTRICTIVE policy named `patient_account`, ANDed with the clinic policy: for
-- staff and the public pages it is always true; for a patient account it allows only
--   * the linked patient's own row, appointments, payments,
--   * their issued (not draft) prescriptions and bills, with their lines,
--   * their files the clinic marked shared,
--   * the clinic's own reference data (settings, branches, doctors, hours, leave, rooms),
--   * their own link;
-- and nothing else. New clinic tables get a deny-all `patient_account` policy from
-- app.protect_clinic_table, and the schema lint fails a clinic table without one.
set local lock_timeout = '5s';

-- The patient record the signed-in patient account is linked to in the current clinic; null
-- for anyone else. Evaluated once per statement through `(select ...)` in the policies.
create function app.linked_patient_id() returns uuid
  language sql stable security definer set search_path = ''
  as $$
    select l.patient_id from aarogyam.patient_links l
    where app.actor_kind() = 'patient_account'
      and l.org_id = app.tenant_id()
      and l.account_id = app.user_id()
      and l.status = 'active'
  $$;
grant execute on function app.linked_patient_id() to app_user;

-- New clinic tables are closed to patient accounts until a migration opens them on purpose.
create or replace function app.protect_clinic_table(target regclass, lifecycle text, audited boolean default true)
  returns void
  language plpgsql set search_path = ''
  as $$
  begin
    if lifecycle not in ('mutable', 'soft_delete', 'finalizable', 'append_only', 'ephemeral') then
      raise exception 'unknown lifecycle %', lifecycle;
    end if;

    execute format('alter table %s enable row level security', target);
    execute format('create policy same_clinic on %s to app_user
                    using (org_id = (select app.tenant_id()))
                    with check (org_id = (select app.tenant_id()))', target);
    execute format('create policy patient_account on %s as restrictive to app_user
                    using ((select app.actor_kind()) <> ''patient_account'')
                    with check ((select app.actor_kind()) <> ''patient_account'')', target);

    execute format('grant select, insert on %s to app_user', target);
    if lifecycle in ('mutable', 'soft_delete', 'finalizable', 'ephemeral') then
      execute format('grant update on %s to app_user', target);
    end if;
    if lifecycle = 'ephemeral' then
      execute format('grant delete on %s to app_user', target);
    end if;

    execute format('create trigger set_row_meta before insert or update on %s
                    for each row execute function app.set_row_meta()', target);
    if lifecycle = 'append_only' then
      execute format('create trigger forbid_change before update or delete on %s
                      for each row execute function app.forbid_change()', target);
    end if;
    if audited then
      execute format('create trigger audit after insert or update or delete on %s
                      for each row execute function app.audit_row()', target);
    end if;
  end
  $$;

-- A restrictive `patient_account` policy on every clinic table that exists now: the ones a
-- patient may read get their rule, the rest deny.
do $$
declare
  t text;
  rule text;
  staff text := '(select app.actor_kind()) <> ''patient_account''';
  own text := 'patient_id = (select app.linked_patient_id())';
begin
  for t in
    select c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'aarogyam' and c.relkind in ('r', 'p') and not c.relispartition
      and exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
      and not exists (select 1 from pg_catalog.pg_policy p
                      where p.polrelid = c.oid and p.polname = 'patient_account')
  loop
    rule := case t
      when 'patients' then 'id = (select app.linked_patient_id())'
      when 'appointments' then own
      when 'payments' then own
      when 'payment_allocations' then own
      when 'prescriptions' then own || ' and status <> ''draft'''
      when 'invoices' then own || ' and status <> ''draft'''
      when 'attachments' then own || ' and shared_with_patient and deleted_at is null'
      when 'appointment_events' then
        'exists (select 1 from aarogyam.appointments a
                 where a.org_id = appointment_events.org_id and a.id = appointment_events.appointment_id)'
      when 'prescription_items' then
        'exists (select 1 from aarogyam.prescriptions p
                 where p.org_id = prescription_items.org_id and p.id = prescription_items.prescription_id)'
      when 'invoice_items' then
        'exists (select 1 from aarogyam.invoices i
                 where i.org_id = invoice_items.org_id and i.id = invoice_items.invoice_id)'
      when 'patient_links' then 'account_id = (select app.user_id())'
      -- The clinic's reference data: no patient in it.
      when 'org_settings' then 'true'
      when 'branches' then 'true'
      when 'practitioners' then 'true'
      when 'working_hours' then 'true'
      when 'leave_blocks' then 'true'
      when 'rooms' then 'true'
      else 'false'
    end;
    execute format('create policy patient_account on aarogyam.%I as restrictive to app_user
                    using (%s or (%s)) with check (%s or (%s))', t, staff, rule, staff, rule);
  end loop;
end $$;

-- Clinic-wide records outside the clinic tables: a patient account changes no clinic settings,
-- reads no change history, and sees only its own record's access entries.
create policy patient_account on aarogyam.organizations as restrictive for update to app_user
  using ((select app.actor_kind()) <> 'patient_account');
create policy patient_account on audit.audit_events as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'patient_account');
create policy patient_account on audit.access_log as restrictive to app_user
  using ((select app.actor_kind()) <> 'patient_account' or patient_id = (select app.linked_patient_id()))
  with check ((select app.actor_kind()) <> 'patient_account' or patient_id = (select app.linked_patient_id()));

-- Everything the API needs about a signed-in patient, in one round trip: the account (made on
-- the first request from the verified email in the token), whether this sign-in session was
-- revoked, and one row per active link with the clinic and the linked record's number. An
-- account without links returns one row with null link columns.
create function app.patient_access(p_auth_uid uuid, p_email text, p_session_id uuid)
  returns table (
    account_id uuid, account_status text, account_email text, session_revoked boolean,
    link_id uuid, org_id uuid, slug text, clinic_name text, portal_host text, timezone text,
    number_prefix text, branding jsonb, patient_id uuid, patient_number text, linked_at timestamptz
  )
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_id uuid;
    v_email text := lower(nullif(btrim(p_email), ''));
  begin
    select a.id into v_id from aarogyam.patient_accounts a where a.auth_uid = p_auth_uid;
    if v_id is null then
      if v_email is null then
        return;
      end if;
      insert into aarogyam.patient_accounts (auth_uid, email) values (p_auth_uid, v_email)
      on conflict (auth_uid) do nothing
      returning aarogyam.patient_accounts.id into v_id;
      if v_id is null then
        select a.id into v_id from aarogyam.patient_accounts a where a.auth_uid = p_auth_uid;
      end if;
    elsif v_email is not null then
      update aarogyam.patient_accounts a set email = v_email where a.id = v_id and a.email <> v_email;
    end if;

    return query
      select a.id, a.status, a.email, app.session_revoked(p_auth_uid, p_session_id),
             l.id, o.id, o.slug, o.name,
             (select d.hostname from aarogyam.org_domains d
               where d.org_id = o.id and d.kind = 'portal' and d.is_primary and d.verified_at is not null),
             o.timezone, o.number_prefix, coalesce(s.branding, '{}'::jsonb),
             p.id, p.number, l.linked_at
      from aarogyam.patient_accounts a
      left join aarogyam.patient_links l on l.account_id = a.id and l.status = 'active'
        and exists (select 1 from aarogyam.organizations x where x.id = l.org_id and x.status in ('trial', 'active'))
      left join aarogyam.organizations o on o.id = l.org_id
      left join aarogyam.org_settings s on s.org_id = l.org_id
      left join aarogyam.patients p on p.org_id = l.org_id and p.id = l.patient_id
      where a.id = v_id
      order by o.name nulls last;
  end
  $$;

-- Redeems a clinic-issued link code for an account. Returns nothing when no unused, unexpired
-- code has this hash. Otherwise the clinic and the outcome:
--   linked          a new active link
--   already_linked  this account already holds this record's link (a repeat)
--   other_record    this account is linked to another record at the clinic
--   taken           another account holds this record's link
-- Only `linked` uses up the code.
create function app.redeem_patient_link_code(p_account uuid, p_code_hash text)
  returns table (org_id uuid, outcome text)
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_code aarogyam.patient_link_codes%rowtype;
    v_existing aarogyam.patient_links%rowtype;
  begin
    select c.* into v_code from aarogyam.patient_link_codes c
    where c.code_hash = p_code_hash and c.used_at is null and c.replaced_at is null
      and c.expires_at > now()
      and exists (select 1 from aarogyam.organizations o where o.id = c.org_id and o.status in ('trial', 'active'))
    order by c.created_at desc
    limit 1
    for update;
    if v_code.id is null then
      return;
    end if;
    if not exists (select 1 from aarogyam.patient_accounts a where a.id = p_account and a.status = 'active') then
      return;
    end if;

    select l.* into v_existing from aarogyam.patient_links l
    where l.org_id = v_code.org_id and l.account_id = p_account and l.status in ('pending', 'active');
    if v_existing.id is not null and v_existing.status = 'active' then
      return query select v_code.org_id,
        case when v_existing.patient_id = v_code.patient_id then 'already_linked' else 'other_record' end;
      return;
    end if;
    if exists (select 1 from aarogyam.patient_links l
               where l.org_id = v_code.org_id and l.patient_id = v_code.patient_id and l.status = 'active') then
      return query select v_code.org_id, 'taken'::text;
      return;
    end if;

    -- A match the patient asked for at this clinic is settled by the code.
    if v_existing.id is not null then
      update aarogyam.patient_links l set status = 'declined'
      where l.org_id = v_existing.org_id and l.id = v_existing.id;
    end if;
    insert into aarogyam.patient_links (org_id, patient_id, account_id, status, linked_via, consented_at, linked_at)
    values (v_code.org_id, v_code.patient_id, p_account, 'active', 'code', now(), now());
    update aarogyam.patient_link_codes c set used_at = now()
    where c.org_id = v_code.org_id and c.id = v_code.id;
    return query select v_code.org_id, 'linked'::text;
  end
  $$;

-- A patient asks a clinic (by its slug) to connect the record that has their verified email.
-- Never answers whether such a record exists: when exactly one active record at an open clinic
-- has this email, no open link exists for the account there and the record isn't linked, a
-- pending link waits for the front desk to confirm. Otherwise nothing happens.
create function app.request_patient_link(p_account uuid, p_slug text, p_email text)
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_org uuid;
    v_patient uuid;
    v_matches int;
  begin
    if not exists (select 1 from aarogyam.patient_accounts a
                   where a.id = p_account and a.status = 'active' and a.email = lower(p_email)) then
      return;
    end if;
    select o.id into v_org from aarogyam.organizations o
    where o.slug = lower(btrim(p_slug)) and o.status in ('trial', 'active');
    if v_org is null then
      return;
    end if;
    select count(*), min(p.id::text)::uuid into v_matches, v_patient from aarogyam.patients p
    where p.org_id = v_org and p.email = lower(p_email) and p.deleted_at is null and p.status = 'active';
    if v_matches <> 1 then
      return;
    end if;
    if exists (select 1 from aarogyam.patient_links l
               where l.org_id = v_org
                 and ((l.account_id = p_account and l.status in ('pending', 'active'))
                      or (l.patient_id = v_patient and l.status = 'active'))) then
      return;
    end if;
    insert into aarogyam.patient_links (org_id, patient_id, account_id, status, linked_via, consented_at)
    values (v_org, v_patient, p_account, 'pending', 'clinic_confirmed', now());
  end
  $$;

-- The patient ends one of their own links. True when an active or pending link was ended.
create function app.revoke_patient_link(p_account uuid, p_link uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_count int;
  begin
    update aarogyam.patient_links l
    set status = case when l.status = 'active' then 'revoked' else 'declined' end,
        revoked_at = case when l.status = 'active' then now() end,
        revoked_by = case when l.status = 'active' then 'patient' end
    where l.id = p_link and l.account_id = p_account and l.status in ('pending', 'active');
    get diagnostics v_count = row_count;
    return v_count > 0;
  end
  $$;

-- The verified email of a patient account linked (or asking to be linked) to the current clinic,
-- for its staff on Patient 360. Null for any other account, and for patient accounts themselves.
create function app.patient_account_email(p_account uuid) returns text
  language sql stable security definer set search_path = ''
  as $$
    select a.email from aarogyam.patient_accounts a
    where a.id = p_account
      and app.actor_kind() = 'staff'
      and exists (select 1 from aarogyam.patient_links l
                  where l.org_id = app.tenant_id() and l.account_id = a.id)
  $$;
grant execute on function app.patient_account_email(uuid) to app_user;
revoke execute on function app.patient_account_email(uuid) from public;

grant execute on function app.patient_access(uuid, text, uuid) to aarogyam_api;
grant execute on function app.redeem_patient_link_code(uuid, text) to aarogyam_api;
grant execute on function app.request_patient_link(uuid, text, text) to aarogyam_api;
grant execute on function app.revoke_patient_link(uuid, uuid) to aarogyam_api;
revoke execute on function app.patient_access(uuid, text, uuid) from public;
revoke execute on function app.redeem_patient_link_code(uuid, text) from public;
revoke execute on function app.request_patient_link(uuid, text, text) from public;
revoke execute on function app.revoke_patient_link(uuid, uuid) from public;
revoke execute on function app.linked_patient_id() from public;
