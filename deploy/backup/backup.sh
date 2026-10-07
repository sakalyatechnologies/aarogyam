#!/bin/sh
# Nightly backup: pg_dump (custom format) of the schemas aarogyam, audit and private, plus app
# (functions only, which the other schemas' triggers and policies need to restore), uploaded to
# a Google Cloud Storage bucket. Runs as a Cloud Run job as the backup service account, which
# may only create objects in the bucket and read the owner-URL secret.
#
#   daily/aarogyam-<UTC time>.dump     every run          (bucket lifecycle keeps 14 days)
#   weekly/aarogyam-<UTC time>.dump    Sundays (UTC) too  (bucket lifecycle keeps 56 days)
#
# Environment:
#   DB_URL         the schema owner's URL (secret aarogyam-db-owner-url); never printed
#   BACKUP_BUCKET  bucket name; required unless BACKUP_UPLOAD=0
#   BACKUP_UPLOAD  1 (default) uploads; 0 keeps the file in OUT_DIR (local trial runs)
#   OUT_DIR        where the dump is written first (default /tmp, in memory on Cloud Run)
# Log lines are JSON with an `event` field and counts only, never data.
set -eu

: "${DB_URL:?DB_URL is required}"
BACKUP_UPLOAD="${BACKUP_UPLOAD:-1}"
OUT_DIR="${OUT_DIR:-/tmp}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="aarogyam-${STAMP}.dump"
FILE="${OUT_DIR}/${NAME}"

log() { # event key=value...
  printf '{"severity":"%s","event":"%s","message":"%s"}\n' "${LOG_SEVERITY:-INFO}" "$1" "$2"
}
fail() { LOG_SEVERITY=ERROR log backup.failed "$1"; exit 1; }

# pg_dump refuses a newer server; say so in words that point at the fix.
SERVER_NUM="$(psql "$DB_URL" -Atqc 'show server_version_num' 2>/dev/null)" || fail "cannot connect to the database"
DUMP_MAJOR="$(pg_dump --version | sed -n 's/^pg_dump (PostgreSQL) \([0-9]*\).*/\1/p')"
[ $((SERVER_NUM / 10000)) -le "$DUMP_MAJOR" ] || fail "server is newer than pg_dump ${DUMP_MAJOR}: bump the image in deploy/backup/Dockerfile"

pg_dump "$DB_URL" --format=custom --compress=6 --no-password \
  --schema=aarogyam --schema=audit --schema=private --schema=app \
  --file="$FILE" || fail "pg_dump failed"

# The archive must be readable before it counts as a backup.
ENTRIES="$(pg_restore --list "$FILE" | grep -c '^[0-9]')" || fail "the dump cannot be read back"
[ "$ENTRIES" -gt 0 ] || fail "the dump is empty"
BYTES="$(wc -c <"$FILE" | tr -d ' ')"

if [ "$BACKUP_UPLOAD" != "1" ]; then
  log backup.completed "kept locally: ${FILE} (${BYTES} bytes, ${ENTRIES} entries)"
  exit 0
fi

: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
TOKEN="$(curl -sS -f -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
[ -n "$TOKEN" ] || fail "no access token from the metadata server"

upload() { # object-name
  # ifGenerationMatch=0: create only, never replace. The account has no delete or overwrite right.
  SIZE="$(curl -sS -f -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/octet-stream' \
    --data-binary "@${FILE}" \
    "https://storage.googleapis.com/upload/storage/v1/b/${BACKUP_BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=$1" \
    | sed -n 's/.*"size": *"\([0-9]*\)".*/\1/p')" || fail "upload of $1 failed"
  [ "$SIZE" = "$BYTES" ] || fail "uploaded size ${SIZE:-none} differs from ${BYTES} for $1"
}

upload "daily%2F${NAME}"
KEPT="daily/${NAME}"
if [ "$(date -u +%u)" = "7" ]; then
  upload "weekly%2F${NAME}"
  KEPT="${KEPT} weekly/${NAME}"
fi
rm -f "$FILE"
log backup.completed "uploaded ${KEPT} (${BYTES} bytes, ${ENTRIES} entries)"
