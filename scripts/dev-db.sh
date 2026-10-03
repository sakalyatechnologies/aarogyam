#!/bin/sh
# Sets up a local Postgres shaped like Supabase, so permission problems show up locally:
#   aarogyam_owner   plays Supabase's `postgres`: not a superuser, creates roles and
#                    databases, bypasses row-level security, owns every object
#   aarogyam_dev     the development database, owned by aarogyam_owner
# Migrations run as aarogyam_owner; the API connects as aarogyam_api (created by migrations).
# Safe to run again. Usage: scripts/dev-db.sh [--seed]
set -eu
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
ADMIN_URL="${ADMIN_URL:-postgres://localhost:5432/postgres}"
DB="${DB:-aarogyam_dev}"

psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin create role aarogyam_owner login createrole createdb bypassrls;
exception when duplicate_object then null; end $$;
-- Roles created earlier by another role: give the owner ADMIN on them, as on Supabase.
do $$ declare r text; begin
  foreach r in array array['app_user', 'aarogyam_api'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('grant %I to aarogyam_owner with admin true, inherit false, set false', r);
    end if;
  end loop;
end $$;
-- Supabase's Data API roles, so tests can prove they get nothing.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
SQL

if ! psql "$ADMIN_URL" -Atc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
  createdb -h localhost -O aarogyam_owner "$DB"
fi
echo "database $DB ready: migrate with ARO_DB__OWNER_URL=postgres://aarogyam_owner@localhost:5432/$DB"

if [ "${1:-}" = "--seed" ]; then
  psql "postgres://aarogyam_owner@localhost:5432/$DB" -q -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../db/seed/local.sql"
  echo "seeded two synthetic clinics: sunrise.localtest.me and lotus.localtest.me"
fi
