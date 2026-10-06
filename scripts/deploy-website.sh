#!/usr/bin/env bash
# Builds the public website (web/apps/website) and deploys it to the Cloudflare Pages project
# `aarogyam-website` (free tier). Credentials come from the git-ignored .env.cloudflare and are
# never echoed. Pages, not Workers, because a Pages custom domain works with DNS held elsewhere
# (a CNAME at GoDaddy); see docs/deploy.md "Public website".
#
# Usage: scripts/deploy-website.sh [api-origin]
#   api-origin  optional; connects the "Request access" form to the API (stored as the Pages
#               secrets API_ORIGIN and EDGE_SECRET). Omit to keep what is already set.
#   Build-time settings, read from the environment or git-ignored .env.supabase:
#     VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   sign-in (the same project the portal uses)
#     VITE_CONSOLE_URL   where Sakalya staff go (default: the console Worker on workers.dev)
#     VITE_API_BASE_URL  API origin for the browser (default empty: same origin, through the
#                        Pages Function; a cross-origin value needs CORS the API does not send)
set -euo pipefail

if [ $# -gt 1 ]; then
  echo "Usage: $0 [api-origin]" >&2
  exit 1
fi
API_ORIGIN="${1:-}"
PROJECT="aarogyam-website"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

[ -f .env.cloudflare ] || { echo "Missing .env.cloudflare (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)." >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. ./.env.cloudflare
set +a
: "${CLOUDFLARE_API_TOKEN:?missing in .env.cloudflare}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing in .env.cloudflare}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

SUBDOMAIN="${CLOUDFLARE_WORKERS_SUBDOMAIN:-<subdomain>}"
if [ -f .env.supabase ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.supabase
  set +a
fi
VITE_CONSOLE_URL="${VITE_CONSOLE_URL:-https://aarogyam-console.${SUBDOMAIN}.workers.dev/}"

echo "== website: pnpm build =="
(
  cd web/apps/website
  VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-}" \
  VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" \
  VITE_CONSOLE_URL="$VITE_CONSOLE_URL" \
  VITE_API_BASE_URL="${VITE_API_BASE_URL:-}" \
    pnpm build
)

cd deploy/cloudflare/website

# Create the project once; later runs find it and carry on.
if ! npx wrangler pages project list 2>/dev/null | grep -q "$PROJECT"; then
  echo "== website: creating Pages project ${PROJECT} =="
  npx wrangler pages project create "$PROJECT" --production-branch main
fi

if [ -n "$API_ORIGIN" ]; then
  [ -f "$REPO_ROOT/.env.edge" ] || { echo "Missing .env.edge; run scripts/deploy-workers.sh once first." >&2; exit 1; }
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env.edge"
  set +a
  : "${EDGE_SECRET:?missing in .env.edge}"
  echo "== website: setting API_ORIGIN and EDGE_SECRET =="
  printf '%s' "$API_ORIGIN" | npx wrangler pages secret put API_ORIGIN --project-name "$PROJECT"
  printf '%s' "$EDGE_SECRET" | npx wrangler pages secret put EDGE_SECRET --project-name "$PROJECT"
fi

echo "== website: deploying =="
npx wrangler pages deploy ../../../web/apps/website/dist/client --project-name "$PROJECT" --branch main --commit-dirty=true

# Wrangler has no custom-domain command, so use the API. Idempotent: an existing domain answers
# with an error we ignore. The domain only goes live once the CNAME exists at GoDaddy.
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-aarogyam.sakalyatechnologies.com}"
curl -s -X POST -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json" \
  --data "{\"name\":\"${CUSTOM_DOMAIN}\"}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}/domains" >/dev/null || true

echo ""
echo "Deployed https://${PROJECT}.pages.dev"
