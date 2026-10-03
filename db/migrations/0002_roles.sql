-- Database roles.
--
--   app_user      no login. Clinic transactions switch to it; row-level security applies.
--   aarogyam_api  the API's login. NOINHERIT and no table grants, so outside a clinic
--                 transaction it can only call the lookup functions in `app`.
--
-- Roles belong to the whole cluster, so they are created only when missing: several
-- databases (tests, branches) share them. Passwords are set outside migrations, per
-- environment: `alter role aarogyam_api password '…'`.
set local lock_timeout = '5s';

do $$
begin
  create role app_user nologin noinherit nobypassrls;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role aarogyam_api login noinherit nobypassrls;
exception when duplicate_object then null;
end $$;

-- SET without INHERIT (PostgreSQL 16+): the API may switch to app_user inside a
-- transaction, but holds none of its privileges until it does.
grant app_user to aarogyam_api with inherit false, set true;

-- Backstops; clinic transactions also set their own, shorter limits.
alter role aarogyam_api set statement_timeout = '15s';
alter role aarogyam_api set idle_in_transaction_session_timeout = '30s';
alter role aarogyam_api set lock_timeout = '5s';
-- Every statement names its schema, so an unqualified name fails instead of resolving somewhere unexpected.
alter role aarogyam_api set search_path = '';

grant usage on schema app, aarogyam, audit to app_user;
grant usage on schema app to aarogyam_api;
