-- The patient app's sign-in sessions, so a patient can see where they are signed in and sign a
-- session out (docs/patient-access.md). Staff sessions live in aarogyam.sessions, keyed by user;
-- patient accounts are not users, so they get their own registry. app.patient_access (the one
-- round trip every patient request makes) records the session and refuses a revoked one.
set local lock_timeout = '5s';

create table aarogyam.patient_sessions (
  id uuid primary key default app.uuid_v7(),
  account_id uuid not null references aarogyam.patient_accounts (id),
  provider_session_id uuid not null unique,
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason in ('signed_out')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index patient_sessions_account on aarogyam.patient_sessions (account_id, last_active_at desc);
comment on table aarogyam.patient_sessions is 'sensitivity=personal offline=server_only lifecycle=ephemeral';
alter table aarogyam.patient_sessions enable row level security;
create trigger set_row_times before insert or update on aarogyam.patient_sessions
  for each row execute function app.set_row_times();
create trigger audit after insert or update or delete on aarogyam.patient_sessions
  for each row execute function app.audit_row();
insert into audit.audit_config (table_name, exclude) values ('aarogyam.patient_sessions', '{last_active_at}');

-- As app.patient_access(uuid, text, uuid), which stays for servers still calling it, and also
-- records the sign-in session for the account (refreshing last_active_at at most every five
-- minutes) and reports it revoked when the patient signed it out or it belongs to another account.
create function app.patient_access(p_auth_uid uuid, p_email text, p_session_id uuid, p_session_expires_at timestamptz)
  returns table (
    account_id uuid, account_status text, account_email text, session_revoked boolean,
    link_id uuid, org_id uuid, slug text, clinic_name text, portal_host text, timezone text,
    number_prefix text, branding jsonb, patient_id uuid, patient_number text, linked_at timestamptz
  )
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    r record;
    v_revoked boolean;
  begin
    for r in select * from app.patient_access(p_auth_uid, p_email, p_session_id) loop
      if v_revoked is null then
        insert into aarogyam.patient_sessions as s (account_id, provider_session_id, expires_at)
        values (r.account_id, p_session_id, p_session_expires_at)
        on conflict (provider_session_id) do update
          set last_active_at = now()
          where s.last_active_at < now() - interval '5 minutes';
        select exists (select 1 from aarogyam.patient_sessions s
                       where s.provider_session_id = p_session_id
                         and (s.revoked_at is not null or s.account_id <> r.account_id))
          into v_revoked;
      end if;
      account_id := r.account_id; account_status := r.account_status; account_email := r.account_email;
      session_revoked := r.session_revoked or v_revoked;
      link_id := r.link_id; org_id := r.org_id; slug := r.slug; clinic_name := r.clinic_name;
      portal_host := r.portal_host; timezone := r.timezone; number_prefix := r.number_prefix;
      branding := r.branding; patient_id := r.patient_id; patient_number := r.patient_number;
      linked_at := r.linked_at;
      return next;
    end loop;
  end
  $$;

-- The account's sessions that are neither revoked nor expired, most recently used first.
create function app.patient_sessions(p_account uuid, p_current_session uuid)
  returns table (id uuid, created_at timestamptz, last_active_at timestamptz, expires_at timestamptz,
                 is_current boolean)
  language sql stable security definer set search_path = ''
  as $$
    select s.id, s.created_at, s.last_active_at, s.expires_at, s.provider_session_id = p_current_session
    from aarogyam.patient_sessions s
    where s.account_id = p_account and s.revoked_at is null and s.expires_at > now()
    order by s.last_active_at desc, s.id
    limit 50
  $$;

-- Signs out one of the account's own sessions and returns its provider session id; no row when
-- it isn't theirs. Revoking twice keeps the first time.
create function app.revoke_patient_session(p_account uuid, p_session uuid)
  returns table (provider_session_id uuid)
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.patient_sessions s
      set revoked_at = coalesce(s.revoked_at, now()), revoke_reason = coalesce(s.revoke_reason, 'signed_out')
      where s.id = p_session and s.account_id = p_account
      returning s.provider_session_id
  $$;

grant execute on function app.patient_access(uuid, text, uuid, timestamptz) to aarogyam_api;
grant execute on function app.patient_sessions(uuid, uuid), app.revoke_patient_session(uuid, uuid) to aarogyam_api;
revoke execute on function app.patient_access(uuid, text, uuid, timestamptz) from public;
revoke execute on function app.patient_sessions(uuid, uuid), app.revoke_patient_session(uuid, uuid) from public;
