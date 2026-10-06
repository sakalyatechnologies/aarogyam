#!/usr/bin/env bash
# Builds the Aarogyam API image in Cloud Build (remote: nothing compiles on this machine),
# deploys it to Cloud Run in asia-south1, and schedules the outbox sender. Re-run it for every
# release. Run scripts/cloud-run-setup.sh once first. See docs/deploy.md "Cloud Run (free
# trial account)".
#
# Service: min 0 / max 1 instances, 40 concurrent requests, 512Mi, CPU only while a request is
# running. Secrets come from Secret Manager as environment variables. ARO_HTTP__EDGE_HOST_HEADER
# is left unset (the default x-forwarded-host): the Cloudflare Worker sets it and Cloud Run
# passes it through. The edge secret is what stops anyone but the Workers using the API.
#
# Outbox sender: a Cloud Run *job* (`aarogyam outbox drain`, once, then exit) started by Cloud
# Scheduler every 2 minutes. It costs nothing when idle, unlike a background task in the API,
# which would need an always-running instance (min-instances 1, never free).
#
# Usage:  PROJECT_ID=<id> scripts/cloud-run-deploy.sh [--yes] [--dry-run]
#   IMAGE=<full image path>   skip the build and deploy an image that already exists
#   DRAIN_SCHEDULE='*/5 * * * *'   change how often the outbox is sent (cron, UTC)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/cloud-run-common.sh
. scripts/cloud-run-common.sh
parse_common_flags "$@"
require_project
command -v gcloud >/dev/null || die "gcloud is not installed"

# ---- Preflight (read-only) ----------------------------------------------------------------
[ -f .env.supabase ] || die "missing .env.supabase"
[ -f .env.cloudflare ] || die "missing .env.cloudflare"
SUPABASE_URL="$(env_value .env.supabase SUPABASE_URL)"
WORKERS_SUBDOMAIN="$(env_value .env.cloudflare CLOUDFLARE_WORKERS_SUBDOMAIN)"
[ -n "$SUPABASE_URL" ] || die "SUPABASE_URL is missing in .env.supabase"
[ -n "$WORKERS_SUBDOMAIN" ] || die "CLOUDFLARE_WORKERS_SUBDOMAIN is missing in .env.cloudflare"
WORKERS="${WORKERS_SUBDOMAIN}.workers.dev"

if [ "$DRY_RUN" != "1" ]; then
  for s in "$SECRET_DB_URL" "$SECRET_EDGE" "$SECRET_SUPABASE_KEY" "$SECRET_FILES_KEY" "$SECRET_GIT_TOKEN"; do
    secret_exists "$s" || die "secret '$s' not found: run scripts/cloud-run-setup.sh first"
  done
fi

SECRETS="ARO_DB__URL=${SECRET_DB_URL}:latest"
SECRETS="${SECRETS},ARO_HTTP__EDGE_SECRET=${SECRET_EDGE}:latest"
SECRETS="${SECRETS},SUPABASE_SECRET_KEY=${SECRET_SUPABASE_KEY}:latest"
SECRETS="${SECRETS},ARO_FILES__SIGNING_KEY=${SECRET_FILES_KEY}:latest"
if [ "$DRY_RUN" = "1" ] || secret_exists "$SECRET_RESEND"; then
  SECRETS="${SECRETS},ARO_EMAIL__RESEND_API_KEY=${SECRET_RESEND}:latest"
fi

# Same settings as scripts/demo-api.sh, minus ARO_HTTP__EDGE_HOST_HEADER (the Funnel-only
# workaround). '#' separates the values (gcloud's custom list delimiter), since one holds '@'.
ENV_VARS="ARO_ENVIRONMENT=${ENVIRONMENT_NAME}"
ENV_VARS="${ENV_VARS}#SUPABASE_URL=${SUPABASE_URL}"
ENV_VARS="${ENV_VARS}#ARO_AUTH__MODE=supabase"
ENV_VARS="${ENV_VARS}#ARO_AUTH__DEV_TOKENS=false"
ENV_VARS="${ENV_VARS}#ARO_HOSTS__PORTAL_HOST_TEMPLATE={slug}-aarogyam.${WORKERS}"
ENV_VARS="${ENV_VARS}#ARO_HOSTS__APP=aarogyam-portal.${WORKERS}"
ENV_VARS="${ENV_VARS}#ARO_HOSTS__CONSOLE=aarogyam-console.${WORKERS}"
ENV_VARS="${ENV_VARS}#ARO_EMAIL__PORTAL_LINK=https://{host}"
ENV_VARS="${ENV_VARS}#ARO_EMAIL__FROM=${ARO_EMAIL__FROM:-Aarogyam <noreply@aarogyam.sakalyatechnologies.com>}"
ENV_VARS="${ENV_VARS}#ARO_FILES__DIR=/tmp/attachments"
ENV_VARS="${ENV_VARS}#ARO_TELEMETRY__FORMAT=cloud-logging"
ENV_VARS="${ENV_VARS}#ARO_TELEMETRY__FILTER=info"

if [ -z "${IMAGE:-}" ]; then
  TAG="$(git rev-parse --short HEAD)"
  git diff --quiet HEAD 2>/dev/null || TAG="${TAG}-dirty-$(date -u +%H%M%S)"
  IMAGE="${IMAGE_REPO}/api:${TAG}"
  DO_BUILD=1
else
  DO_BUILD=0
fi

cat <<PLAN

Project:   $PROJECT_ID   Region: $REGION
Image:     $IMAGE $([ "$DO_BUILD" = 1 ] && echo "(Cloud Build, as $BUILD_SA_NAME)" || echo "(existing, no build)")
Service:   $SERVICE  min 0 / max 1 instance, concurrency 40, 512Mi, CPU only during requests
Job:       $DRAIN_JOB  runs 'outbox drain' on schedule '$DRAIN_SCHEDULE' (UTC)
Hosts:     portal {slug}-aarogyam.$WORKERS, app/console on $WORKERS
Source:    this checkout (.gcloudignore keeps .env files, docs and web out of the upload)
PLAN
if [ "$DO_BUILD" = 1 ] && ! git diff --quiet HEAD 2>/dev/null; then
  echo "Note: uncommitted changes are included in the build."
fi
[ "$DRY_RUN" = "1" ] && echo "(dry run: changes are printed, not made)"
confirm "Build and deploy?"

# ---- Build --------------------------------------------------------------------------------
if [ "$DO_BUILD" = 1 ]; then
  echo "== Build (Cloud Build, remote; the first build takes roughly 15-25 minutes)"
  BUILD_CONFIG="$(mktemp)"
  trap 'rm -f "$BUILD_CONFIG"' EXIT
  cat >"$BUILD_CONFIG" <<'YAML'
options:
  logging: CLOUD_LOGGING_ONLY
timeout: 2400s
availableSecrets:
  secretManager:
    - versionName: projects/$PROJECT_ID/secrets/sakalya-backend-read-token/versions/latest
      env: GIT_TOKEN
steps:
  - id: build-and-push
    name: gcr.io/cloud-builders/docker
    entrypoint: bash
    env: ["DOCKER_BUILDKIT=1"]
    secretEnv: ["GIT_TOKEN"]
    args:
      - -c
      - |
        set -euo pipefail
        docker build --secret id=git_token,env=GIT_TOKEN -t "$_IMAGE" .
        docker push "$_IMAGE"
YAML
  mutate gcloud builds submit . --project "$PROJECT_ID" --region "$REGION" \
    --config "$BUILD_CONFIG" --substitutions "_IMAGE=${IMAGE}" \
    --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}"
fi

# Deploy by digest, so what runs is exactly what was built.
if [ "$DRY_RUN" = "1" ]; then
  DIGEST_IMAGE="${IMAGE%%:*}@sha256:<digest>"
else
  DIGEST_IMAGE="$(gcloud artifacts docker images describe "$IMAGE" \
    --format='value(image_summary.fully_qualified_digest)')"
  [ -n "$DIGEST_IMAGE" ] || die "image $IMAGE not found in Artifact Registry"
fi

# ---- Service ------------------------------------------------------------------------------
echo "== Cloud Run service"
mutate gcloud run deploy "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --image "$DIGEST_IMAGE" --service-account "$RUN_SA" \
  --allow-unauthenticated --ingress all --port 8080 \
  --min-instances 0 --max-instances 1 --concurrency 40 \
  --cpu 1 --memory 512Mi --cpu-throttling --cpu-boost --timeout 30 \
  --set-env-vars "^#^${ENV_VARS}" --set-secrets "$SECRETS" --quiet

# ---- Outbox job and schedule --------------------------------------------------------------
echo "== Outbox job"
mutate gcloud run jobs deploy "$DRAIN_JOB" --project "$PROJECT_ID" --region "$REGION" \
  --image "$DIGEST_IMAGE" --service-account "$RUN_SA" --args "outbox,drain" \
  --tasks 1 --max-retries 0 --task-timeout 120s --cpu 1 --memory 512Mi \
  --set-env-vars "^#^${ENV_VARS}" --set-secrets "$SECRETS" --quiet

mutate gcloud run jobs add-iam-policy-binding "$DRAIN_JOB" --project "$PROJECT_ID" \
  --region "$REGION" --member "serviceAccount:${SCHED_SA}" --role roles/run.invoker --quiet >/dev/null

echo "== Scheduler"
JOB_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${DRAIN_JOB}:run"
if gcloud scheduler jobs describe "$DRAIN_JOB" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  SCHED_VERB=update
else
  SCHED_VERB=create
fi
mutate gcloud scheduler jobs "$SCHED_VERB" http "$DRAIN_JOB" --project "$PROJECT_ID" \
  --location "$REGION" --schedule "$DRAIN_SCHEDULE" --time-zone Etc/UTC \
  --uri "$JOB_URI" --http-method POST --headers "Content-Type=application/json" \
  --message-body '{}' --oauth-service-account-email "$SCHED_SA"

# ---- Result -------------------------------------------------------------------------------
if [ "$DRY_RUN" = "1" ]; then
  URL="https://${SERVICE}-<hash>-el.a.run.app"
else
  URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
  echo "== Smoke test"
  printf '  GET /healthz        -> %s (expect 200)\n' "$(curl -s -o /dev/null -w '%{http_code}' "$URL/healthz" || true)"
  printf '  GET /api/v1/me      -> %s (expect 401: no edge secret, refused by design)\n' \
    "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/v1/me" || true)"
fi

cat <<DONE

Service URL: $URL

Point the Workers at it (the portal and console, then one per clinic):
  scripts/deploy-workers.sh $URL
  scripts/deploy-workers.sh $URL aarogyam-<clinic>     # e.g. aarogyam-suhasya

Outbox runs every: $DRAIN_SCHEDULE (UTC). Run it now:
  gcloud run jobs execute $DRAIN_JOB --region $REGION --project $PROJECT_ID
Logs:
  gcloud run services logs read $SERVICE --region $REGION --project $PROJECT_ID --limit 50
DONE
