#!/usr/bin/env bash
# Tests for the operations scripts, with no cloud access: syntax, shellcheck, and dry runs
# against a fake `gcloud` that records every call and fails every read, so the plan is printed
# as if nothing existed yet. Fails if a dry run runs anything that changes a project.
#
# Usage: scripts/ops-selftest.sh
# Optional, with a migrated local database: OPS_SELFTEST_DB_URL=postgres://owner@localhost/db
#   scripts/ops-selftest.sh   also runs backup.sh locally and restores it with the drill.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FAILED=0
# run <description> <command...>: passes when the command succeeds. run_fails: when it fails.
run() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else bad "$d"; fi; }
run_fails() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then bad "$d"; else ok "$d"; fi; }
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
expect() { # description output pattern
  if grep -qE -- "$3" <<<"$2"; then ok "$1"; else bad "$1 (no match for: $3)"; fi
}

SCRIPTS=(scripts/ops-setup.sh scripts/restore-drill.sh scripts/ops-selftest.sh scripts/cloud-run-common.sh)
echo "== syntax"
for s in "${SCRIPTS[@]}"; do run "bash -n $s" bash -n "$s"; done
run "sh -n deploy/backup/backup.sh" sh -n deploy/backup/backup.sh
if command -v shellcheck >/dev/null; then
  run "shellcheck scripts" shellcheck -x "${SCRIPTS[@]}"
  run "shellcheck backup.sh" shellcheck -s sh deploy/backup/backup.sh
else
  echo "  skip  shellcheck is not installed"
fi

echo "== dry runs (fake gcloud)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/bin"
cat >"$TMP/bin/gcloud" <<'FAKE'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_GCLOUD_LOG"
case "$*" in
  "config get-value account") echo founder@example.com ;;
  "config get-value project") echo test-project ;;
  *) exit 1 ;;   # every read says "not found"; every write would be a bug in a dry run
esac
FAKE
chmod +x "$TMP/bin/gcloud"
export FAKE_GCLOUD_LOG="$TMP/gcloud.log"
: >"$FAKE_GCLOUD_LOG"

OUT="$(PATH="$TMP/bin:$PATH" PROJECT_ID=test-project UPTIME_CLINIC_HOST=clinic.example.workers.dev scripts/ops-setup.sh 2>&1)" || bad "ops-setup dry run exits 0"
expect "ops-setup says dry run" "$OUT" "DRY RUN"
expect "ops-setup plans the bucket in asia-south1" "$OUT" "storage buckets create gs://aarogyam-backups-test-project.*--location asia-south1"
expect "ops-setup plans the lifecycle rules" "$OUT" "buckets update .*--lifecycle-file"
expect "ops-setup keeps 14 daily and 8 weekly" "$OUT" "daily/   deleted after 14 days"
expect "ops-setup plans a least-privilege backup account" "$OUT" "objectCreator"
expect "ops-setup plans the schedule" "$OUT" "scheduler jobs create http aarogyam-backup .*--schedule 30 20"
expect "ops-setup plans the clinic uptime check on the health route" "$OUT" "/api/v1/health"
expect "ops-setup plans five minute checks" "$OUT" "\"period\": \"300s\""
expect "ops-setup plans alert policies" "$OUT" "create alertPolicies 'Aarogyam API: Cloud Run 5xx'"
expect "ops-setup flags what could cost money" "$OUT" "not free"
if grep -vE '^(config get-value|auth print-access-token|auth list|projects describe|storage buckets describe|iam service-accounts describe|artifacts docker images describe|scheduler jobs describe|logging metrics describe|secrets describe)' "$FAKE_GCLOUD_LOG" | grep -q .; then
  bad "ops-setup dry run only reads from gcloud: $(grep -vE '^(config|auth|projects|storage buckets describe|iam service-accounts describe|artifacts|scheduler jobs describe|logging metrics describe|secrets describe)' "$FAKE_GCLOUD_LOG" | head -n 3)"
else
  ok "ops-setup dry run only reads from gcloud"
fi
OUT="$(PATH="$TMP/bin:$PATH" PROJECT_ID=test-project scripts/ops-setup.sh --yes --dry-run 2>&1)" || true
expect "--dry-run wins over --yes" "$OUT" "DRY RUN"

OUT="$(PATH="$TMP/bin:$PATH" PROJECT_ID=test-project scripts/restore-drill.sh 2>&1)" || bad "restore-drill dry run exits 0"
expect "restore-drill dry run prints the plan" "$OUT" "DRY RUN"
expect "restore-drill reads the newest daily dump" "$OUT" "newest gs://aarogyam-backups-test-project/daily/"
PROD_HOST="$(sed -nE "s#^[[:space:]]*ARO_DB__OWNER_URL=['\"]?[a-z]+://([^@/]*@)?([^:/?'\"]+).*#\2#p" .env.supabase 2>/dev/null | tail -n 1 || true)"
if [ -n "$PROD_HOST" ]; then
  OUT="$(scripts/restore-drill.sh --scratch-url "postgres://x@${PROD_HOST}:5432/postgres" 2>&1 || true)"
  expect "restore-drill refuses the production host" "$OUT" "refusing"
else
  echo "  skip  no .env.supabase here, so the production-host refusal is not exercised"
fi

if [ -n "${OPS_SELFTEST_DB_URL:-}" ]; then
  echo "== backup and restore against $OPS_SELFTEST_DB_URL"
  ADMIN="$(sed -E 's#^([a-z]+://[^/]*)/.*#\1/postgres#' <<<"$OPS_SELFTEST_DB_URL")"
  run "backup.sh writes a readable dump" env DB_URL="$OPS_SELFTEST_DB_URL" BACKUP_UPLOAD=0 OUT_DIR="$TMP" deploy/backup/backup.sh
  OUT="$(scripts/restore-drill.sh --yes --file "$TMP"/aarogyam-*.dump --scratch-url "$ADMIN" 2>&1)" || bad "drill passes on a fresh dump"
  expect "drill reports PASS" "$OUT" "RESULT: PASS"
  head -c 2000 "$TMP"/aarogyam-*.dump >"$TMP/aarogyam-20200101T000000Z.dump"
  run_fails "drill fails on a truncated dump" scripts/restore-drill.sh --yes --file "$TMP/aarogyam-20200101T000000Z.dump" --scratch-url "$ADMIN"
fi

echo
if [ "$FAILED" = 0 ]; then echo "ops-selftest: all passed"; else echo "ops-selftest: $FAILED failed"; exit 1; fi
