#!/bin/sh
# Moves the demo clinics' dated activity (appointments, visits, queue, bills, receipts, recalls, stock
# expiry, prescriptions) forward by whole weeks so Today, the calendar and billing centre on today.
# Only the clinics sunrise, lotus and suhasyadental; never deletes; one transaction; shift 0 = no-op.
# Usage: scripts/demo-refresh.sh [--apply] [--exact]
#   default   dry run: shows what would move, then rolls back
#   --apply   commit the change
#   --exact   shift by exactly the days to today (latest appointment day lands on today) instead of
#             whole weeks, which keep every appointment on its weekday
# Connects as the owner: ARO_DB__OWNER_URL, else DB_OWNER_URL (from .env.supabase).
set -eu
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
apply=0; exact=0
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    --dry-run) apply=0 ;;
    --exact) exact=1 ;;
    *) echo "usage: $0 [--dry-run|--apply] [--exact]" >&2; exit 2 ;;
  esac
done
url="${ARO_DB__OWNER_URL:-${DB_OWNER_URL:-}}"
if [ -z "$url" ]; then
  echo "set ARO_DB__OWNER_URL (or DB_OWNER_URL) to the owner connection URL" >&2; exit 1
fi
exec psql "$url" -q -v ON_ERROR_STOP=1 -v apply="$apply" -v exact="$exact" -f "$(dirname "$0")/../db/seed/demo-refresh.sql"
