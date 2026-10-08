# Pilot operations (M6)

Error tracking, alerts, uptime checks and backups for the production API. Everything is
free-tier except one line, noted under Costs. The scripts print a plan and change nothing until
the founder adds `--yes`.

| Piece | Where | Script |
|---|---|---|
| 5xx and panic reports, web errors | Cloud Error Reporting (free with Cloud Logging) | built into the API |
| Alert emails | Cloud Monitoring alert policies | `scripts/ops-setup.sh` |
| Uptime checks | Cloud Monitoring, every 5 minutes, 3 regions | `scripts/ops-setup.sh` |
| Nightly backup (database, auth accounts, patient files) | Cloud Run jobs `aarogyam-backup` and `aarogyam-backup-files` to a Cloud Storage bucket | `scripts/ops-setup.sh`, `deploy/backup/` |
| Restore drill | your laptop, scratch database | `scripts/restore-drill.sh` |
| Script tests | no cloud access | `scripts/ops-selftest.sh` |

## Apply (founder, in this order)

```bash
export PROJECT_ID=vernal-cargo-510800-v5
scripts/cloud-run-deploy.sh --yes                 # ships /api/v1/health, error reporting, client-error endpoint
scripts/ops-setup.sh                              # read the plan and the free-tier notes
scripts/ops-setup.sh --yes                        # creates bucket, accounts, job, schedule, checks, alerts
gcloud run jobs execute aarogyam-backup --region asia-south1 --project $PROJECT_ID --wait
scripts/restore-drill.sh --yes                    # restores that backup locally and reports
scripts/deploy-workers.sh <api-origin>            # portal and console start reporting browser errors
```

Deploy first: the uptime check calls `/api/v1/health`, which only exists after the new API is
live. `scripts/ops-setup.sh` is safe to re-run; the first run may report that the error-events
alert policy could not be created because a new log-based metric takes a few minutes to appear.
Run it again. It reuses the secret `aarogyam-db-owner-url` from `scripts/cloud-run-setup.sh`, so
there is no new secret. Settings (`ALERT_EMAIL`, `UPTIME_CLINIC`, `BACKUP_SCHEDULE`...) are listed
at the top of the script.

## Error tracking

**Server.** When the API runs outside `local`, every `5xx` answer (including the `500` the
standard layers make from a panic and the `503` from a timeout) and every panic is written to
standard output as one JSON line in the shape Error Reporting reads
(`crates/aarogyam-api/src/error_report.rs`):

```json
{"severity":"ERROR","time":"...","@type":"type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent",
 "serviceContext":{"service":"aarogyam-api","version":"0.1.0"},
 "message":"HTTP 500 GET /api/v1/patients/{id}",
 "context":{"httpRequest":{"method":"GET","url":"/api/v1/patients/{id}","responseStatusCode":500},
            "reportLocation":{"filePath":"/api/v1/patients/{id}","lineNumber":0,"functionName":"GET"}},
 "request_id":"0192..."}
```

No patient data can get in: the URL is the matched route template (never the raw path, query or
body), the request ID joins the event to the request's other log lines
(`jsonPayload.request_id="..."`, or `sk request <id>`), and a panic reports only its source
file and line, never its message (the panic hook is replaced so the payload is not printed to
standard error either). Events group by route in Console, Error Reporting.

**Browsers.** The portal and console install `installClientErrorReporting`
(`web/packages/app-kit`): uncaught errors and unhandled promise rejections are sent to
`POST /api/v1/client-errors` (name, message, stack, page path; at most 5 distinct errors per
page load). The endpoint needs no sign-in, so it is limited three ways: 20 requests a minute per
IP (the standard throttle), 120 reports a minute per instance, and 8 KB a request. Nothing is
stored: the report is scrubbed (`crates/aarogyam-api/src/scrub.rs`: quoted values, emails, phone
and long digit runs, UUIDs, tokens and URL query strings are replaced, route segments with a
digit become `:id`, text is cut to 300 and 2000 characters) and logged as an error event for the
service `aarogyam-web-<app>`. Scrubbing is a net: a name in free text with no quotes can pass,
which is why the helper sends only the error's name, message and stack. The public website
(Lovable-built) is not wired yet; add the same call to its entry file when it next changes.

Locally (`ARO_ENVIRONMENT=local`) none of this writes Error Reporting lines; client errors go to
the ordinary log as warnings.

**Alerts.** `scripts/ops-setup.sh` creates an email channel and six policies: clinic address
failing, website failing (two of three regions down), Cloud Run 5xx (three in five minutes),
application error events (any, from the log-based metric `aarogyam_error_events`), database backup failed, and patient files copy failed. Verify them in Console, Monitoring, Alerting after applying: the metric and filter names
were written from documentation, not tested against a live project. For "new error group"
emails, also switch on Error Reporting's own notifications in its settings (Console only).

## Uptime checks

Two checks, HTTPS, every 5 minutes, from Europe, US East and Asia Pacific, 10 second timeout:

- `aarogyam-clinic`: `https://<slug>-aarogyam.<workers subdomain>.workers.dev/api/v1/health`,
  through the Cloudflare Worker to Cloud Run, body must contain `"status":"ok"`. It exercises
  the Worker, the edge secret and the API. `/healthz` is not used: `*.run.app` answers it before
  the request reaches the container, and the API's `/healthz` is for probes only. The new
  `/api/v1/health` is public, touches no database, and says nothing but `ok`.
- `aarogyam-website`: the Pages home page.

This catches the API, Worker and site being down, not a database outage (deliberate: the same
reasoning as the liveness route). Watch the Cloud Run 5xx alert for that. About 52,000 check
executions a month against 1,000,000 free.

## Backups

Supabase's free plan has no downloadable backups, so the API's data is protected by:

- **What**: `pg_dump --format=custom` of schemas `aarogyam`, `audit`, `private` and also `app`
  (functions only; the other schemas' triggers, defaults and policies need them to restore).
  Taken with the owner URL (row-level security hides rows from every other role).
- **Auth accounts**: a second file, `auth-<time>.dump`, next to each dump: `auth.users` and
  `auth.identities` (the owner role can read them on Supabase; checked). It holds emails and
  password hashes, so it has the same access as the rest of the bucket and nothing else.
- **Patient files**: job `aarogyam-backup-files` (02:15 IST, account `aarogyam-backup-files`)
  lists the Supabase Storage bucket `aarogyam-files` with the service key and copies objects
  that are not yet in `files/<clinic id>/<attachment id>`. Incremental (a quiet night copies
  nothing), create-only (never overwrites). Objects never change after upload. It may list and
  create objects in the bucket and read `aarogyam-supabase-secret-key`, nothing else. `files/`
  is **not** under the 14/56-day rules: expiring by age would delete files that are still in use.
  Instead a file stays until removed by hand (see Erasure).
- **When**: Cloud Scheduler `30 20 * * *` UTC (02:00 IST) starts Cloud Run job `aarogyam-backup`
  (`deploy/backup/`, postgres:17 client). The dump is read back with `pg_restore --list` and its
  size checked after upload; failures log `backup.failed` and the "backup job failed" alert
  emails.
- **Where**: bucket `gs://aarogyam-backups-<project>` in `asia-south1`. Sundays (UTC) a copy also
  goes under `weekly/`. Lifecycle rules delete `daily/` after 14 days and `weekly/` after 56
  days (14 daily and 8 weekly). Google-managed encryption at rest (the default), uniform bucket
  access, public access blocked, soft delete off.
- **Who**: the service account `aarogyam-backup` can create objects (it cannot read, overwrite or
  delete them, so a leaked job credential cannot destroy backups) and read the owner-URL
  secret. The founder's own account reads the bucket. Nobody else has a grant.
- **Needs**: the owner URL must be the session-mode pooler or direct address (port 5432), as
  the migrate job already uses. Transaction-mode (6543) breaks `pg_dump`.

### RPO and RTO, honestly

- **RPO (data you can lose): up to 24 hours, more when a night fails.** One dump a night, no
  point-in-time recovery. A failed night makes it 48 hours; the alert tells you the next
  morning, nothing alerts on a job that never ran (check the drill's "age" line).
- **RTO (time to be back):** the restore itself is minutes at pilot size (0.7 MB, 1,600 rows
  restored in under a second locally; measure your own with the drill). The real figure is the
  manual work around it: a new database, roles, secrets, redeploy. Plan on 2 to 4 hours until
  this has been done once for real. No one has restored production from these dumps yet.
- **Files have a separate, smaller RPO**: up to 24 hours too, but a file lost between the upload
  and the next 02:15 IST run is gone; the database row would restore pointing at nothing.
- **Not in the backup**: database roles and their passwords, other Supabase Auth tables
  (sessions, refresh tokens: people sign in again), and the database's own settings.

### Restore drill

```bash
scripts/restore-drill.sh                       # prints the plan
scripts/restore-drill.sh --yes                 # newest daily dump into a scratch database on localhost
scripts/restore-drill.sh --yes --weekly        # the newest weekly dump
scripts/restore-drill.sh --yes --file x.dump --scratch-url postgres://postgres:...@<branch-host>:5432/postgres
```

It downloads the dump with your own `gcloud` login, creates `aarogyam_drill_<time>` on the scratch
server (a local Postgres 17, or a Supabase branch; it refuses the production host), prepares the
`extensions` schema and any roles the dump grants to, restores with `--exit-on-error`, then
reports: dump age, the accounts dump read back, one random patient file restored from `files/`, restore time, every table's row count, organizations present, no patient
without an organization, row-level-security policies present, and the migration ledger against
`db/migrations`. Exit status 0 only on PASS; the scratch database is dropped (`--keep` keeps it).
Run it after the first backup and then monthly; add the date to `docs/handoff.md`.

### Erasure

A patient file deleted in the product is deleted in Supabase Storage, but its copy stays in
`files/` (and any database or accounts dump stays until it ages out, 14 or 56 days). When a
deletion must be total, also run
`gcloud storage rm gs://<bucket>/files/<clinic id>/<attachment id>` (you hold the rights; the
backup accounts cannot delete).

### Restoring for real

1. Stop writes: scale the API to zero (`gcloud run services update aarogyam-api --max-instances 0 ...`).
2. Pick the dump (`gcloud storage ls gs://<bucket>/daily/`), run the drill on it first.
3. Same project, data damaged: restore into a new database on the same Supabase project, check it,
   then swap names or repoint `aarogyam-db-url` and `aarogyam-db-owner-url` (new secret
   versions). New project: create it in `ap-south-1`, create roles `app_user` and `aarogyam_api`
   (migration 0002 shows how; set the login password), create the `extensions` schema with
   `btree_gist`, `btree_gin`, `pg_trgm`, then `pg_restore --no-owner --no-privileges --exit-on-error`
   as the owner and re-apply grants by running `aarogyam migrate` (the ledger is restored, so it
   applies only what is newer).
4. Accounts, new project only: the product links people to sign-in accounts by
   `aarogyam.users.auth_uid` = `auth.users.id`. Restore the accounts first so the ids match and
   nothing needs re-linking:
   `pg_restore --data-only --no-owner --dbname <new owner url> auth-<time>.dump`
   (`auth.users` then `auth.identities`; the new project's own tables must be empty of those
   ids). If accounts were re-created another way (people re-invited or signed in again, so the
   ids differ), re-link memberships by email, then check no product user is left unlinked:
   `update aarogyam.users u set auth_uid = a.id from auth.users a where lower(a.email) = lower(u.email);`
   `select count(*) from aarogyam.users u where not exists (select 1 from auth.users a where a.id = u.auth_uid);`
5. Files: copy `files/` back into the Supabase bucket (`gcloud storage cp -r gs://<bucket>/files/ <local>` then
   upload with the Storage API or dashboard, keeping the `<clinic id>/<attachment id>` paths).
6. Redeploy (`scripts/cloud-run-deploy.sh`) so revisions pick up the new secret versions, scale
   back up, sign in, open a patient.

## Costs

Free: Cloud Run jobs (a few minutes a night), Cloud Scheduler (3 jobs free; the outbox, database
backup and files copy use all three, a fourth would cost about USD 0.10 a month), uptime checks, alert policies and email, the log-based metric, Error Reporting (with
Cloud Logging's 50 GB a month), Cloud Build (2,500 minutes a month).

**Could cost money:** Cloud Storage in `asia-south1`. The always-free 5 GB covers only US
regions. 22 retained dumps of a 20 MB database is under 0.5 GB, about USD 0.01 a month; it grows
with the database (the Supabase free plan caps it at 500 MB, so at most about USD 1 a month).
Cloud Build keeps its source upload in a US multi-region bucket (about 10 MB) and the backup image
adds about 100 MB to Artifact Registry's free 0.5 GB. The existing USD 1 budget alert covers all of this.

## Runbook

| Alert | First look |
|---|---|
| Uptime failing | Open the address. `gcloud run services describe aarogyam-api`; `scripts/deploy-workers.sh` if the Worker lost its origin. A clinic Worker that was never created fails only that check. |
| Cloud Run 5xx / error events | Console, Error Reporting (grouped by route), then `sk request <request_id>` or `jsonPayload.request_id="..."` in Logging. |
| Backup job failed | `gcloud run jobs executions list --job aarogyam-backup --region asia-south1`; logs of the failed execution. Usual causes: owner URL rotated (new secret version), database paused, `pg_dump` older than the server (bump `deploy/backup/Dockerfile`, re-run `ops-setup.sh --yes`). Run the job by hand once fixed. |

## Tests

`cargo test -p aarogyam-api` covers the error event shape, the scrubber, the client-error
endpoint (no sign-in, per-IP limit, size limit, nothing but a log line) and `5xx` reporting with
request IDs (`tests/ops.rs`); `pnpm --filter @aarogyam/app-kit test` the browser helper.
`scripts/ops-selftest.sh` runs `bash -n`, shellcheck and dry runs of both scripts against a fake
`gcloud`, and with `OPS_SELFTEST_DB_URL=postgres://owner@localhost/<migrated db>` also takes a
backup and restores it.
