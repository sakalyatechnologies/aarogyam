-- Schemas, extensions and default privileges.
--
-- Nothing is created in `public`: Supabase exposes that schema through its Data API.
--   aarogyam  product tables
--   audit     change history and access record
--   app       functions: settings helpers, triggers, lookups that run before the clinic is known
--   private   internal tables no application role can read
set local lock_timeout = '5s';

create schema if not exists extensions;
create schema if not exists app;
create schema if not exists aarogyam;
create schema if not exists audit;
create schema if not exists private;

-- Trusted extensions: a non-superuser owner (Supabase's `postgres`) can create them.
create extension if not exists btree_gist with schema extensions;
create extension if not exists btree_gin with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- New functions are not executable by everyone. Each function grants exactly what it needs.
alter default privileges revoke execute on functions from public;
