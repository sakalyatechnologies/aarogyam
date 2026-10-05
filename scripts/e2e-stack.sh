#!/bin/sh
# The isolated stack the end-to-end suite (web/e2e) runs against, beside a developer's dev stack:
#   database aarogyam_dev_e2e   (migrated and seeded on first start)
#   API      127.0.0.1:8181     (target/debug/aarogyam; throttle bypass token for the suite)
#   portal   :5273              (every clinic at http://<slug>.localtest.me:5273)
#   console  :5274              (http://console.localtest.me:5274)
# Logs and process ids go to var/e2e/ (git-ignored).
#
# Usage: scripts/e2e-stack.sh up | down | status | reset
#   up      builds the server if needed, prepares the database, starts what isn't running
#   down    stops the API and both dev servers
#   reset   down, drop the e2e database, up again (a clean slate; tests never need it)
set -eu
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"

DB="${E2E_DB:-aarogyam_dev_e2e}"
API_PORT="${E2E_API_PORT:-8181}"
PORTAL_PORT="${E2E_PORTAL_PORT:-5273}"
CONSOLE_PORT="${E2E_CONSOLE_PORT:-5274}"
BYPASS="${E2E_THROTTLE_BYPASS:-local-e2e-throttle-bypass-0123456789abcdef}"
RUN=var/e2e
mkdir -p "$RUN"

running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

stop() {
  for name in api portal console; do
    if running "$name"; then
      kill "$(cat "$RUN/$name.pid")" 2>/dev/null || true
      echo "stopped $name"
    fi
    rm -f "$RUN/$name.pid"
  done
  # The dev servers' shims can leave node behind: free the ports too.
  for port in "$API_PORT" "$PORTAL_PORT" "$CONSOLE_PORT"; do
    pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
}

wait_for() {
  label=$1 url=$2
  i=0
  until curl -fs -o /dev/null -m 2 "$url"; do
    i=$((i + 1))
    if [ "$i" -gt 120 ]; then
      echo "$label did not answer at $url; see $RUN/$label.log" >&2
      exit 1
    fi
    sleep 1
  done
}

start() {
  if ! psql "postgres://localhost:5432/postgres" -Atc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
    DB="$DB" scripts/dev-db.sh >/dev/null
    fresh=1
  fi
  [ -x target/debug/aarogyam ] || cargo build -p aarogyam-server
  ARO_DB__OWNER_URL="postgres://aarogyam_owner@localhost:5432/$DB" ARO_DB__URL="postgres://aarogyam_api@localhost:5432/$DB" \
    target/debug/aarogyam migrate >"$RUN/migrate.log" 2>&1 || { echo "migrations failed; see $RUN/migrate.log" >&2; exit 1; }
  if [ "${fresh:-0}" = 1 ]; then
    psql "postgres://aarogyam_owner@localhost:5432/$DB" -q -v ON_ERROR_STOP=1 -v "portal_host_template={slug}.localtest.me" -f db/seed/local.sql
  fi

  if ! running api; then
    ARO_HTTP__BIND="127.0.0.1:$API_PORT" \
      ARO_DB__URL="postgres://aarogyam_api@localhost:5432/$DB" \
      ARO_DB__OWNER_URL="postgres://aarogyam_owner@localhost:5432/$DB" \
      ARO_DB__MAX_CONNECTIONS=10 \
      ARO_EMAIL__PORTAL_LINK="http://{host}:$PORTAL_PORT" \
      ARO_THROTTLE__BYPASS_TOKEN="$BYPASS" \
      ARO_QUALITY__DIR=var/quality \
      ARO_TELEMETRY__FILTER="info,sqlx=warn" \
      nohup target/debug/aarogyam serve >"$RUN/api.log" 2>&1 &
    echo $! >"$RUN/api.pid"
  fi
  for app in portal console; do
    if ! running "$app"; then
      if [ "$app" = console ]; then port=$CONSOLE_PORT; else port=$PORTAL_PORT; fi
      (
        cd "web/apps/$app"
        VITE_API_MODE=http VITE_API_PROXY_TARGET="http://localhost:$API_PORT" \
          nohup ./node_modules/.bin/vite --port "$port" --strictPort >"../../../$RUN/$app.log" 2>&1 &
        echo $! >"../../../$RUN/$app.pid"
      )
    fi
  done
  wait_for api "http://localhost:$API_PORT/healthz"
  wait_for portal "http://app.localtest.me:$PORTAL_PORT/"
  wait_for console "http://console.localtest.me:$CONSOLE_PORT/"
  echo "e2e stack up: API :$API_PORT, portal :$PORTAL_PORT, console :$CONSOLE_PORT, database $DB"
}

case "${1:-}" in
  up) start ;;
  down) stop ;;
  status)
    for name in api portal console; do
      if running "$name"; then echo "$name running (pid $(cat "$RUN/$name.pid"))"; else echo "$name stopped"; fi
    done
    ;;
  reset)
    stop
    dropdb -h localhost --if-exists "$DB"
    start
    ;;
  *)
    echo "usage: scripts/e2e-stack.sh up | down | status | reset" >&2
    exit 2
    ;;
esac
