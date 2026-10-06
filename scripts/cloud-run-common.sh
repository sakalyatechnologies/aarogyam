#!/usr/bin/env bash
# Shared settings and helpers for scripts/cloud-run-setup.sh and scripts/cloud-run-deploy.sh.
# Sourced, not run. Names here are the contract between the two scripts.
# shellcheck shell=bash disable=SC2034

REGION="${REGION:-asia-south1}"
AR_REPO="${AR_REPO:-aarogyam}"
SERVICE="${SERVICE:-aarogyam-api}"
DRAIN_JOB="${DRAIN_JOB:-aarogyam-outbox}"
DRAIN_SCHEDULE="${DRAIN_SCHEDULE:-*/2 * * * *}"   # every 2 minutes, see docs/deploy.md
RUN_SA_NAME="aarogyam-run"          # the API and the outbox job run as this
BUILD_SA_NAME="aarogyam-build"      # Cloud Build runs as this
SCHED_SA_NAME="aarogyam-scheduler"  # Cloud Scheduler calls the job as this
MIGRATE_JOB="${MIGRATE_JOB:-aarogyam-migrate}"
MIGRATE_SA_NAME="aarogyam-migrate"  # the migrate job runs as this; reads only the owner-URL secret
ENVIRONMENT_NAME="${ARO_ENVIRONMENT:-staging}"

# Secret Manager names, and where each value comes from (see cloud-run-setup.sh).
SECRET_DB_URL="aarogyam-db-url"                # ARO_DB__URL            (.env.supabase)
SECRET_DB_OWNER_URL="aarogyam-db-owner-url"    # ARO_DB__OWNER_URL      (.env.supabase; migrate job only)
SECRET_EDGE="aarogyam-edge-secret"             # ARO_HTTP__EDGE_SECRET  (.env.edge)
SECRET_SUPABASE_KEY="aarogyam-supabase-secret-key"  # SUPABASE_SECRET_KEY (.env.supabase)
SECRET_FILES_KEY="aarogyam-files-signing-key"  # ARO_FILES__SIGNING_KEY (generated once)
SECRET_RESEND="aarogyam-resend-api-key"        # ARO_EMAIL__RESEND_API_KEY (optional)
SECRET_CLOUDFLARE="aarogyam-cloudflare-token"  # ARO_EDGE__CLOUDFLARE_API_TOKEN (.env.cloudflare; outbox job only)
SECRET_GIT_TOKEN="sakalya-backend-read-token"  # Cloud Build only: private cargo dependency

DRY_RUN="${DRY_RUN:-0}"
ASSUME_YES=0

die() { echo "error: $*" >&2; exit 1; }

# Prints the command instead of running it when DRY_RUN=1. Anything that changes the project
# goes through here; read-only `gcloud ... describe/list` calls use `gcloud` directly.
mutate() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  [ "$DRY_RUN" = "1" ] && return 0
  local answer
  read -r -p "$1 [y/N] " answer
  case "$answer" in y | Y | yes | YES) return 0 ;; *) echo "Cancelled."; exit 1 ;; esac
}

parse_common_flags() {
  for arg in "$@"; do
    case "$arg" in
      --yes | -y) ASSUME_YES=1 ;;
      --dry-run) DRY_RUN=1 ;;
      -h | --help) sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die "unknown argument: $arg" ;;
    esac
  done
}

require_project() {
  PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
  [ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "(unset)" ] \
    || die "set PROJECT_ID=<your project id> (or: gcloud config set project <id>)"
  RUN_SA="${RUN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  BUILD_SA="${BUILD_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  MIGRATE_SA="${MIGRATE_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  SCHED_SA="${SCHED_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  IMAGE_REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
}

# Reads one KEY from a KEY=value file without sourcing it or printing it. Strips one pair of
# surrounding quotes. Prints nothing (and succeeds) when the key is absent.
env_value() { # file key
  local line
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$2=" "$1" 2>/dev/null | tail -n 1 || true)"
  [ -n "$line" ] || return 0
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"; line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

secret_exists() { gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1; }
