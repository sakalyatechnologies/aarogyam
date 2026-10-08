#!/bin/sh
# Nightly copy of the patient-files bucket (Supabase Storage, photos, X-rays, attachments) into
# the backup bucket under files/<same path>. Incremental: an object already there with the same
# size is skipped, so a night with no new files copies nothing. Runs as its own Cloud Run job
# (same image, command files-sync.sh) as the account aarogyam-backup-files, which may list and
# create objects in the backup bucket (never overwrite or delete) and read the Supabase key.
#
# Objects are named <clinic id>/<attachment id> and never change, so create-only is enough. A
# file deleted in Supabase stays in files/ until someone removes it by hand (docs/ops.md,
# "Erasure"); the lifecycle rules for daily/ and weekly/ do not apply to files/.
#
# Environment: SUPABASE_URL, SUPABASE_SECRET_KEY (secret), FILES_BUCKET (default aarogyam-files),
#   BACKUP_BUCKET, FILES_LIST_ONLY=1 (count what would be copied; touches nothing).
# Logs counts only, never file names or contents.
set -eu

: "${SUPABASE_URL:?SUPABASE_URL is required}"
: "${SUPABASE_SECRET_KEY:?SUPABASE_SECRET_KEY is required}"
FILES_BUCKET="${FILES_BUCKET:-aarogyam-files}"
LIST_ONLY="${FILES_LIST_ONLY:-0}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '{"severity":"%s","event":"%s","message":"%s"}\n' "${LOG_SEVERITY:-INFO}" "$1" "$2"; }
fail() { LOG_SEVERITY=ERROR log files.sync.failed "$1"; exit 1; }

# Lists one folder of the Supabase bucket: prints "<path> <size>" for files, "DIR <path>" for folders.
list_folder() { # prefix
  offset=0
  while :; do
    body="$(jq -n --arg p "$1" --argjson o "$offset" '{prefix:$p,limit:100,offset:$o}')"
    page="$(curl -sS -f -X POST "${SUPABASE_URL}/storage/v1/object/list/${FILES_BUCKET}" \
      -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" -H "apikey: ${SUPABASE_SECRET_KEY}" \
      -H 'Content-Type: application/json' -d "$body")" || fail "cannot list the Supabase bucket"
    n="$(printf '%s' "$page" | jq 'length')"
    printf '%s' "$page" | jq -r --arg p "$1" '.[] | if .id == null then "DIR \($p)\(.name)/" else "\($p)\(.name) \(.metadata.size // 0)" end'
    [ "$n" -ge 100 ] || break
    offset=$((offset + 100))
  done
}
walk() { # prefix
  list_folder "$1" | while IFS= read -r line; do
    case "$line" in
      "DIR "*) walk "${line#DIR }" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done
}

walk "" >"$WORK/source.txt"
TOTAL="$(wc -l <"$WORK/source.txt" | tr -d ' ')"

if [ "$LIST_ONLY" = "1" ]; then
  log files.sync.listed "${TOTAL} objects in ${FILES_BUCKET}"
  exit 0
fi

: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
TOKEN="$(curl -sS -f -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
  | jq -r .access_token)"
[ -n "$TOKEN" ] || fail "no access token from the metadata server"

# What the backup bucket already holds: "<path> <size>".
: >"$WORK/have.txt"
PAGE=""
while :; do
  url="https://storage.googleapis.com/storage/v1/b/${BACKUP_BUCKET}/o?prefix=files%2F&fields=items(name,size),nextPageToken"
  [ -z "$PAGE" ] || url="${url}&pageToken=${PAGE}"
  res="$(curl -sS -f -H "Authorization: Bearer ${TOKEN}" "$url")" || fail "cannot list the backup bucket"
  printf '%s' "$res" | jq -r '.items[]? | "\(.name | ltrimstr("files/")) \(.size)"' >>"$WORK/have.txt"
  PAGE="$(printf '%s' "$res" | jq -r '.nextPageToken // empty')"
  [ -n "$PAGE" ] || break
done

COPIED=0; SKIPPED=0; CHANGED=0
while IFS= read -r line; do
  path="${line% *}"; size="${line##* }"
  # Paths are UUIDs with a slash, never spaces, so the first field is the whole path.
  have_size="$(awk -v p="$path" '$1 == p { print $2; exit }' "$WORK/have.txt")"
  if [ "$have_size" = "$size" ]; then SKIPPED=$((SKIPPED + 1)); continue; fi
  if [ -n "$have_size" ]; then
    # Same name, different size: create-only means the first copy stays; say so.
    CHANGED=$((CHANGED + 1)); continue
  fi
  enc="$(jq -rn --arg v "$path" '$v | @uri')"
  curl -sS -f -H "Authorization: Bearer ${SUPABASE_SECRET_KEY}" -H "apikey: ${SUPABASE_SECRET_KEY}" \
    -o "$WORK/object" "${SUPABASE_URL}/storage/v1/object/${FILES_BUCKET}/${enc}" || fail "download failed for one object"
  curl -sS -f -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/octet-stream' \
    --data-binary "@$WORK/object" -o /dev/null \
    "https://storage.googleapis.com/upload/storage/v1/b/${BACKUP_BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=files%2F$(jq -rn --arg v "$path" '$v | @uri')" \
    || fail "upload failed for one object"
  rm -f "$WORK/object"
  COPIED=$((COPIED + 1))
done <"$WORK/source.txt"

[ "$CHANGED" = 0 ] || LOG_SEVERITY=WARNING log files.sync.changed "${CHANGED} objects differ in size from their backup copy (kept as first copied)"
log files.sync.completed "${TOTAL} in source, ${COPIED} copied, ${SKIPPED} already backed up"
