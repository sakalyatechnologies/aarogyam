#!/bin/sh
# Moves the demo clinics' dated activity (appointments, visits, queue, bills, receipts, recalls, stock
# expiry, prescriptions) forward by whole weeks so Today, the calendar and billing centre on today,
# then tops up synthetic expenses for the last twelve months (scripts/demo-expenses.sql) so
# Billing → Expenses and Analytics have money to show.
# Only the clinics sunrise, lotus and suhasyadental; never deletes; each step is one transaction; shift 0 = no-op.
# Usage: scripts/demo-refresh.sh [--apply] [--exact] [--appointments-only]
#   default   dry run: shows what would move, then rolls back
#   --apply   commit the change
#   --exact   shift by exactly the days to today (latest appointment day lands on today) instead of
#             whole weeks, which keep every appointment on its weekday
#   --appointments-only  shift only appointments and queue tokens, leave invoices and payments as-is,
#             and add no expenses
# Connects as the owner: ARO_DB__OWNER_URL, else DB_OWNER_URL (from .env.supabase).
set -eu
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
apply=0; exact=0; appointments_only=0
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    --dry-run) apply=0 ;;
    --exact) exact=1 ;;
    --appointments-only) appointments_only=1 ;;
    *) echo "usage: $0 [--dry-run|--apply] [--exact] [--appointments-only]" >&2; exit 2 ;;
  esac
done
url="${ARO_DB__OWNER_URL:-${DB_OWNER_URL:-}}"
if [ -z "$url" ]; then
  echo "set ARO_DB__OWNER_URL (or DB_OWNER_URL) to the owner connection URL" >&2; exit 1
fi
psql "$url" -q -v ON_ERROR_STOP=1 -v apply="$apply" -v exact="$exact" -v appointments_only="$appointments_only" -f "$(dirname "$0")/../db/seed/demo-refresh.sql"
if [ "$appointments_only" -eq 0 ]; then
  exec psql "$url" -q -v ON_ERROR_STOP=1 -v apply="$apply" -f "$(dirname "$0")/demo-expenses.sql"
fi
