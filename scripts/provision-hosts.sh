#!/usr/bin/env bash
# Gives every existing clinic (or one) its portal address on workers.dev: queues the clinics'
# portal hosts again and runs the provisioning once, the same code the outbox job runs for new
# clinics. Run it once after deploying migration 0160, to replace hand-deployed clinic Workers
# with the small forwarding ones, or after fixing a failed address. Safe to re-run: uploading a
# Worker and turning on its address are idempotent. See docs/deploy.md "Clinic addresses".
#
# Reads the git-ignored .env.cloudflare (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
# CLOUDFLARE_WORKERS_SUBDOMAIN) and .env.supabase (ARO_DB__URL) and never echoes their values.
#
# Usage: scripts/provision-hosts.sh [--clinic <slug>] [--yes]
#   --clinic <slug>   only this clinic
#   --yes             skip the confirmation prompt
# The same from Cloud Run, with the job's own secrets instead of this Mac's files:
#   gcloud run jobs execute aarogyam-outbox --region asia-south1 --args outbox,addresses
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLINIC=""
ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --clinic) CLINIC="${2:?--clinic needs a slug}"; shift 2 ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    -h | --help) sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

for file in .env.cloudflare .env.supabase; do
  [ -f "$file" ] || { echo "Missing $file (see docs/deploy.md)." >&2; exit 1; }
done
set -a
# shellcheck disable=SC1091
. ./.env.cloudflare
# shellcheck disable=SC1091
. ./.env.supabase
set +a
: "${CLOUDFLARE_API_TOKEN:?missing in .env.cloudflare}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing in .env.cloudflare}"
: "${CLOUDFLARE_WORKERS_SUBDOMAIN:?missing in .env.cloudflare}"
: "${ARO_DB__URL:?missing in .env.supabase}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_WORKERS_SUBDOMAIN ARO_DB__URL
export ARO_EDGE__HOSTS=workers_dev

BIN=./target/debug/aarogyam
if [ ! -x "$BIN" ]; then
  echo "Build first: cargo build -p aarogyam-server" >&2
  exit 1
fi

cat <<PLAN
Will upload a forwarding Worker named <slug>-aarogyam (to aarogyam-portal) and turn on
<slug>-aarogyam.${CLOUDFLARE_WORKERS_SUBDOMAIN}.workers.dev for $([ -n "$CLINIC" ] && echo "clinic '$CLINIC'" || echo "every clinic").
Existing Workers with those names are replaced. The console shows each address's status.
PLAN
if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "Proceed? [y/N] " answer
  case "$answer" in y | Y | yes | YES) ;; *) echo "Cancelled."; exit 1 ;; esac
fi

if [ -n "$CLINIC" ]; then
  "$BIN" outbox addresses --clinic "$CLINIC"
else
  "$BIN" outbox addresses
fi
