#!/usr/bin/env bash
# Pilot-readiness operations on Google Cloud, free tier where it exists (docs/ops.md): the
# nightly database backup (bucket, job, schedule), Cloud Monitoring uptime checks, a log-based
# metric for application errors, and alert policies that email the founder.
#
# DRY RUN BY DEFAULT: with no flag it prints the plan and every command it would run, and
# changes nothing. Safe to re-run: anything that already exists is left as it is.
#
# Usage:  PROJECT_ID=<id> scripts/ops-setup.sh [--yes]
#   --yes     apply the plan (no further prompt)
#   --dry-run print only (the default; wins over --yes)
# Settings (environment):
#   ALERT_EMAIL        who is emailed (default: the active gcloud account)
#   UPTIME_CLINIC      clinic slug whose portal address is checked (default: sunrise)
#   UPTIME_CLINIC_HOST full host to check, instead of <slug>-aarogyam.<workers subdomain>
#   UPTIME_WEBSITE_HOST  default aarogyam-website.pages.dev
#   BACKUP_BUCKET      default aarogyam-backups-<project id>
#   BACKUP_SCHEDULE    cron in UTC, default '30 20 * * *' (02:00 IST)
# Reads (never prints) nothing secret: it reuses the secret aarogyam-db-owner-url that
# scripts/cloud-run-setup.sh stored, so no new secret is needed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/cloud-run-common.sh
. scripts/cloud-run-common.sh

EXPLICIT_DRY=0
for arg in "$@"; do [ "$arg" = "--dry-run" ] && EXPLICIT_DRY=1; done
parse_common_flags "$@"
if [ "$ASSUME_YES" = "1" ] && [ "$EXPLICIT_DRY" = "0" ]; then DRY_RUN=0; else DRY_RUN=1; fi
require_project
command -v python3 >/dev/null || die "python3 is required (it reads the JSON the APIs return)"

BACKUP_BUCKET="${BACKUP_BUCKET:-aarogyam-backups-${PROJECT_ID}}"
BACKUP_SA="${BACKUP_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
ALERT_EMAIL="${ALERT_EMAIL:-$(gcloud config get-value account 2>/dev/null || true)}"
WORKERS_SUBDOMAIN="$(env_value .env.cloudflare CLOUDFLARE_WORKERS_SUBDOMAIN)"
UPTIME_CLINIC="${UPTIME_CLINIC:-sunrise}"
if [ -z "${UPTIME_CLINIC_HOST:-}" ]; then
  UPTIME_CLINIC_HOST="${UPTIME_CLINIC}-aarogyam.${WORKERS_SUBDOMAIN:-<workers-subdomain>}.workers.dev"
fi
UPTIME_WEBSITE_HOST="${UPTIME_WEBSITE_HOST:-aarogyam-website.pages.dev}"
ERROR_METRIC="aarogyam_error_events"

if [ "$DRY_RUN" != "1" ]; then
  command -v gcloud >/dev/null || die "gcloud is not installed"
  command -v curl >/dev/null || die "curl is required"
  gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . || die "not signed in: run 'gcloud auth login'"
  gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || die "project '$PROJECT_ID' not found or no access"
  [ -n "$WORKERS_SUBDOMAIN" ] || [ -n "${UPTIME_CLINIC_HOST##*<*}" ] || die "set CLOUDFLARE_WORKERS_SUBDOMAIN in .env.cloudflare or UPTIME_CLINIC_HOST"
  secret_exists "$SECRET_DB_OWNER_URL" || die "secret '$SECRET_DB_OWNER_URL' not found: run scripts/cloud-run-setup.sh first"
  [ -n "$ALERT_EMAIL" ] || die "set ALERT_EMAIL=<address to email>"
fi

CA_FILE=config/supabase-ca.crt
[ -f "$CA_FILE" ] || die "missing $CA_FILE (the backup image needs it)"
IMAGE_TAG="$(cat deploy/backup/Dockerfile deploy/backup/backup.sh "$CA_FILE" | shasum | cut -c1-12)"
BACKUP_IMAGE="${IMAGE_REPO}/backup:${IMAGE_TAG}"

cat <<PLAN

Project:  $PROJECT_ID   Region: $REGION   $([ "$DRY_RUN" = 1 ] && echo "(DRY RUN: nothing is changed; add --yes to apply)" || echo "(APPLYING)")
Will do:
  1. Enable APIs: monitoring, logging, clouderrorreporting, storage, run, cloudscheduler,
     cloudbuild, artifactregistry, secretmanager, iam
  2. Backup bucket gs://$BACKUP_BUCKET in $REGION: uniform access, public access blocked,
     Google-managed encryption at rest (the default), soft delete off, lifecycle rules:
       daily/   deleted after 14 days
       weekly/  deleted after 56 days (8 weeks)
  3. Service account $BACKUP_SA_NAME: may create objects in that bucket (cannot read, overwrite
     or delete them), read the secret $SECRET_DB_OWNER_URL, write logs. Nothing else.
  4. Backup image $BACKUP_IMAGE (Cloud Build, as $BUILD_SA_NAME), Cloud Run job $BACKUP_JOB,
     Cloud Scheduler '$BACKUP_SCHEDULE' (UTC) started as $SCHED_SA_NAME
  5. Email channel for $ALERT_EMAIL
  6. Uptime checks, every 5 minutes from 3 regions, HTTPS, 10 s timeout:
       aarogyam-clinic   https://$UPTIME_CLINIC_HOST/api/v1/health   (through the Cloudflare Worker, must say "ok")
       aarogyam-website  https://$UPTIME_WEBSITE_HOST/
  7. Log-based metric $ERROR_METRIC (error events the API reports, see docs/ops.md "Error tracking")
  8. Alert policies emailing the channel: uptime failing (clinic, website), Cloud Run 5xx
     (3 or more in 5 minutes), application error events (any in 5 minutes), backup job failed
Costs: all inside free tiers EXCEPT these lines, which are small but not free:
  - Cloud Storage in $REGION is not in the free tier (it covers only US regions): about
    USD 0.02 per GB-month; 22 retained dumps of a 20 MB database is about 0.5 GB, under 1 cent a month.
  - Cloud Build uses a source bucket in the US multi-region (about 10 MB). Free tier: 2,500 build minutes a month.
  - Artifact Registry: the backup image adds about 100 MB to the free 0.5 GB; the cleanup policy
    keeps the last 3 images of any repository package.
  Free: Cloud Run job (a minute a night), Cloud Scheduler (3 jobs free; this is the 2nd),
  uptime checks (1M executions free; this uses about 52k a month), alert policies and email
  notifications, the log-based metric, Error Reporting (with Cloud Logging, 50 GB free).
PLAN
confirm "Apply?"

# Like mutate, but hides the policy gcloud echoes after an IAM change (never in a dry run).
mutate_quiet() {
  if [ "$DRY_RUN" = "1" ]; then mutate "$@"; else "$@" >/dev/null; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Calls the Cloud Monitoring REST API as the signed-in person. Reads that fail (no network, not
# signed in: a dry run) answer nothing, which reads as "does not exist yet".
mon() { # method path [json-file]
  local token
  token="$(gcloud auth print-access-token 2>/dev/null)" || return 1
  if [ -n "${3:-}" ]; then
    curl -sS -f -X "$1" -H "Authorization: Bearer $token" -H "x-goog-user-project: $PROJECT_ID" \
      -H 'Content-Type: application/json' -d "@$3" "https://monitoring.googleapis.com/v3/$2"
  else
    curl -sS -f -X "$1" -H "Authorization: Bearer $token" -H "x-goog-user-project: $PROJECT_ID" \
      "https://monitoring.googleapis.com/v3/$2"
  fi
}
# Prints the `name` of the item in a Monitoring list whose displayName matches, or nothing.
find_named() { # list-path json-key display-name
  mon GET "$1" 2>/dev/null | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except ValueError:
    sys.exit(0)
for item in data.get(sys.argv[1], []):
    if item.get("displayName") == sys.argv[2]:
        print(item["name"])
        break
' "$2" "$3" || true
}
# Creates the item unless one with that display name exists; prints its resource name.
create_named() { # collection json-key display-name json-file
  local existing
  existing="$(find_named "projects/$PROJECT_ID/$1" "$2" "$3")"
  if [ -n "$existing" ]; then
    echo "  $3 exists" >&2
    printf '%s' "$existing"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] create $1 '$3':" >&2
    sed 's/^/      /' "$4" >&2
    printf '%s' "projects/$PROJECT_ID/$1/<new-id>"
    return 0
  fi
  mon POST "projects/$PROJECT_ID/$1" "$4" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"], end="")'
  echo "  $3 created" >&2
}

# ---- 1. APIs ------------------------------------------------------------------------------
echo "== APIs"
mutate gcloud services enable monitoring.googleapis.com logging.googleapis.com \
  clouderrorreporting.googleapis.com storage.googleapis.com run.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com --project "$PROJECT_ID"

# ---- 2. Bucket ----------------------------------------------------------------------------
echo "== Backup bucket"
if gcloud storage buckets describe "gs://$BACKUP_BUCKET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "  gs://$BACKUP_BUCKET exists"
else
  mutate gcloud storage buckets create "gs://$BACKUP_BUCKET" --project "$PROJECT_ID" \
    --location "$REGION" --default-storage-class STANDARD --uniform-bucket-level-access \
    --public-access-prevention --soft-delete-duration=0
fi
cat >"$WORK/lifecycle.json" <<'JSON'
{"rule": [
  {"action": {"type": "Delete"}, "condition": {"age": 14, "matchesPrefix": ["daily/"]}},
  {"action": {"type": "Delete"}, "condition": {"age": 56, "matchesPrefix": ["weekly/"]}}
]}
JSON
mutate gcloud storage buckets update "gs://$BACKUP_BUCKET" --project "$PROJECT_ID" \
  --lifecycle-file="$WORK/lifecycle.json"

# ---- 3. Service account and access --------------------------------------------------------
echo "== Backup service account"
if gcloud iam service-accounts describe "$BACKUP_SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "  $BACKUP_SA_NAME exists"
else
  mutate gcloud iam service-accounts create "$BACKUP_SA_NAME" --display-name "Aarogyam database backup" --project "$PROJECT_ID"
  [ "$DRY_RUN" = "1" ] || sleep 8   # a new account can take a few seconds to be visible to IAM
fi
mutate_quiet gcloud storage buckets add-iam-policy-binding "gs://$BACKUP_BUCKET" --project "$PROJECT_ID" \
  --member "serviceAccount:$BACKUP_SA" --role roles/storage.objectCreator 
mutate_quiet gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$BACKUP_SA" \
  --role roles/logging.logWriter --condition=None --quiet
# The owner URL can change the schema, and pg_dump needs it (row-level security hides rows from
# any other role). Only the migrate and backup accounts read it, never the API's.
mutate_quiet gcloud secrets add-iam-policy-binding "$SECRET_DB_OWNER_URL" --project "$PROJECT_ID" \
  --member "serviceAccount:$BACKUP_SA" --role roles/secretmanager.secretAccessor --quiet

# ---- 4. Image, job, schedule --------------------------------------------------------------
echo "== Backup image"
if gcloud artifacts docker images describe "$BACKUP_IMAGE" >/dev/null 2>&1; then
  echo "  $BACKUP_IMAGE exists"
else
  CTX="$WORK/backup-image"
  mkdir -p "$CTX/config"
  cp deploy/backup/Dockerfile deploy/backup/backup.sh "$CTX/"
  cp "$CA_FILE" "$CTX/config/"
  cat >"$WORK/build.yaml" <<'YAML'
options:
  logging: CLOUD_LOGGING_ONLY
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build", "-t", "$_IMAGE", "."]
images: ["$_IMAGE"]
YAML
  mutate gcloud builds submit "$CTX" --project "$PROJECT_ID" --region "$REGION" \
    --config "$WORK/build.yaml" --substitutions "_IMAGE=${BACKUP_IMAGE}" \
    --service-account "projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA}"
fi
if [ "$DRY_RUN" = "1" ]; then
  DIGEST_IMAGE="${BACKUP_IMAGE%%:*}@sha256:<digest>"
else
  DIGEST_IMAGE="$(gcloud artifacts docker images describe "$BACKUP_IMAGE" --format='value(image_summary.fully_qualified_digest)')"
  [ -n "$DIGEST_IMAGE" ] || die "image $BACKUP_IMAGE not found"
fi

echo "== Backup job and schedule"
mutate gcloud run jobs deploy "$BACKUP_JOB" --project "$PROJECT_ID" --region "$REGION" \
  --image "$DIGEST_IMAGE" --service-account "$BACKUP_SA" \
  --tasks 1 --max-retries 1 --task-timeout 900s --cpu 1 --memory 1Gi \
  --set-env-vars "BACKUP_BUCKET=${BACKUP_BUCKET}" \
  --set-secrets "DB_URL=${SECRET_DB_OWNER_URL}:latest" --quiet
mutate_quiet gcloud run jobs add-iam-policy-binding "$BACKUP_JOB" --project "$PROJECT_ID" \
  --region "$REGION" --member "serviceAccount:${SCHED_SA}" --role roles/run.invoker --quiet
JOB_URI="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${BACKUP_JOB}:run"
if gcloud scheduler jobs describe "$BACKUP_JOB" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  SCHED_VERB=update
  HEADERS_FLAG=--update-headers
else
  SCHED_VERB=create
  HEADERS_FLAG=--headers
fi
mutate gcloud scheduler jobs "$SCHED_VERB" http "$BACKUP_JOB" --project "$PROJECT_ID" \
  --location "$REGION" --schedule "$BACKUP_SCHEDULE" --time-zone Etc/UTC \
  --uri "$JOB_URI" --http-method POST "$HEADERS_FLAG" "Content-Type=application/json" \
  --message-body '{}' --oauth-service-account-email "$SCHED_SA"

# ---- 5. Email channel ---------------------------------------------------------------------
echo "== Email channel"
cat >"$WORK/channel.json" <<JSON
{"type": "email", "displayName": "Aarogyam founder email",
 "labels": {"email_address": "$ALERT_EMAIL"}}
JSON
CHANNEL="$(create_named notificationChannels notificationChannels "Aarogyam founder email" "$WORK/channel.json")"

# ---- 6. Uptime checks ---------------------------------------------------------------------
echo "== Uptime checks"
uptime_check() { # display-name host path content-matcher-or-empty
  local matcher=""
  [ -z "$4" ] || matcher=", \"contentMatchers\": [{\"content\": \"$4\", \"matcher\": \"CONTAINS_STRING\"}]"
  cat >"$WORK/uptime-$1.json" <<JSON
{"displayName": "$1",
 "monitoredResource": {"type": "uptime_url", "labels": {"project_id": "$PROJECT_ID", "host": "$2"}},
 "httpCheck": {"path": "$3", "port": 443, "useSsl": true, "validateSsl": true, "requestMethod": "GET",
   "acceptedResponseStatusCodes": [{"statusClass": "STATUS_CLASS_2XX"}]},
 "period": "300s", "timeout": "10s",
 "selectedRegions": ["EUROPE", "USA_VIRGINIA", "ASIA_PACIFIC"]$matcher}
JSON
  create_named uptimeCheckConfigs uptimeCheckConfigs "$1" "$WORK/uptime-$1.json"
}
CLINIC_CHECK="$(uptime_check aarogyam-clinic "$UPTIME_CLINIC_HOST" /api/v1/health '\"status\":\"ok\"')"
SITE_CHECK="$(uptime_check aarogyam-website "$UPTIME_WEBSITE_HOST" / '')"

# ---- 7. Log-based metric ------------------------------------------------------------------
echo "== Log-based metric"
if gcloud logging metrics describe "$ERROR_METRIC" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "  $ERROR_METRIC exists"
else
  mutate gcloud logging metrics create "$ERROR_METRIC" --project "$PROJECT_ID" \
    --description "Error events the Aarogyam API reports (5xx answers and panics), Error Reporting shape" \
    --log-filter 'resource.type="cloud_run_revision" AND jsonPayload."@type"="type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent" AND jsonPayload.serviceContext.service="aarogyam-api"'
fi

# ---- 8. Alert policies --------------------------------------------------------------------
echo "== Alert policies"
policy() { # display-name filter aligner period threshold documentation [group-by-json]
  cat >"$WORK/policy.json" <<JSON
{"displayName": "$1", "combiner": "OR",
 "conditions": [{"displayName": "$1", "conditionThreshold": {
   "filter": "$2",
   "aggregations": [{"alignmentPeriod": "$4", "perSeriesAligner": "$3", "crossSeriesReducer": "${8:-REDUCE_SUM}", "groupByFields": ${7:-[]}}],
   "comparison": "COMPARISON_GT", "thresholdValue": $5, "duration": "0s", "trigger": {"count": 1}}}],
 "notificationChannels": ["$CHANNEL"],
 "documentation": {"mimeType": "text/markdown", "content": "$6"}}
JSON
  create_named alertPolicies alertPolicies "$1" "$WORK/policy.json" >/dev/null
}
uptime_policy() { # display-name check-resource-name
  local id="${2##*/}"
  cat >"$WORK/policy.json" <<JSON
{"displayName": "$1", "combiner": "OR",
 "conditions": [{"displayName": "$1", "conditionThreshold": {
   "filter": "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"$id\" AND resource.type=\"uptime_url\"",
   "aggregations": [{"alignmentPeriod": "600s", "perSeriesAligner": "ALIGN_NEXT_OLDER", "crossSeriesReducer": "REDUCE_COUNT_FALSE", "groupByFields": ["resource.label.*"]}],
   "comparison": "COMPARISON_GT", "thresholdValue": 1, "duration": "60s", "trigger": {"count": 1}}}],
 "notificationChannels": ["$CHANNEL"],
 "documentation": {"mimeType": "text/markdown", "content": "Two or more of three regions cannot reach the address. See docs/ops.md, Runbook."}}
JSON
  create_named alertPolicies alertPolicies "$1" "$WORK/policy.json" >/dev/null
}
uptime_policy "Aarogyam uptime: clinic address failing" "$CLINIC_CHECK"
uptime_policy "Aarogyam uptime: website failing" "$SITE_CHECK"
policy "Aarogyam API: Cloud Run 5xx" \
  'metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"aarogyam-api\" AND metric.label.response_code_class=\"5xx\"' \
  ALIGN_DELTA 300s 2 "Three or more 5xx answers in five minutes. See docs/ops.md, Runbook."
policy "Aarogyam API: error events reported" \
  "metric.type=\\\"logging.googleapis.com/user/${ERROR_METRIC}\\\" AND resource.type=\\\"cloud_run_revision\\\"" \
  ALIGN_DELTA 300s 0 "The API reported a 5xx or a panic (Error Reporting has the group). See docs/ops.md, Runbook." \
  || echo "  could not create the error-events policy yet: a new log-based metric can take a few minutes to appear. Re-run this script (it skips what exists)."
policy "Aarogyam backup: job failed" \
  'metric.type=\"run.googleapis.com/job/completed_execution_count\" AND resource.type=\"cloud_run_job\" AND resource.label.job_name=\"aarogyam-backup\" AND metric.label.result=\"failed\"' \
  ALIGN_DELTA 3600s 0 "The nightly backup failed; the latest dump is more than a day old. See docs/ops.md, Backups."

cat <<DONE

$([ "$DRY_RUN" = 1 ] && echo "Dry run finished: nothing was changed. Apply with: PROJECT_ID=$PROJECT_ID scripts/ops-setup.sh --yes" || echo "Done.")

Then, once:
  - Run the backup now:  gcloud run jobs execute $BACKUP_JOB --region $REGION --project $PROJECT_ID --wait
  - Check Console > Monitoring > Alerting shows five policies and Uptime shows two checks.
  - Error Reporting (Console > Error Reporting) shows errors once the API with error reporting is deployed.
  - Restore drill: scripts/restore-drill.sh --yes   (docs/ops.md)
DONE
