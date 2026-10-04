#!/usr/bin/env bash
# Runs the demo API on this machine against the Supabase database, behind the Cloudflare
# Workers (scripts/deploy-workers.sh) and a quick tunnel (scripts/tunnel-up.sh), plus the
# outbox sender. Until Cloud Run, this is the demo backend. Reads credentials from the
# git-ignored .env.supabase, .env.edge and .env.cloudflare and never echoes their values.
#
# Usage: scripts/demo-api.sh            # API on 127.0.0.1:8095 and `outbox drain --every 15`
#        DEMO_PORT=8096 scripts/demo-api.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

for file in .env.supabase .env.edge .env.cloudflare; do
  if [ ! -f "$file" ]; then
    echo "Missing $file (see docs/deploy.md)." >&2
    exit 1
  fi
done
set -a
# shellcheck disable=SC1091
. ./.env.supabase
# shellcheck disable=SC1091
. ./.env.edge
# shellcheck disable=SC1091
. ./.env.cloudflare
set +a
: "${ARO_DB__URL:?missing in .env.supabase}"
: "${ARO_DB__OWNER_URL:?missing in .env.supabase}"
: "${SUPABASE_URL:?missing in .env.supabase}"
: "${SUPABASE_SECRET_KEY:?missing in .env.supabase}"
: "${EDGE_SECRET:?missing in .env.edge}"
: "${CLOUDFLARE_WORKERS_SUBDOMAIN:?missing in .env.cloudflare}"

WORKERS="${CLOUDFLARE_WORKERS_SUBDOMAIN}.workers.dev"
export SUPABASE_URL SUPABASE_SECRET_KEY ARO_DB__URL ARO_DB__OWNER_URL
export ARO_HTTP__BIND="127.0.0.1:${DEMO_PORT:-8095}"
export ARO_HTTP__EDGE_SECRET="$EDGE_SECRET"
export ARO_AUTH__MODE=supabase
export ARO_AUTH__DEV_TOKENS=false
# One portal Worker per clinic (workers.dev has no wildcard subdomains); the landing page and
# sign-in live on aarogyam-portal, which belongs to no clinic.
export ARO_HOSTS__PORTAL_HOST_TEMPLATE="{slug}-aarogyam.${WORKERS}"
export ARO_HOSTS__APP="aarogyam-portal.${WORKERS}"
export ARO_HOSTS__CONSOLE="aarogyam-console.${WORKERS}"
export ARO_EMAIL__PORTAL_LINK="https://{host}"
if [ -n "${RESEND_API_KEY:-}" ]; then
  export ARO_EMAIL__RESEND_API_KEY="$RESEND_API_KEY"
  export ARO_EMAIL__FROM="${ARO_EMAIL__FROM:-Aarogyam <noreply@aarogyam.sakalyatechnologies.com>}"
fi

BIN=./target/debug/aarogyam
if [ ! -x "$BIN" ]; then
  echo "Build first: cargo build -p aarogyam-server" >&2
  exit 1
fi

"$BIN" outbox drain --every 15 &
DRAIN=$!
trap 'kill "$DRAIN" 2>/dev/null || true' EXIT
"$BIN" serve
