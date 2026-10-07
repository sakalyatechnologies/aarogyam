#!/usr/bin/env bash
# Restore drill: proves the latest backup can be restored, and measures how long it takes.
# Downloads the newest dump from the backup bucket (or uses --file), restores it into a
# throwaway database on a SCRATCH server, runs row counts and smoke queries, prints a report and
# drops the database. It never touches production: it refuses the owner URL in .env.supabase,
# and the only thing it reads from the cloud is the dump. See docs/ops.md "Backups".
#
# DRY RUN BY DEFAULT: prints what it would do. Add --yes to run.
#
# Usage:  scripts/restore-drill.sh [--yes] [--file <dump>] [--scratch-url <url>] [--keep]
#   --file <dump>        restore this local file instead of downloading the newest daily dump
#   --scratch-url <url>  admin URL of the scratch server: your local Postgres (default
#                        postgres://localhost:5432/postgres) or a Supabase branch database.
#                        A database named aarogyam_drill_<time> is created there.
#   --keep               keep the scratch database afterwards (its name is printed)
#   --weekly             use the newest weekly dump instead of the newest daily one
# Environment: PROJECT_ID (or the gcloud default project), BACKUP_BUCKET (default
#   aarogyam-backups-<project id>). Needs pg_restore and psql, version 17 or newer, on PATH.
# Exit status: 0 only when every check passed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
# shellcheck source=scripts/cloud-run-common.sh
. scripts/cloud-run-common.sh

APPLY=0
KEEP=0
FILE=""
PREFIX="daily"
SCRATCH_URL="postgres://localhost:5432/postgres"
while [ $# -gt 0 ]; do
  case "$1" in
    --yes | -y) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --keep) KEEP=1 ;;
    --weekly) PREFIX="weekly" ;;
    --file) FILE="${2:?--file needs a path}"; shift ;;
    --scratch-url) SCRATCH_URL="${2:?--scratch-url needs a URL}"; shift ;;
    -h | --help) sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

SCHEMAS="aarogyam audit private app"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRILL_DB="aarogyam_drill_$(date -u +%Y%m%d%H%M%S)"
host_of() { sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#' <<<"$1"; }
SCRATCH_HOST="$(host_of "$SCRATCH_URL")"

# Never restore onto the production database host.
PROD_URL="$(env_value .env.supabase ARO_DB__OWNER_URL)"
if [ -n "$PROD_URL" ] && [ "$(host_of "$PROD_URL")" = "$SCRATCH_HOST" ]; then
  die "refusing: $SCRATCH_HOST is the production database host. Use a local server or a Supabase branch."
fi

if [ -z "$FILE" ]; then
  PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
  [ -n "$PROJECT_ID" ] || die "set PROJECT_ID=<your project id>, or pass --file"
  BACKUP_BUCKET="${BACKUP_BUCKET:-aarogyam-backups-${PROJECT_ID}}"
  SOURCE="newest gs://${BACKUP_BUCKET}/${PREFIX}/ dump"
else
  SOURCE="$FILE"
fi

cat <<PLAN
Restore drill ($([ "$APPLY" = 1 ] && echo RUNNING || echo "DRY RUN: add --yes to run"))
  1. Dump:     $SOURCE
  2. Scratch:  create database $DRILL_DB on $SCRATCH_HOST (never production)
  3. Prepare:  schema 'extensions' with btree_gist, btree_gin, pg_trgm; roles the dump grants to
  4. Restore:  pg_restore --no-owner --no-privileges --exit-on-error (schemas: $SCHEMAS)
  5. Check:    row counts of every table, migration ledger vs db/migrations, policies, a join smoke query
  6. Report:   PASS or FAIL, dump age (RPO), restore time (RTO), then $([ "$KEEP" = 1 ] && echo "keep" || echo "drop") the scratch database
PLAN
[ "$APPLY" = 1 ] || exit 0

command -v pg_restore >/dev/null || die "pg_restore not found (brew install postgresql@17)"
command -v psql >/dev/null || die "psql not found"
WORK="$(mktemp -d)"
cleanup() {
  if [ "$KEEP" != 1 ]; then psql "$SCRATCH_URL" -qAtc "drop database if exists ${DRILL_DB} with (force)" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

START="$(date +%s)"
# ---- 1. Fetch -----------------------------------------------------------------------------
if [ -z "$FILE" ]; then
  command -v gcloud >/dev/null || die "gcloud is not installed"
  LATEST="$(gcloud storage ls "gs://${BACKUP_BUCKET}/${PREFIX}/" --project "$PROJECT_ID" | sort | tail -n 1)"
  [ -n "$LATEST" ] || die "no dumps under gs://${BACKUP_BUCKET}/${PREFIX}/ (has the backup job run?)"
  FILE="$WORK/latest.dump"
  gcloud storage cp "$LATEST" "$FILE" --project "$PROJECT_ID" >/dev/null
  SOURCE="$LATEST"
fi
[ -s "$FILE" ] || die "dump $FILE is missing or empty"
NAME="$(basename "$SOURCE")"
DUMP_TIME="$(sed -En 's/.*aarogyam-([0-9]{8}T[0-9]{6}Z)\.dump$/\1/p' <<<"$NAME")"
AGE_HOURS="unknown"
if [ -n "$DUMP_TIME" ]; then
  DUMP_EPOCH="$(date -u -j -f '%Y%m%dT%H%M%SZ' "$DUMP_TIME" +%s 2>/dev/null || date -u -d "${DUMP_TIME:0:8} ${DUMP_TIME:9:2}:${DUMP_TIME:11:2}:${DUMP_TIME:13:2}" +%s)"
  AGE_HOURS="$(( ($(date +%s) - DUMP_EPOCH) / 3600 ))"
fi
BYTES="$(wc -c <"$FILE" | tr -d ' ')"
FETCHED="$(date +%s)"

# ---- 2 and 3. Scratch database, prerequisites ---------------------------------------------
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -qAtc "create database ${DRILL_DB}" >/dev/null
# Swap the database name in the URL (path component before any '?').
DRILL_URL="$(sed -E "s#^([a-z]+://[^/]*)/[^?]*#\\1/${DRILL_DB}#" <<<"$SCRATCH_URL")"
psql "$DRILL_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<'SQL'
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists btree_gin with schema extensions;
create extension if not exists pg_trgm with schema extensions;
SQL
# Roles the dump refers to (policies, grants): create any that are missing, as nologin stubs.
pg_restore --schema-only --no-owner -f "$WORK/schema.sql" "$FILE" \
  || die "RESULT: FAIL: the dump cannot be read (truncated or corrupt): $NAME"
grep -oE '\bTO [a-z_][a-z0-9_]*' "$WORK/schema.sql" | awk '{print $2}' | sort -u \
  | grep -vxE 'public|current_user|session_user|current_role' >"$WORK/roles.txt" || true
while read -r role; do
  [ -n "$role" ] || continue
  psql "$SCRATCH_URL" -qAtc "do \$\$ begin create role ${role} nologin; exception when duplicate_object then null; end \$\$" >/dev/null
done <"$WORK/roles.txt"

# ---- 4. Restore ---------------------------------------------------------------------------
RESTORE_OK=1
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$DRILL_URL" "$FILE" 2>"$WORK/restore.err" || RESTORE_OK=0
DONE="$(date +%s)"

# ---- 5. Checks ----------------------------------------------------------------------------
FAILS=0
check() { # name ok(0/1) detail
  if [ "$2" = 1 ]; then printf '  PASS  %s %s\n' "$1" "$3"; else printf '  FAIL  %s %s\n' "$1" "$3"; FAILS=$((FAILS + 1)); fi
}
q() { psql "$DRILL_URL" -v ON_ERROR_STOP=1 -qAt -c "$1"; }

echo
echo "== Restore drill report ($STAMP)"
echo "  dump:    $NAME  ($BYTES bytes)"
echo "  age:     ${AGE_HOURS} hours at restore (24 hours is the design RPO; more means a missed night)"
echo "  restore: $((DONE - FETCHED)) seconds restore, $((DONE - START)) seconds in all (this is the RTO measurement for this size)"
if [ "$RESTORE_OK" != 1 ]; then
  check "pg_restore" 0 "failed; first error: $(head -n 3 "$WORK/restore.err" | tr '\n' ' ')"
else
  check "pg_restore" 1 ""
  TABLES="$(q "select count(*) from pg_tables where schemaname in ('aarogyam','audit','private')")"
  check "tables restored" "$([ "$TABLES" -gt 0 ] && echo 1 || echo 0)" "($TABLES tables)"
  echo "  row counts:"
  TOTAL=0
  while IFS='|' read -r t; do
    n="$(q "select count(*) from ${t}")"
    TOTAL=$((TOTAL + n))
    printf '    %-48s %s\n' "$t" "$n"
  done < <(q "select format('%I.%I', schemaname, tablename) from pg_tables where schemaname in ('aarogyam','audit','private') order by 1")
  echo "    total rows: $TOTAL"
  ORGS="$(q "select count(*) from aarogyam.organizations")"
  check "organizations present" "$([ "$ORGS" -gt 0 ] && echo 1 || echo 0)" "($ORGS)"
  ORPHANS="$(q "select count(*) from aarogyam.patients p left join aarogyam.organizations o on o.id = p.org_id where o.id is null")"
  check "smoke: every patient belongs to an organization" "$([ "$ORPHANS" = 0 ] && echo 1 || echo 0)" "($ORPHANS orphans)"
  POLICIES="$(q "select count(*) from pg_policies where schemaname = 'aarogyam'")"
  RLS_OFF="$(q "select count(*) from pg_tables t join pg_class c on c.relname = t.tablename join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname where t.schemaname = 'aarogyam' and not c.relrowsecurity")"
  check "row-level security restored" "$([ "$POLICIES" -gt 0 ] && echo 1 || echo 0)" "($POLICIES policies, $RLS_OFF tables without RLS: compare with docs/database.md)"
  LEDGER="$(q "select count(*) from private._sqlx_migrations")"
  FILES="$(find db/migrations -name '*.sql' 2>/dev/null | wc -l | tr -d ' ')"
  check "migration ledger" "$([ "$LEDGER" -gt 0 ] && [ "$LEDGER" -le "$FILES" ] && echo 1 || echo 0)" "(dump has $LEDGER; this checkout has $FILES migration files)"
fi
[ "$AGE_HOURS" != unknown ] && [ "$AGE_HOURS" -gt 30 ] && check "backup freshness" 0 "(${AGE_HOURS} hours old)"
echo
if [ "$FAILS" = 0 ]; then echo "RESULT: PASS"; else echo "RESULT: FAIL ($FAILS checks)"; fi
[ "$KEEP" = 1 ] && echo "scratch database kept: $DRILL_DB on $SCRATCH_HOST"
[ "$FAILS" = 0 ]
