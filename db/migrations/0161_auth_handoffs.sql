-- Central sign-in (docs/decisions.md, 2026-10-05 "Central sign-in and the session handoff").
-- People sign in once on the public site; a Supabase session belongs to one origin, so the
-- site asks for a handoff code bound to the person and the clinic (or console) host they are
-- going to, and that host redeems it once, within a minute, for a session of its own. Only the
-- code's SHA-256 is stored; the code itself travels in a URL fragment, which is never sent to
-- a server or logged.
set local lock_timeout = '5s';

create table aarogyam.auth_handoffs (
  id uuid primary key default app.uuid_v7(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references aarogyam.users (id),
  -- The only host that may redeem it: a clinic's portal host or the console host.
  target_host text not null check (target_host = lower(target_host) and char_length(target_host) between 1 and 253),
  expires_at timestamptz not null,
  -- Set by the first redeem attempt, right or wrong, so a code works at most once.
  redeemed_at timestamptz,
  -- Whether that attempt was valid (right host, in time) and gave a session.
  redeemed boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((redeemed_at is null) = (redeemed is null))
);
create index auth_handoffs_user on aarogyam.auth_handoffs (user_id);
create index auth_handoffs_expires on aarogyam.auth_handoffs (expires_at);
comment on table aarogyam.auth_handoffs is 'sensitivity=internal offline=server_only lifecycle=ephemeral';
alter table aarogyam.auth_handoffs enable row level security;
create trigger set_row_times before insert or update on aarogyam.auth_handoffs
  for each row execute function app.set_row_times();
-- The change history records who asked for which host and whether it was used; never the hash.
create trigger audit after insert or update or delete on aarogyam.auth_handoffs
  for each row execute function app.audit_row();
insert into audit.audit_config (table_name, mask) values ('aarogyam.auth_handoffs', '{code_hash}');

-- Stores a handoff for the person behind p_auth_uid to p_host, valid for p_ttl_seconds (at most
-- 60), if they may go there: an active member of the open clinic whose verified portal host it
-- is, or active Sakalya staff when it is the console host. Returns when it expires, or nothing
-- when the host is not theirs (the API answers 404 either way, revealing nothing). Old
-- handoffs are deleted on the way.
create function app.auth_handoff_create(
  p_auth_uid uuid, p_code_hash text, p_host text, p_console_host text, p_ttl_seconds int)
  returns timestamptz
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_user uuid;
    v_host text := lower(p_host);
    v_allowed boolean;
    v_expires timestamptz := now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 60), 1), 60));
  begin
    delete from aarogyam.auth_handoffs where expires_at < now() - interval '1 day';

    select u.id into v_user from aarogyam.users u where u.auth_uid = p_auth_uid and u.status = 'active';
    if v_user is null then
      return null;
    end if;
    if v_host = lower(p_console_host) then
      select exists (select 1 from aarogyam.platform_users p where p.user_id = v_user and p.active)
        into v_allowed;
    else
      select exists (
        select 1
        from aarogyam.org_domains d
        join aarogyam.organizations o on o.id = d.org_id
        join aarogyam.memberships m on m.org_id = d.org_id and m.user_id = v_user
        where d.hostname = v_host and d.kind = 'portal' and d.verified_at is not null
          and o.status in ('trial', 'active') and m.status = 'active')
        into v_allowed;
    end if;
    if not v_allowed then
      return null;
    end if;
    insert into aarogyam.auth_handoffs (code_hash, user_id, target_host, expires_at)
      values (p_code_hash, v_user, v_host, v_expires);
    return v_expires;
  end
  $$;

-- Redeems a handoff on p_host: the first attempt uses it up whatever happens; it gives the
-- person's sign-in id and email only on the right host, in time, for a person still active.
create function app.auth_handoff_redeem(p_code_hash text, p_host text)
  returns table (auth_uid uuid, email text)
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_id uuid;
    v_user uuid;
    v_host text;
    v_expires timestamptz;
    v_valid boolean;
  begin
    select h.id, h.user_id, h.target_host, h.expires_at into v_id, v_user, v_host, v_expires
      from aarogyam.auth_handoffs h
      where h.code_hash = p_code_hash and h.redeemed_at is null
      for update;
    if v_id is null then
      return;
    end if;
    v_valid := v_host = lower(p_host) and v_expires > now();
    update aarogyam.auth_handoffs set redeemed_at = now(), redeemed = v_valid where id = v_id;
    if not v_valid then
      return;
    end if;
    return query select u.auth_uid, u.email from aarogyam.users u where u.id = v_user and u.status = 'active';
  end
  $$;

grant execute on function app.auth_handoff_create(uuid, text, text, text, int) to aarogyam_api;
grant execute on function app.auth_handoff_redeem(text, text) to aarogyam_api;
