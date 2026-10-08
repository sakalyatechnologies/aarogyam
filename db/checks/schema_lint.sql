-- Schema rules every migration must keep. Each query returns the violations; all must be empty.
-- Run by the database tests (and by hand: psql -f db/checks/schema_lint.sql).
-- Clinic tables are the ones with an org_id column in the aarogyam schema, minus the
-- platform tables listed below.

-- name: tables_without_rls
select n.nspname || '.' || c.relname as violation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('aarogyam', 'audit', 'private', 'app')
  and c.relkind in ('r', 'p') and not c.relispartition and not c.relrowsecurity
  -- sqlx's migration ledger: in `private`, which no application or Supabase API role can use.
  and not (n.nspname = 'private' and c.relname = '_sqlx_migrations');

-- name: objects_in_public
select c.relname as violation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  and c.relname not in ('_sqlx_migrations');

-- name: privileges_for_api_exposed_roles
select grantee || ' on ' || table_schema || '.' || table_name as violation
from information_schema.role_table_grants
where grantee in ('anon', 'authenticated', 'PUBLIC')
  and table_schema in ('aarogyam', 'audit', 'private', 'app');

-- name: functions_executable_by_public
select n.nspname || '.' || p.proname as violation
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('app', 'aarogyam', 'audit', 'private')
  and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'));

-- name: definer_functions_without_search_path
select n.nspname || '.' || p.proname as violation
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('app', 'aarogyam', 'audit', 'private') and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg = 'search_path=""');

-- name: clinic_tables_without_org_id_first_in_primary_key
select c.relname as violation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_constraint k on k.conrelid = c.oid and k.contype = 'p'
where n.nspname = 'aarogyam' and c.relkind in ('r', 'p')
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
  and c.relname not in ('org_domains')
  and (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum = k.conkey[1]) <> 'org_id';

-- name: unique_keys_without_org_id_first
select c.relname || '.' || i.relname as violation
from pg_index x
join pg_class i on i.oid = x.indexrelid
join pg_class c on c.oid = x.indrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'aarogyam' and x.indisunique and not x.indisprimary
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
  and c.relname not in ('org_domains')
  and (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum = x.indkey[0]) is distinct from 'org_id';

-- name: foreign_keys_to_clinic_tables_without_org_id
-- A key into a clinic table must include org_id, or it could point at another clinic's row.
select c.relname || '.' || k.conname as violation
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_class r on r.oid = k.confrelid
join pg_namespace n on n.oid = c.relnamespace
where k.contype = 'f' and n.nspname = 'aarogyam'
  and exists (select 1 from pg_attribute a where a.attrelid = r.oid and a.attname = 'org_id' and not a.attisdropped)
  and r.relname not in ('org_domains')
  and not exists (select 1 from unnest(k.confkey) col
                  join pg_attribute a on a.attrelid = r.oid and a.attnum = col where a.attname = 'org_id');

-- name: foreign_keys_without_index
select c.relname || '.' || k.conname as violation
from pg_constraint k
join pg_class c on c.oid = k.conrelid
join pg_namespace n on n.oid = c.relnamespace
where k.contype = 'f' and n.nspname in ('aarogyam', 'audit')
  and not exists (
    select 1 from pg_index x
    where x.indrelid = c.oid
      and (x.indkey::int2[])[0:cardinality(k.conkey) - 1] @> k.conkey
      and (x.indkey::int2[])[0:cardinality(k.conkey) - 1] <@ k.conkey);

-- name: clinic_tables_without_tenant_policy
select c.relname as violation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'aarogyam' and c.relkind in ('r', 'p')
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
  and c.relname not in ('org_domains')
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                  and pg_get_expr(p.polqual, p.polrelid) like '%org_id = ( SELECT app.tenant_id()%');

-- name: tables_without_audit_trigger
select n.nspname || '.' || c.relname as violation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'aarogyam' and c.relkind in ('r', 'p') and not c.relispartition
  and c.relname not in ('number_sequences')
  and not exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
                  where t.tgrelid = c.oid and f.proname = 'audit_row' and not t.tgisinternal);

-- name: log_tables_with_foreign_keys
select c.relname || '.' || k.conname as violation
from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'audit' and k.contype = 'f';

-- name: delete_granted_on_non_ephemeral_tables
select table_schema || '.' || table_name as violation
from information_schema.role_table_grants g
where grantee = 'app_user' and privilege_type = 'DELETE'
  and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = g.table_schema and c.relname = g.table_name
                    and obj_description(c.oid, 'pg_class') like '%lifecycle=ephemeral%');

-- name: tables_without_classification
select n.nspname || '.' || c.relname as violation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('aarogyam', 'audit') and c.relkind in ('r', 'p') and not c.relispartition
  and coalesce(obj_description(c.oid, 'pg_class'), '') !~ 'sensitivity=\w+ offline=\w+ lifecycle=\w+';

-- name: api_login_with_table_privileges
select table_schema || '.' || table_name as violation
from information_schema.role_table_grants
where grantee = 'aarogyam_api';

-- name: clinic_tables_without_patient_policy
-- Every clinic table decides what a patient account may read (0261): a restrictive policy named
-- patient_account, deny-all unless a migration opens the table on purpose.
select c.relname as violation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'aarogyam' and c.relkind in ('r', 'p') and not c.relispartition
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid
                  and p.polname = 'patient_account' and not p.polpermissive);
