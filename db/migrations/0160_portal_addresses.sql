-- Portal addresses at the edge (docs/decisions.md, 2026-10-05 "Automatic clinic addresses").
-- A clinic's portal host only works once Cloudflare serves it. On workers.dev, which has no
-- wildcard subdomains, every clinic needs its own small Worker; the outbox job
-- (`aarogyam outbox drain`) creates it through the Cloudflare API. These columns are that job's
-- queue and its result, which the console shows as "address ready / pending / failed". With a
-- wildcard domain the same job marks every new host ready without calling anything.
set local lock_timeout = '5s';

alter table aarogyam.org_domains
  -- Portal rows only: pending until the edge serves the host, then ready, or failed after the
  -- last attempt. Website rows (Cloudflare for SaaS, later) leave it null for now.
  add column edge_status text check (edge_status in ('pending', 'ready', 'failed')),
  add column edge_attempts int not null default 0 check (edge_attempts >= 0),
  add column edge_next_attempt_at timestamptz,
  -- A short reason without secrets, such as "cloudflare answered 403".
  add column edge_error text check (char_length(edge_error) <= 200),
  add column edge_ready_at timestamptz;

-- Every portal host already in place is queued too, so the first run of the job gives
-- existing clinics their Worker (and replaces hand-deployed copies of the portal).
update aarogyam.org_domains
  set edge_status = 'pending', edge_next_attempt_at = now()
  where kind = 'portal';

alter table aarogyam.org_domains
  add constraint org_domains_portal_edge check (kind <> 'portal' or edge_status is not null),
  add constraint org_domains_edge_due check (edge_status is distinct from 'pending' or edge_next_attempt_at is not null);

-- New portal hosts start pending, whichever path creates them (console, approved application,
-- seed), so no creation path can forget to queue its address.
create function app.org_domain_edge_pending()
  returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.kind = 'portal' and new.edge_status is null then
      new.edge_status := 'pending';
      new.edge_next_attempt_at := now();
    end if;
    return new;
  end
  $$;
create trigger edge_pending before insert on aarogyam.org_domains
  for each row execute function app.org_domain_edge_pending();

create index org_domains_edge_due on aarogyam.org_domains (edge_next_attempt_at)
  where edge_status = 'pending';

-- The change history keeps the outcome, not each attempt.
insert into audit.audit_config (table_name, exclude)
  values ('aarogyam.org_domains', '{edge_attempts,edge_next_attempt_at,edge_error}');

-- Claims up to p_limit due portal hosts across clinics for p_lease_seconds, like
-- app.outbox_claim: a job that dies mid-call leaves the host to be retried after the lease.
create function app.edge_hosts_claim(p_limit int, p_lease_seconds int)
  returns table (org_id uuid, domain_id uuid, slug text, hostname text, attempts int)
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select d.id
      from aarogyam.org_domains d
      where d.kind = 'portal' and d.edge_status = 'pending' and d.edge_next_attempt_at <= now()
      order by d.edge_next_attempt_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
    )
    update aarogyam.org_domains d
      set edge_attempts = d.edge_attempts + 1,
          edge_next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 1))
      from due, aarogyam.organizations o
      where d.id = due.id and o.id = d.org_id
      returning d.org_id, d.id, o.slug, d.hostname, d.edge_attempts
  $$;

-- Records that the edge serves the host.
create function app.edge_host_ready(p_domain_id uuid)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.org_domains
      set edge_status = 'ready', edge_ready_at = now(), edge_error = null, edge_next_attempt_at = null
      where id = p_domain_id and edge_status = 'pending'
  $$;

-- Records a failed attempt: retried at p_retry_at, or failed for good when it is null.
create function app.edge_host_failed(p_domain_id uuid, p_error text, p_retry_at timestamptz)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.org_domains
      set edge_error = left(p_error, 200),
          edge_status = case when p_retry_at is null then 'failed' else 'pending' end,
          edge_next_attempt_at = p_retry_at
      where id = p_domain_id and edge_status = 'pending'
  $$;

-- Queues portal hosts again (the backfill, or a retry after fixing the cause): every clinic's,
-- or one clinic's by slug, ready ones included, since provisioning is idempotent. Returns how many.
create function app.edge_hosts_requeue(p_slug text)
  returns bigint
  language sql volatile security definer set search_path = ''
  as $$
    with queued as (
      update aarogyam.org_domains d
        set edge_status = 'pending', edge_attempts = 0, edge_next_attempt_at = now(), edge_error = null
        from aarogyam.organizations o
        where o.id = d.org_id and d.kind = 'portal' and (p_slug is null or o.slug = p_slug)
        returning 1
    )
    select count(*) from queued
  $$;

-- The console's lists gain the primary portal host's address status.
drop function app.console_clinics();
create function app.console_clinics()
  returns table (id uuid, slug text, name text, specialty text, status text, created_at timestamptz,
                 portal_host text, address_status text, active_members bigint, patients bigint)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.name, o.specialty, o.status, o.created_at, d.hostname, d.edge_status,
           (select count(*) from aarogyam.memberships m where m.org_id = o.id and m.status = 'active'),
           (select count(*) from aarogyam.patients p where p.org_id = o.id and p.deleted_at is null)
    from aarogyam.organizations o
    left join aarogyam.org_domains d on d.org_id = o.id and d.kind = 'portal' and d.is_primary
    order by o.created_at desc
  $$;

drop function app.console_clinic(uuid);
create function app.console_clinic(p_org_id uuid)
  returns table (id uuid, slug text, name text, specialty text, status text, timezone text,
                 created_at timestamptz, hosts text[], address_status text, address_error text,
                 active_members bigint, patients bigint, pending_invitations bigint)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.name, o.specialty, o.status, o.timezone, o.created_at,
           array(select h.hostname from aarogyam.org_domains h where h.org_id = o.id
                 order by h.is_primary desc, h.hostname),
           d.edge_status, d.edge_error,
           (select count(*) from aarogyam.memberships m where m.org_id = o.id and m.status = 'active'),
           (select count(*) from aarogyam.patients p where p.org_id = o.id and p.deleted_at is null),
           (select count(*) from aarogyam.invitations i
             where i.org_id = o.id and i.accepted_at is null and i.expires_at > now())
    from aarogyam.organizations o
    left join aarogyam.org_domains d on d.org_id = o.id and d.kind = 'portal' and d.is_primary
    where o.id = p_org_id
  $$;

grant execute on function app.edge_hosts_claim(int, int) to aarogyam_api;
grant execute on function app.edge_host_ready(uuid) to aarogyam_api;
grant execute on function app.edge_host_failed(uuid, text, timestamptz) to aarogyam_api;
grant execute on function app.edge_hosts_requeue(text) to aarogyam_api;
grant execute on function app.console_clinics() to aarogyam_api;
grant execute on function app.console_clinic(uuid) to aarogyam_api;
