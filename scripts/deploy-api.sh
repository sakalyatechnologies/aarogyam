#!/usr/bin/env bash
# Manual trigger for the Cloud Build pipeline (cloudbuild.yaml): build, migrate, deploy. Prefer
# a Cloud Build trigger wired to pushes on `main` (see docs/deploy.md); this is for a one-off
# run from a branch already checked out at the commit you want staged.
#
# Usage: scripts/deploy-api.sh [supabase-project-ref]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID="sakalya-clinic-staging"
BRANCH_NAME="$(git rev-parse --abbrev-ref HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
SUPABASE_PROJECT_REF="${1:-}"

if [ "$BRANCH_NAME" != "main" ]; then
  echo "Refusing to submit from branch '${BRANCH_NAME}': staging only deploys main (cloudbuild.yaml enforces this too)." >&2
  exit 1
fi

SUBSTITUTIONS="BRANCH_NAME=${BRANCH_NAME},SHORT_SHA=${SHORT_SHA}"
if [ -n "$SUPABASE_PROJECT_REF" ]; then
  SUBSTITUTIONS="${SUBSTITUTIONS},_SUPABASE_PROJECT_REF=${SUPABASE_PROJECT_REF}"
fi

echo "Submitting cloudbuild.yaml for ${SHORT_SHA} on ${BRANCH_NAME} to project ${PROJECT_ID}..."
gcloud builds submit \
  --project "$PROJECT_ID" \
  --config cloudbuild.yaml \
  --substitutions "$SUBSTITUTIONS" \
  .
