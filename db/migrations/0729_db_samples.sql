-- Database history for the console's Insights page (docs/plans/console-insights-design.md, 1b).
--
-- The outbox drain job calls app.record_db_sample() on every run; it writes at most one row
-- every 5 minutes and deletes rows older than 90 days, so the table stays around 4 MB. A row
-- holds database-wide counters only: no clinic, no person, no statement text. The console reads
-- it through app.db_history(), which turns the cumulative counters into rates per minute.
-- The table is in `private`: no application role reads or writes it directly.
set local lock_timeout = '5s';

create table private.db_samples (
  at timestamptz primary key default now(),
  connections int not null,
  max_connections int not null,
  cache_hit_ratio numeric(6, 4),
  db_bytes bigint not null,
  -- Cumulative counters from pg_stat_database; they reset when statistics are reset.
  xact_commit bigint not null,
  xact_rollback bigint not null,
  deadlocks bigint not null,
  temp_bytes bigint not null,
  tup_read bigint not null,
  tup_written bigint not null
);
alter table private.db_samples enable row level security;

-- One sample, unless one was taken in the last 5 minutes. Returns whether it wrote one.
create function app.record_db_sample()
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  begin
    -- Two drain runs at once take turns; the second sees the first one's row.
    perform pg_catalog.pg_advisory_xact_lock(hashtext('private.db_samples'));
    if exists (select 1 from private.db_samples where at > now() - interval '5 minutes') then
      return false;
    end if;
    insert into private.db_samples (connections, max_connections, cache_hit_ratio, db_bytes,
                                    xact_commit, xact_rollback, deadlocks, temp_bytes,
                                    tup_read, tup_written)
    select (select count(*) from pg_catalog.pg_stat_activity where datname = current_database()),
           current_setting('max_connections')::int,
           round(d.blks_hit::numeric / nullif(d.blks_hit + d.blks_read, 0), 4),
           pg_catalog.pg_database_size(current_database()),
           d.xact_commit, d.xact_rollback, d.deadlocks, d.temp_bytes,
           d.tup_returned + d.tup_fetched, d.tup_inserted + d.tup_updated + d.tup_deleted
    from pg_catalog.pg_stat_database d
    where d.datname = current_database();
    delete from private.db_samples where at < now() - interval '90 days';
    return true;
  end
  $$;

-- Samples since `p_since`, one point per `p_bucket`: the highest connections, the latest size and
-- cache hit ratio, and counters as rates per minute (a counter that went down was reset, so the
-- new value is the change).
create function app.db_history(p_since timestamptz, p_bucket interval)
  returns table (at timestamptz, connections int, max_connections int, cache_hit_ratio numeric,
                 db_bytes bigint, commits_per_min numeric, rollbacks_per_min numeric,
                 rows_read_per_min numeric, rows_written_per_min numeric, deadlocks bigint,
                 temp_bytes bigint)
  language sql stable security definer set search_path = ''
  as $$
    with samples as (
      select s.*,
             extract(epoch from s.at - lag(s.at) over w) / 60 as minutes,
             s.xact_commit - lag(s.xact_commit) over w as d_commit,
             s.xact_rollback - lag(s.xact_rollback) over w as d_rollback,
             s.tup_read - lag(s.tup_read) over w as d_read,
             s.tup_written - lag(s.tup_written) over w as d_written,
             s.deadlocks - lag(s.deadlocks) over w as d_deadlocks,
             s.temp_bytes - lag(s.temp_bytes) over w as d_temp
      from private.db_samples s
      where s.at >= p_since - interval '15 minutes'
      window w as (order by s.at)
    ), deltas as (
      select date_bin(p_bucket, s.at, timestamptz '2000-01-01') as bucket, s.at, s.connections,
             s.max_connections, s.cache_hit_ratio, s.db_bytes, s.minutes,
             case when s.d_commit < 0 then s.xact_commit else s.d_commit end as d_commit,
             case when s.d_rollback < 0 then s.xact_rollback else s.d_rollback end as d_rollback,
             case when s.d_read < 0 then s.tup_read else s.d_read end as d_read,
             case when s.d_written < 0 then s.tup_written else s.d_written end as d_written,
             case when s.d_deadlocks < 0 then s.deadlocks else s.d_deadlocks end as d_deadlocks,
             case when s.d_temp < 0 then s.temp_bytes else s.d_temp end as d_temp
      from samples s
      where s.at >= p_since
    )
    select d.bucket,
           max(d.connections),
           max(d.max_connections),
           (array_agg(d.cache_hit_ratio order by d.at desc))[1],
           (array_agg(d.db_bytes order by d.at desc))[1],
           round(sum(d.d_commit) / nullif(sum(d.minutes) filter (where d.d_commit is not null), 0), 2),
           round(sum(d.d_rollback) / nullif(sum(d.minutes) filter (where d.d_rollback is not null), 0), 2),
           round(sum(d.d_read) / nullif(sum(d.minutes) filter (where d.d_read is not null), 0), 2),
           round(sum(d.d_written) / nullif(sum(d.minutes) filter (where d.d_written is not null), 0), 2),
           coalesce(sum(d.d_deadlocks), 0)::bigint,
           coalesce(sum(d.d_temp), 0)::bigint
    from deltas d
    group by d.bucket
    order by d.bucket
  $$;

-- The slowest statements now keep only SELECT, INSERT, UPDATE and DELETE: pg_stat_statements
-- normalises their constants to $1, $2 ..., but utility statements (SET, ALTER ROLE ...) can
-- carry literal values.
create or replace function app.db_health()
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
             and query ~* ''^\s*(select|insert|update|delete)\M''
           order by mean_exec_time desc limit 10) q', statements_schema)
      into slow;
    end if;

    return result || jsonb_build_object('slow_queries', slow);
  end
  $$;

grant execute on function app.record_db_sample() to aarogyam_api;
grant execute on function app.db_history(timestamptz, interval) to aarogyam_api;
