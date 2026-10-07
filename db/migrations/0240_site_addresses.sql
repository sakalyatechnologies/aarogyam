-- Clinic website addresses at the edge (docs/decisions.md, 2026-10-07 "Clinic sites go live").
-- Publishing a site queues a second host for the clinic, kind `site`, next to its portal host.
-- The outbox job that gives portal hosts their Worker (0160) does the same for site hosts, and
-- removes the Worker again when the clinic takes the site down, so the account's Worker limit
-- is spent only on live sites. The status columns are the ones portal hosts already use.
set local lock_timeout = '5s';

alter table aarogyam.org_domains drop constraint org_domains_kind_check;
alter table aarogyam.org_domains add constraint org_domains_kind_check
  check (kind in ('portal', 'website', 'site'));

-- `removing`: taken down, waiting for the job to delete the Worker; the row is deleted then.
alter table aarogyam.org_domains drop constraint org_domains_edge_status_check;
alter table aarogyam.org_domains add constraint org_domains_edge_status_check
  check (edge_status in ('pending', 'ready', 'failed', 'removing'));

alter table aarogyam.org_domains drop constraint org_domains_portal_edge;
alter table aarogyam.org_domains add constraint org_domains_edge_hosts
  check (kind not in ('portal', 'site') or edge_status is not null);

alter table aarogyam.org_domains drop constraint org_domains_edge_due;
alter table aarogyam.org_domains add constraint org_domains_edge_due
  check (edge_status not in ('pending', 'removing') or edge_next_attempt_at is not null);

drop index aarogyam.org_domains_edge_due;
create index org_domains_edge_work on aarogyam.org_domains (edge_next_attempt_at)
  where edge_status in ('pending', 'removing');

create or replace function app.org_domain_edge_pending()
  returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.kind in ('portal', 'site') and new.edge_status is null then
      new.edge_status := 'pending';
      new.edge_next_attempt_at := now();
    end if;
    return new;
  end
  $$;

-- Claims up to p_limit due portal and site hosts, to make work or to remove, across clinics
-- for p_lease_seconds. Replaces app.edge_hosts_claim (portal only), which stays for API
-- versions still running during a deploy; drop it in a later release.
create function app.edge_hosts_work(p_limit int, p_lease_seconds int)
  returns table (org_id uuid, domain_id uuid, slug text, hostname text, attempts int,
                 kind text, removing boolean)
  language sql volatile security definer set search_path = ''
  as $$
    with due as (
      select d.id
      from aarogyam.org_domains d
      where d.kind in ('portal', 'site') and d.edge_status in ('pending', 'removing')
        and d.edge_next_attempt_at <= now()
      order by d.edge_next_attempt_at
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked
    )
    update aarogyam.org_domains d
      set edge_attempts = d.edge_attempts + 1,
          edge_next_attempt_at = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 60), 1))
      from due, aarogyam.organizations o
      where d.id = due.id and o.id = d.org_id
      returning d.org_id, d.id, o.slug, d.hostname, d.edge_attempts, d.kind, d.edge_status = 'removing'
  $$;

-- A failed removal is retried as a removal; a failed set-up as a set-up.
create or replace function app.edge_host_failed(p_domain_id uuid, p_error text, p_retry_at timestamptz)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.org_domains
      set edge_error = left(p_error, 200),
          edge_status = case when p_retry_at is null then 'failed' else edge_status end,
          edge_next_attempt_at = p_retry_at
      where id = p_domain_id and edge_status in ('pending', 'removing')
  $$;

-- The Worker of a taken-down site is gone: the host is forgotten.
create function app.edge_host_removed(p_domain_id uuid)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    delete from aarogyam.org_domains
      where id = p_domain_id and kind = 'site' and edge_status = 'removing'
  $$;

-- Queues portal and site hosts again (the backfill, or a retry after fixing the cause), except
-- sites being taken down. Returns how many.
create or replace function app.edge_hosts_requeue(p_slug text)
  returns bigint
  language sql volatile security definer set search_path = ''
  as $$
    with queued as (
      update aarogyam.org_domains d
        set edge_status = 'pending', edge_attempts = 0, edge_next_attempt_at = now(), edge_error = null
        from aarogyam.organizations o
        where o.id = d.org_id and d.kind in ('portal', 'site') and d.edge_status <> 'removing'
          and (p_slug is null or o.slug = p_slug)
        returning 1
    )
    select count(*) from queued
  $$;

-- Publishing: the clinic's site host, queued (or kept, when it is already served). The caller
-- is a clinic's scoped transaction, so the clinic is app.tenant_id(), never an argument. A host
-- that changed (a new address template) is queued again; one that failed or was being removed too.
create function app.site_host_publish(p_hostname text)
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_org uuid := app.tenant_id();
  begin
    if v_org is null then
      raise exception 'no clinic' using errcode = '42501';
    end if;
    insert into aarogyam.org_domains (org_id, hostname, kind, is_primary, verified_at)
      values (v_org, lower(p_hostname), 'site', true, now())
      on conflict (org_id, kind) where is_primary
      do update set
        edge_status = case
          when aarogyam.org_domains.hostname <> excluded.hostname
            or aarogyam.org_domains.edge_status in ('failed', 'removing') then 'pending'
          else aarogyam.org_domains.edge_status end,
        edge_attempts = case
          when aarogyam.org_domains.hostname <> excluded.hostname
            or aarogyam.org_domains.edge_status in ('failed', 'removing') then 0
          else aarogyam.org_domains.edge_attempts end,
        edge_next_attempt_at = case
          when aarogyam.org_domains.hostname <> excluded.hostname
            or aarogyam.org_domains.edge_status in ('failed', 'removing') then now()
          else aarogyam.org_domains.edge_next_attempt_at end,
        edge_error = case
          when aarogyam.org_domains.hostname <> excluded.hostname
            or aarogyam.org_domains.edge_status in ('failed', 'removing') then null
          else aarogyam.org_domains.edge_error end,
        hostname = excluded.hostname,
        verified_at = now();
  end
  $$;

-- Taking down: the host stops resolving at once and the job removes its Worker.
create function app.site_host_take_down()
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_org uuid := app.tenant_id();
  begin
    if v_org is null then
      raise exception 'no clinic' using errcode = '42501';
    end if;
    update aarogyam.org_domains
      set edge_status = 'removing', edge_attempts = 0, edge_next_attempt_at = now(),
          edge_error = null, verified_at = null
      where org_id = v_org and kind = 'site' and edge_status <> 'removing';
  end
  $$;

grant execute on function app.edge_hosts_work(int, int) to aarogyam_api;
grant execute on function app.edge_host_removed(uuid) to aarogyam_api;
grant execute on function app.site_host_publish(text) to app_user;
grant execute on function app.site_host_take_down() to app_user;
