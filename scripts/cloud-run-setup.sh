#!/usr/bin/env bash
# One-time (safe to re-run) Google Cloud setup for the Aarogyam API on Cloud Run, Mumbai
# (asia-south1), for a new project on the free trial. See docs/deploy.md "Cloud Run (free trial
# account)". Prints what it will do, then asks before changing anything.
#
# What it does: enables the APIs; creates an Artifact Registry repo (scanning off, keeps the
# last 3 images); creates three service accounts with only the roles they need; stores the
# secrets in Secret Manager, read from the git-ignored .env.supabase, .env.edge and
# .env.cloudflare (values are never printed); and creates a $1 budget with email alerts at 50%,
# 90% and 100%.
#
# Usage:  PROJECT_ID=<id> scripts/cloud-run-setup.sh [--yes] [--dry-run]
#   --dry-run     print every change instead of making it (reads are still made)
#   --yes         skip the confirmation prompt
# Optional: .env.github with SAKALYA_BACKEND_READ_TOKEN=<read-only GitHub token> (otherwise
#   you are asked for it, hidden). BUDGET_AMOUNT (default 1USD; use 85INR if your billing
#   account is in rupees). BUDGET_EMAILS is not needed: billing admins are emailed by default.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/cloud-run-common.sh
. scripts/cloud-run-common.sh
parse_common_flags "$@"
require_project
command -v gcloud >/dev/null || die "gcloud is not installed (https://cloud.google.com/sdk/docs/install)"
BUDGET_AMOUNT="${BUDGET_AMOUNT:-1USD}"

# ---- Read-only preflight ------------------------------------------------------------------
gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . \
  || die "not signed in: run 'gcloud auth login'"
gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 \
  || die "project '$PROJECT_ID' not found or no access"
BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)' 2>/dev/null || true)"
BILLING_ACCOUNT="${BILLING_ACCOUNT#billingAccounts/}"
[ -n "$BILLING_ACCOUNT" ] || die "project '$PROJECT_ID' has no billing account linked (Console > Billing > Link a billing account; the free trial counts)"

require_value() { # file key
  [ -f "$1" ] || die "missing $1 (see docs/deploy.md)"
  [ -n "$(env_value "$1" "$2")" ] || die "$2 is missing or empty in $1"
}
require_value .env.supabase ARO_DB__URL
require_value .env.supabase SUPABASE_URL
require_value .env.supabase SUPABASE_SECRET_KEY
require_value .env.edge EDGE_SECRET

GIT_TOKEN_SOURCE="existing secret"
if ! secret_exists "$SECRET_GIT_TOKEN"; then
  if [ -f .env.github ] && [ -n "$(env_value .env.github SAKALYA_BACKEND_READ_TOKEN)" ]; then
    GIT_TOKEN_SOURCE=".env.github"
  else
    GIT_TOKEN_SOURCE="hidden prompt"
  fi
fi
RESEND_SOURCE="not set (email is recorded as delivered and logged by id only)"
[ -n "$(env_value .env.supabase RESEND_API_KEY)" ] && RESEND_SOURCE=".env.supabase"
CLOUDFLARE_SOURCE="not set (new clinics' addresses stay pending until it is)"
[ -n "$(env_value .env.cloudflare CLOUDFLARE_API_TOKEN)" ] && CLOUDFLARE_SOURCE=".env.cloudflare CLOUDFLARE_API_TOKEN"

cat <<PLAN

Project:          $PROJECT_ID   (billing account $BILLING_ACCOUNT)
Region:           $REGION
Will do:
  1. Enable APIs: run, cloudbuild, artifactregistry, secretmanager, cloudscheduler,
     billingbudgets, iam
  2. Artifact Registry docker repo '$AR_REPO' in $REGION, scanning off, keep last 3 images
  3. Service accounts (least privilege):
       $RUN_SA_NAME    runs the API and the outbox job; reads only its own secrets
       $BUILD_SA_NAME  runs Cloud Build; writes images to '$AR_REPO', writes logs,
                       reads the build source and the GitHub token secret
       $SCHED_SA_NAME  lets Cloud Scheduler start the outbox job (role granted by the deploy script)
  4. Secrets in Secret Manager (values read from files, never printed):
       $SECRET_DB_URL, $SECRET_SUPABASE_KEY  <- .env.supabase
       $SECRET_EDGE            <- .env.edge
       $SECRET_FILES_KEY       <- generated once, never rotated by this script
       $SECRET_RESEND          <- $RESEND_SOURCE
       $SECRET_CLOUDFLARE       <- $CLOUDFLARE_SOURCE
                                  (Workers Scripts: Edit; mounted on the outbox job only)
       $SECRET_GIT_TOKEN       <- $GIT_TOKEN_SOURCE
  5. Budget '$BUDGET_AMOUNT' on this project, email alerts at 50%, 90%, 100%
     (an alert, not a cap: it cannot stop spending, only tell you)
Nothing is deployed and no service is created by this script.
PLAN
[ "$DRY_RUN" = "1" ] && echo "(dry run: changes are printed, not made)"
confirm "Proceed?"

# ---- 1. APIs ------------------------------------------------------------------------------
echo "== APIs"
mutate gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  billingbudgets.googleapis.com iam.googleapis.com --project "$PROJECT_ID"

# ---- 2. Artifact Registry -----------------------------------------------------------------
echo "== Artifact Registry"
if gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "  repo '$AR_REPO' exists"
else
  mutate gcloud artifacts repositories create "$AR_REPO" --repository-format=docker \
    --location "$REGION" --project "$PROJECT_ID" --disable-vulnerability-scanning \
    --description="Aarogyam container images"
fi
POLICY_FILE="$(mktemp)"
trap 'rm -f "$POLICY_FILE"' EXIT
cat >"$POLICY_FILE" <<'JSON'
[
  {"name": "keep-last-3", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 3}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"olderThan": "86400s"}}
]
JSON
mutate gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location "$REGION" \
  --project "$PROJECT_ID" --policy="$POLICY_FILE" --no-dry-run

# ---- 3. Service accounts ------------------------------------------------------------------
echo "== Service accounts"
ensure_sa() { # name display
  if gcloud iam service-accounts describe "$1@${PROJECT_ID}.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "  $1 exists"
  else
    mutate gcloud iam service-accounts create "$1" --display-name "$2" --project "$PROJECT_ID"
  fi
}
ensure_sa "$RUN_SA_NAME" "Aarogyam API runtime"
ensure_sa "$BUILD_SA_NAME" "Aarogyam Cloud Build"
ensure_sa "$SCHED_SA_NAME" "Aarogyam Cloud Scheduler"

# A new service account can take a few seconds to be visible to IAM.
[ "$DRY_RUN" = "1" ] || sleep 8

echo "== Build account roles"
for role in roles/logging.logWriter roles/storage.objectViewer; do
  mutate gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$BUILD_SA" \
    --role "$role" --condition=None --quiet >/dev/null
done
mutate gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" \
  --project "$PROJECT_ID" --member "serviceAccount:$BUILD_SA" --role roles/artifactregistry.writer --quiet >/dev/null

# ---- 4. Secrets ---------------------------------------------------------------------------
echo "== Secrets"
# Creates the secret, or adds a new version only when the value changed. $2 is never printed.
put_secret() { # name value
  local name="$1" value="$2"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] store secret $name (value hidden)"
    return 0
  fi
  if secret_exists "$name"; then
    if [ "$(gcloud secrets versions access latest --secret "$name" --project "$PROJECT_ID" 2>/dev/null || true)" = "$value" ]; then
      echo "  $name unchanged"
      return 0
    fi
    printf '%s' "$value" | gcloud secrets versions add "$name" --project "$PROJECT_ID" --data-file=- >/dev/null
    echo "  $name: new version"
  else
    printf '%s' "$value" | gcloud secrets create "$name" --project "$PROJECT_ID" \
      --replication-policy=user-managed --locations="$REGION" --data-file=- >/dev/null
    echo "  $name created"
  fi
}

put_secret "$SECRET_DB_URL" "$(env_value .env.supabase ARO_DB__URL)"
put_secret "$SECRET_SUPABASE_KEY" "$(env_value .env.supabase SUPABASE_SECRET_KEY)"
put_secret "$SECRET_EDGE" "$(env_value .env.edge EDGE_SECRET)"
if ! secret_exists "$SECRET_FILES_KEY"; then
  put_secret "$SECRET_FILES_KEY" "$(openssl rand -hex 32)"
else
  echo "  $SECRET_FILES_KEY exists (kept)"
fi
if [ -n "$(env_value .env.supabase RESEND_API_KEY)" ]; then
  put_secret "$SECRET_RESEND" "$(env_value .env.supabase RESEND_API_KEY)"
fi
if [ -n "$(env_value .env.cloudflare CLOUDFLARE_API_TOKEN)" ]; then
  put_secret "$SECRET_CLOUDFLARE" "$(env_value .env.cloudflare CLOUDFLARE_API_TOKEN)"
fi
if ! secret_exists "$SECRET_GIT_TOKEN"; then
  GIT_TOKEN="$(env_value .env.github SAKALYA_BACKEND_READ_TOKEN)"
  if [ -z "$GIT_TOKEN" ] && [ "$DRY_RUN" != "1" ]; then
    read -r -s -p "Read-only GitHub token for sakalyatechnologies/sakalya-backend (hidden): " GIT_TOKEN
    echo
  fi
  { [ -n "$GIT_TOKEN" ] || [ "$DRY_RUN" = "1" ]; } || die "no GitHub token given"
  put_secret "$SECRET_GIT_TOKEN" "$GIT_TOKEN"
  unset GIT_TOKEN
else
  echo "  $SECRET_GIT_TOKEN exists (kept)"
fi

echo "== Secret access"
grant_secret() { # secret member role
  if [ "$DRY_RUN" = "1" ] || secret_exists "$1"; then
    mutate gcloud secrets add-iam-policy-binding "$1" --project "$PROJECT_ID" \
      --member "serviceAccount:$2" --role "$3" --quiet >/dev/null
  fi
}
for s in "$SECRET_DB_URL" "$SECRET_SUPABASE_KEY" "$SECRET_EDGE" "$SECRET_FILES_KEY" "$SECRET_RESEND" "$SECRET_CLOUDFLARE"; do
  grant_secret "$s" "$RUN_SA" roles/secretmanager.secretAccessor
done
grant_secret "$SECRET_GIT_TOKEN" "$BUILD_SA" roles/secretmanager.secretAccessor

# ---- 5. Budget ----------------------------------------------------------------------------
echo "== Budget"
BUDGET_NAME="aarogyam-${PROJECT_ID}"
EXISTING_BUDGETS="$(gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" \
  --billing-project "$PROJECT_ID" --format='value(displayName)' 2>/dev/null || true)"
if printf '%s\n' "$EXISTING_BUDGETS" | grep -qx "$BUDGET_NAME"; then
  echo "  budget '$BUDGET_NAME' exists"
else
  create_budget() {
    mutate gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" \
      --billing-project "$PROJECT_ID" --display-name "$BUDGET_NAME" \
      --budget-amount "$1" --filter-projects "projects/$PROJECT_ID" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
  }
  create_budget "$BUDGET_AMOUNT" || {
    echo "  Budget in $BUDGET_AMOUNT failed (an account in rupees needs a rupee budget); trying 85INR (about \$1)."
    create_budget 85INR || die "could not create the budget; create one by hand: Console > Billing > Budgets"
  }
fi

cat <<DONE

Setup finished. Next: scripts/cloud-run-deploy.sh
DONE
