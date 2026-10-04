#!/usr/bin/env bash
# Builds and deploys the clinic portal and Sakalya console to Cloudflare Workers, pointed at
# <api-origin> (a scripts/tunnel-up.sh tunnel today, a Cloud Run URL later). Reads credentials
# from git-ignored .env files and never echoes their values.
#
# Usage: scripts/deploy-workers.sh <api-origin>
#   DEMO_DEV_SIGNIN=1 scripts/deploy-workers.sh <api-origin>   # skip Supabase; use the API's
#                                                               # dev-token sign-in (local API,
#                                                               # ARO_ENVIRONMENT=local, only)
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <api-origin>" >&2
  exit 1
fi
API_ORIGIN="$1"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

require_file() {
  if [ ! -f "$1" ]; then
    echo "Missing $1. $2" >&2
    exit 1
  fi
}

# --- Cloudflare API credentials ---
require_file .env.cloudflare "Create it (git-ignored) with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."
set -a
# shellcheck disable=SC1091
. ./.env.cloudflare
set +a
: "${CLOUDFLARE_API_TOKEN:?missing in .env.cloudflare}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing in .env.cloudflare}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# --- Edge secret: generated once, reused on every redeploy ---
if [ ! -f .env.edge ]; then
  echo "No .env.edge yet; generating EDGE_SECRET (git-ignored, keep it)."
  echo "EDGE_SECRET=$(openssl rand -hex 32)" >.env.edge
  chmod 600 .env.edge
fi
set -a
# shellcheck disable=SC1091
. ./.env.edge
set +a
: "${EDGE_SECRET:?missing in .env.edge}"

# --- Supabase build-time vars, unless this is a dev-sign-in demo ---
VITE_SUPABASE_URL=""
VITE_SUPABASE_ANON_KEY=""
if [ "${DEMO_DEV_SIGNIN:-0}" = "1" ]; then
  echo "DEMO_DEV_SIGNIN=1: building without Supabase vars (dev-token sign-in against the local API)."
else
  require_file .env.supabase "Create it (git-ignored) with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or set DEMO_DEV_SIGNIN=1."
  set -a
  # shellcheck disable=SC1091
  . ./.env.supabase
  set +a
  : "${VITE_SUPABASE_URL:?missing in .env.supabase}"
  : "${VITE_SUPABASE_ANON_KEY:?missing in .env.supabase}"
fi

deploy_app() {
  local app_dir="$1" worker_dir="$2" worker_name="$3"

  echo ""
  echo "== ${worker_name}: pnpm build =="
  (
    cd "$app_dir"
    VITE_API_MODE=http \
    VITE_API_BASE_URL="" \
    VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
    VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
      pnpm build
  )

  echo "== ${worker_name}: setting EDGE_SECRET =="
  (cd "$worker_dir" && printf '%s' "$EDGE_SECRET" | npx wrangler secret put EDGE_SECRET)

  echo "== ${worker_name}: deploying =="
  (cd "$worker_dir" && npx wrangler deploy --var "API_ORIGIN:${API_ORIGIN}")
}

deploy_app "web/apps/portal" "deploy/cloudflare/portal" "aarogyam-portal"
deploy_app "web/apps/console" "deploy/cloudflare/console" "aarogyam-console"

echo ""
echo "Deployed. API origin: ${API_ORIGIN}"
echo "  Portal:  https://aarogyam-portal.aarogyam.workers.dev"
echo "  Console: https://aarogyam-console.aarogyam.workers.dev"
