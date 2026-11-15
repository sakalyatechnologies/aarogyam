#!/bin/sh
# Records one quality run for the console's Quality dashboard: the Rust workspace's unit tests,
# its database tests (when Postgres answers locally), the web packages' vitest suite, and the
# Playwright golden-journey E2E suite (when the local dev stack is up). Writes one summary to
# var/quality/<run_id>.json (git-ignored). That directory is an operations store outside the
# patient database on purpose: nothing here is a clinical record, and once deployed it becomes a
# GCS bucket or BigQuery dataset instead of a server's local disk (see docs/handoff.md).
#
# Usage: scripts/quality-run.sh [environment]   (default: local)
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"

ENVIRONMENT="${1:-local}"
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
OUT_DIR="var/quality"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

ms_now() { python3 -c 'import time; print(int(time.time() * 1000))'; }

# Runs one suite, timed, logging its output to $WORK/<key>.cargo.log (or leaves it for the
# caller to write a different artifact). Never fails the script: a suite's own failures are
# recorded as data, not a reason to stop recording.
begin_suite() {
  key=$1 name=$2 kind=$3
  printf '%s' "$name" >"$WORK/$key.name"
  printf '%s' "$kind" >"$WORK/$key.kind"
  SUITE_START=$(ms_now)
}

end_suite() {
  key=$1
  echo "$(($(ms_now) - SUITE_START))" >"$WORK/$key.ms"
}

echo "== quality run $RUN_ID ($ENVIRONMENT) at commit $COMMIT =="

# 1. Rust unit tests: every workspace test except the database ones (#[ignore], run separately
# below), so a developer without Postgres still gets a suite.
begin_suite unit "aarogyam workspace (unit)" unit
cargo test --workspace --all-features >"$WORK/unit.cargo.log" 2>&1
end_suite unit

# 2. Rust database tests: only the #[ignore = "needs DATABASE_URL"] tests, only when Postgres
# answers locally (the same check the pre-commit hook makes).
begin_suite db "aarogyam workspace (database)" db
if command -v pg_isready >/dev/null 2>&1 && pg_isready -q -h localhost; then
  export DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/postgres}"
  cargo test --workspace --all-features -- --ignored >"$WORK/db.cargo.log" 2>&1
else
  echo "no Postgres on localhost: database tests were not run"
  ignored=$(cargo test --workspace --all-features -- --ignored --list 2>/dev/null | grep -c ': test$')
  printf '0 0 %s' "${ignored:-0}" >"$WORK/db.counts"
fi
end_suite db

# 3. The web packages' vitest suite (console, portal, api-client, app-kit).
begin_suite web "web packages (vitest)" web
if command -v pnpm >/dev/null 2>&1; then
  pnpm test --run --reporter=json --outputFile="$WORK/web.vitest.json" >"$WORK/web.stdout.log" 2>&1
else
  echo "pnpm not found: web tests were not run"
  printf '0 0 1' >"$WORK/web.counts"
fi
end_suite web

# 4. The Playwright end-to-end journeys (web/e2e), only against an already-running e2e stack
# (scripts/e2e-stack.sh up: API :8181, portal :5273, console :5274, its own database). It never
# starts that stack itself: recording a run must not be the thing that stands up an environment.
# The suite's own reporter (@sakalya/e2e's Quality reporter) writes the suite summary, with each
# test's status, retries and error, and marks tests that passed only on a retry as flaky.
begin_suite e2e "journeys (Playwright)" e2e
stack_up() {
  curl -fsS -o /dev/null -m 3 "${E2E_API_URL:-http://localhost:8181}/healthz" &&
    curl -fsS -o /dev/null -m 3 "${E2E_CONSOLE_URL:-http://console.localtest.me:5274}/" &&
    curl -fsS -o /dev/null -m 3 "http://app.localtest.me:${E2E_PORTAL_PORT:-5273}/"
}
if [ -d web/e2e ] && stack_up; then
  (cd web/e2e && SAKALYA_QUALITY_SUITE_FILE="$WORK/e2e.suite.json" GIT_COMMIT="$COMMIT" \
    SAKALYA_QUALITY_ENV="$ENVIRONMENT" npx playwright test) >"$WORK/e2e.stdout.log" 2>&1
else
  echo "the e2e stack isn't up (scripts/e2e-stack.sh up): E2E was not run"
  total=$(grep -ho '^test(' web/e2e/tests/*.spec.ts 2>/dev/null | wc -l | tr -d ' ')
  printf '0 0 %s' "${total:-0}" >"$WORK/e2e.counts"
fi
end_suite e2e

FINISHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p "$OUT_DIR"
python3 scripts/quality_report.py "$WORK" "$OUT_DIR" "$RUN_ID" "$STARTED_AT" "$FINISHED_AT" "$ENVIRONMENT" "$COMMIT"
