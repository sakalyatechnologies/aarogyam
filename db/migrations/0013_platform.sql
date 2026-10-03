-- Sakalya's console: who may use it, and the functions behind it. The console never sees
-- patient records; it gets counts and service health only.
--
-- The console runs in the same API, on the console host, behind Cloudflare Access. The API
-- checks the caller's platform role (app.platform_access) before calling these functions.
set local lock_timeout = '5s';

create table aarogyam.platform_users (
  id uuid primary key default app.uuid_v7(),
  user_id uuid not null unique references aarogyam.users (id),
  role text not null check (role in ('owner', 'support', 'onboarding', 'analyst')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table aarogyam.platform_users is 'sensitivity=internal offline=server_only lifecycle=mutable';
alter table aarogyam.platform_users enable row level security;
create trigger set_row_times before insert or update on aarogyam.platform_users
  for each row execute function app.set_row_times();
create trigger audit after insert or update or delete on aarogyam.platform_users
  for each row execute function app.audit_row();

-- The platform role of the person behind a token, if they are active Sakalya staff.
create function app.platform_access(p_auth_uid uuid)
  returns table (user_id uuid, display_name text, role text)
  language sql stable security definer set search_path = ''
  as $$
    select u.id, u.display_name, p.role
    from aarogyam.users u
    join aarogyam.platform_users p on p.user_id = u.id
    where u.auth_uid = p_auth_uid and p.active and u.status = 'active'
  $$;

-- Every clinic with counts. Counts only: never names, phones or records.
create function app.console_clinics()
  returns table (id uuid, slug text, name text, specialty text, status text, created_at timestamptz,
                 portal_host text, active_members bigint, patients bigint)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.name, o.specialty, o.status, o.created_at,
           (select d.hostname from aarogyam.org_domains d
             where d.org_id = o.id and d.kind = 'portal' and d.is_primary),
           (select count(*) from aarogyam.memberships m where m.org_id = o.id and m.status = 'active'),
           (select count(*) from aarogyam.patients p where p.org_id = o.id and p.deleted_at is null)
    from aarogyam.organizations o
    order by o.created_at desc
  $$;

-- Creates a clinic and an invitation for its owner. The API generates the invitation token,
-- stores only its SHA-256 here, and gives the token to the owner by email.
create function app.console_create_clinic(
  p_slug text, p_name text, p_number_prefix text, p_specialty text, p_portal_host text,
  p_owner_email text, p_invite_token_hash text, p_invite_expires_at timestamptz, p_created_by uuid)
  returns table (org_id uuid, invitation_id uuid)
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_org uuid;
    v_invitation uuid;
  begin
    v_org := app.create_clinic(p_slug, p_name, p_number_prefix, p_specialty, p_portal_host, null);
    insert into aarogyam.invitations (org_id, email, role_id, invited_by, token_hash, expires_at)
    select v_org, lower(p_owner_email), r.id, p_created_by, p_invite_token_hash, p_invite_expires_at
    from aarogyam.roles r where r.org_id = v_org and r.key = 'owner'
    returning id into v_invitation;
    return query select v_org, v_invitation;
  end
  $$;

-- Database health for the console's service dashboard: connections, cache hit ratio, size,
-- the biggest tables with dead rows, and the slowest statements when pg_stat_statements is
-- installed (it is on Supabase). Statement texts are normalised, so they carry no values.
create function app.db_health()
  returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
  declare
    result jsonb;
    statements_schema text;
    slow jsonb := '[]';
  begin
    select jsonb_build_object(
      'connections_used', (select count(*) from pg_catalog.pg_stat_activity where datname = current_database()),
      'connections_max', current_setting('max_connections')::int,
      'cache_hit_ratio', (select round(sum(blks_hit)::numeric / nullif(sum(blks_hit) + sum(blks_read), 0), 4)
                            from pg_catalog.pg_stat_database where datname = current_database()),
      'size_bytes', pg_catalog.pg_database_size(current_database()),
      'tables', (select coalesce(jsonb_agg(t), '[]') from (
                   select n.nspname || '.' || c.relname as name, s.n_live_tup as live_rows,
                          s.n_dead_tup as dead_rows, pg_catalog.pg_total_relation_size(c.oid) as size_bytes
                   from pg_catalog.pg_stat_user_tables s
                   join pg_catalog.pg_class c on c.oid = s.relid
                   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                   where n.nspname in ('aarogyam', 'audit', 'private')
                   order by pg_catalog.pg_total_relation_size(c.oid) desc
                   limit 15) t))
    into result;

    select n.nspname into statements_schema
      from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pg_stat_statements';
    if statements_schema is not null then
      execute format(
        'select coalesce(jsonb_agg(q), ''[]'') from (
           select queryid::text as query_id, calls, round(mean_exec_time::numeric, 2) as mean_ms,
                  round(total_exec_time::numeric, 2) as total_ms, left(query, 160) as query
           from %I.pg_stat_statements
           where dbid = (select oid from pg_catalog.pg_database where datname = current_database())
           order by mean_exec_time desc limit 10) q', statements_schema)
      into slow;
    end if;

    return result || jsonb_build_object('slow_queries', slow);
  end
  $$;

grant execute on function app.platform_access(uuid) to aarogyam_api;
grant execute on function app.console_clinics() to aarogyam_api;
grant execute on function app.console_create_clinic(text, text, text, text, text, text, text, timestamptz, uuid)
  to aarogyam_api;
grant execute on function app.db_health() to aarogyam_api;
