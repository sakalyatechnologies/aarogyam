# Deploy

Staging deploy of the API (Cloud Run) and the two web apps (Cloudflare Workers), all on free
tiers. See `docs/cicd.md` for the pipeline plan and `docs/architecture.md` for the trust
boundaries this deploy relies on (edge secret, `X-Forwarded-Host`, host-based tenancy).

## Demo: Cloudflare + local API

A same-day demo: the clinic portal and Sakalya console run on Cloudflare Workers; the API stays
on the founder's Mac, reached through a Cloudflare Tunnel. Nothing here needs Google Cloud. The
tunnel URL changes every run, so each redeploy passes it in; moving to Cloud Run later only means
passing a different `<api-origin>` — the Workers and their config don't change.

### One-time setup

1. **Cloudflare API token** (Workers permissions) and account ID, in git-ignored `.env.cloudflare`:
   ```
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   ```
2. **Supabase build vars** (skip entirely for a dev-sign-in-only demo — see below), in git-ignored
   `.env.supabase`:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable key>
   ```
3. `EDGE_SECRET` is generated the first time `scripts/deploy-workers.sh` runs and saved to
   git-ignored `.env.edge`. It is set as a Worker secret (`wrangler secret put`) and must also be
   given to the local API as `ARO_HTTP__EDGE_SECRET` (below) — the API refuses any request
   missing it, so Cloud Run or a laptop API can't be called directly, only through the Worker.

None of `.env.cloudflare`, `.env.supabase` or `.env.edge` are committed (`.gitignore` already
ignores `.env*` except `.env.example`). Nothing in this flow echoes their contents.

### Run it

```bash
# 1. Start the tunnel (keep it running in its own terminal).
scripts/tunnel-up.sh
# -> prints: Tunnel is up: https://xxxx-xxxx.trycloudflare.com

# 2. Point the local API at the edge secret and the demo hosts, then start it.
set -a; . ./.env.edge; set +a   # loads EDGE_SECRET
ARO_ENVIRONMENT=local \
ARO_HTTP__EDGE_SECRET="$EDGE_SECRET" \
ARO_HOSTS__PORTAL_HOST_TEMPLATE=aarogyam-portal.aarogyam.workers.dev \
ARO_HOSTS__APP=aarogyam-portal.aarogyam.workers.dev \
ARO_HOSTS__CONSOLE=aarogyam-console.aarogyam.workers.dev \
  cargo run -p aarogyam-server -- serve

# 3. Build and deploy both Workers, pointed at the tunnel.
scripts/deploy-workers.sh https://xxxx-xxxx.trycloudflare.com

# ...or, for a demo with no Supabase project wired up yet, use the API's dev-token sign-in:
DEMO_DEV_SIGNIN=1 scripts/deploy-workers.sh https://xxxx-xxxx.trycloudflare.com
```

`ARO_ENVIRONMENT=local` keeps `auth.mode = dev` legal (it's refused outside `local`) and keeps
`sqlx`'s local defaults; it does **not** skip the edge-secret check — that's enforced whenever
`ARO_HTTP__EDGE_SECRET` is set, in any environment. With `DEMO_DEV_SIGNIN=1` the web apps are
built without `VITE_SUPABASE_*`, so they fall back to the API's `/api/v1/dev/token` sign-in
(`auth.mode = dev`, local-only) instead of real Supabase Auth; drop the flag and fill in
`.env.supabase` once there's a real staging Supabase project.

### Map the demo clinic's host

Run once against the database the local API is pointed at (`ARO_DB__OWNER_URL`), as the schema
owner. Replace `sunrise` if the demo clinic uses a different slug.

```sql
-- Clinic doesn't exist yet: create it with the Workers host as its portal domain directly.
select app.create_clinic(
  'sunrise', 'Sunrise Dental', 'SD', 'dental',
  'aarogyam-portal.aarogyam.workers.dev'
);

-- Clinic already exists (e.g. created through the console): point its portal host at Workers.
update aarogyam.org_domains set is_primary = false
where org_id = (select id from aarogyam.organizations where slug = 'sunrise')
  and kind = 'portal' and is_primary;

insert into aarogyam.org_domains (org_id, hostname, kind, is_primary, verified_at)
select o.id, 'aarogyam-portal.aarogyam.workers.dev', 'portal', true, now()
from aarogyam.organizations o where o.slug = 'sunrise'
on conflict (hostname) do update set org_id = excluded.org_id, verified_at = now();
```

The console host (`aarogyam-console.aarogyam.workers.dev`) isn't in `org_domains` — it's read
straight from `ARO_HOSTS__CONSOLE`, same as locally.

### Smoke test

```bash
curl -s https://aarogyam-portal.aarogyam.workers.dev/ | head -c 200     # portal shell loads
curl -s https://aarogyam-console.aarogyam.workers.dev/ | head -c 200   # console shell loads
curl -s -o /dev/null -w '%{http_code}\n' https://aarogyam-portal.aarogyam.workers.dev/api/v1/me
# 401 (no token) is correct: it means the Worker reached the API through the tunnel.
```

### Rollback

`npx wrangler deployments list --name aarogyam-portal` (or `aarogyam-console`), then
`npx wrangler rollback --name <worker> <deployment-id>`. For the tunnel/local API, just stop and
restart `scripts/tunnel-up.sh` and re-run `scripts/deploy-workers.sh` with the new URL.

### Costs

Free: Workers (static assets + under 100k requests/day), a Cloudflare quick tunnel, and the local
API's compute (the founder's Mac). No Google Cloud spend in this path.

---

## Cloud Run (free trial account)

The API runs on Cloud Run in Mumbai (`asia-south1`, next to the Supabase database); the
Workers don't change except for being pointed at the new URL. Three scripts do the work, all
read-only until you confirm, and all accept `--dry-run` (prints every change instead of
making it). Nothing here has been run yet, and the image has never been built: the first
build is the real test (see "If the first build fails").

| Script | When | What |
|---|---|---|
| `scripts/cloud-run-setup.sh` | once | APIs, Artifact Registry, 3 service accounts, secrets, $1 budget |
| `scripts/cloud-run-deploy.sh` | every release | remote build, service, outbox job and schedule |
| `scripts/deploy-workers.sh <url>` | after a deploy that changed the URL | points the Workers at the API |

### Steps, from nothing to a working URL

1. **Create the account.** Go to <https://console.cloud.google.com> and start the free trial
   ($300 credit for 90 days; a card is required for identity, and in India Google may ask for
   a small refundable verification charge). A trial account is not charged when the credit
   or time runs out; it is paused until you click "Activate full account".
2. **Create a project** (project selector, New Project), for example `aarogyam-prod`. Note
   the *project ID* (it has a numeric suffix if the name was taken). Billing links to the
   trial automatically; if not, Billing, Link a billing account.
3. **Sign in on this Mac.** `gcloud auth login`, then `export PROJECT_ID=<project id>`.
4. **A read-only GitHub token** for the private `sakalya-backend` repository (cargo
   downloads it during the build). As the `sakalyatechnologies` owner: GitHub, Settings,
   Developer settings, Fine-grained tokens, only that repository, permission Contents:
   Read-only, 90 days. Put it in the git-ignored `.env.github` as
   `SAKALYA_BACKEND_READ_TOKEN=...`, or paste it when the setup script asks (hidden).
5. **Preview, then run the setup.**
   ```bash
   scripts/cloud-run-setup.sh --dry-run     # shows every change, makes none
   scripts/cloud-run-setup.sh               # lists the plan and asks before changing anything
   ```
   It reads `.env.supabase` and `.env.edge` (run `scripts/deploy-workers.sh` once first if
   `.env.edge` doesn't exist) and stores their values in Secret Manager without printing
   them. It creates a **$1 budget with email alerts at 50%, 90% and 100%**. If your billing
   account is in rupees it retries as 85 INR. A budget alerts; it cannot stop spending.
6. **Deploy.**
   ```bash
   scripts/cloud-run-deploy.sh
   ```
   Cloud Build compiles Rust on Google's machines (about 15-25 minutes the first time, and
   every time: there is no build cache). It prints the service URL and runs two checks:
   `/healthz` must be 200, and `/api/v1/me` must be 401 (no edge secret, refused by design).
7. **Point the Workers at it**, the portal and console and then one per clinic:
   ```bash
   scripts/deploy-workers.sh <service url>
   scripts/deploy-workers.sh <service url> aarogyam-<clinic>
   ```
   The clinic host mapping (`org_domains`) is unchanged: see "Map the demo clinic's host"
   above. Stop `scripts/demo-api.sh` and the tunnel; they are no longer needed.
8. **Check mail.** `gcloud run jobs execute aarogyam-outbox --region asia-south1` sends the
   queue now; `gcloud run services logs read aarogyam-api --region asia-south1` shows logs.

Database migrations are not part of these scripts: run `aarogyam migrate` against Supabase
from your Mac as today (it needs `ARO_DB__OWNER_URL`, which is deliberately not in Cloud Run).

### How it is set up

- **Service** `aarogyam-api`: minimum 0 and maximum 1 instance, 40 concurrent requests,
  512Mi, 1 vCPU billed only while a request runs, 30 s timeout, public URL (the edge secret,
  not the network, keeps everyone but the Workers out). It runs as `aarogyam-run`, which can
  read only its own secrets, not as the default account that has Editor on the project.
- **Settings** match `scripts/demo-api.sh` (Supabase sign-in, dev tokens off, the Workers'
  host names). The one difference: `ARO_HTTP__EDGE_HOST_HEADER` is **not** set. The Funnel
  workaround used `x-sakalya-host` because Tailscale overwrites `x-forwarded-host`; Cloudflare
  to Cloud Run doesn't, so the default `x-forwarded-host` is right.
- **Secrets** (Secret Manager, as environment variables): `aarogyam-db-url`
  (`ARO_DB__URL`), `aarogyam-edge-secret`, `aarogyam-supabase-secret-key`,
  `aarogyam-files-signing-key` (generated once), and `aarogyam-resend-api-key` if
  `.env.supabase` has `RESEND_API_KEY`. Re-run the setup to rotate one after changing the
  file, then redeploy.
- **Outbox sender**: a Cloud Run **job** (`aarogyam outbox drain`, once, then exit), started
  by **Cloud Scheduler every 2 minutes**. The alternative, a loop inside the API, needs an
  instance that never sleeps (min-instances 1), which is never free. A job costs nothing
  between runs: about 4 seconds of CPU per run is roughly 90,000 of the 180,000 free
  vCPU-seconds a month. Change the pace with `DRAIN_SCHEDULE='*/5 * * * *'
  scripts/cloud-run-deploy.sh`; an invitation email arrives within the interval.
- **Patient files** still go to `/tmp` inside the instance (lost when it stops). Object
  storage is open work in `docs/handoff.md`; don't upload real patient files until then.

### Costs to expect

- **$0 within the trial credit and the always-free tier.** Always free each month: Cloud Run
  2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds; Cloud Build 2,500
  minutes on the default machine; Artifact Registry 0.5 GB (the image is about 30 MB and
  the cleanup policy keeps 3); Secret Manager 6 secret versions; Cloud Scheduler 3 jobs per
  billing account. This deploy uses 1 service, 1 job and 1 schedule.
- **Pennies, not free, after the trial** and only if you upgrade: network egress out of
  India (the free allowance covers North America only; API replies are small JSON) and
  secret versions beyond six (about $0.06 each a month).
- **Not in this bill:** Supabase (free project), Cloudflare Workers (free plan), Resend (its
  own free tier).
- The $1 budget alert is the safety net. Check Billing, Reports, once in the first week.

### Update, roll back, tear down

```bash
scripts/cloud-run-deploy.sh                       # a new release
gcloud run revisions list --service aarogyam-api --region asia-south1
gcloud run services update-traffic aarogyam-api --region asia-south1 --to-revisions=<previous>=100
```

Tear down everything and stop all billing in one step: `gcloud projects delete $PROJECT_ID`
(kept for 30 days, so it can be restored; the budget goes with the project). To remove only
the API and keep the project:

```bash
gcloud scheduler jobs delete aarogyam-outbox --location asia-south1
gcloud run jobs delete aarogyam-outbox --region asia-south1
gcloud run services delete aarogyam-api --region asia-south1
gcloud artifacts repositories delete aarogyam --location asia-south1
for s in aarogyam-db-url aarogyam-edge-secret aarogyam-supabase-secret-key \
         aarogyam-files-signing-key aarogyam-resend-api-key sakalya-backend-read-token; do
  gcloud secrets delete $s --quiet; done
```

Then point the Workers back at a tunnel (`scripts/tunnel-up.sh`, `scripts/demo-api.sh`) or
a new URL with `scripts/deploy-workers.sh`.

### If the first build fails

The Dockerfile was reviewed by hand, not built (no Docker here). Read the log it prints, or
`gcloud builds list --region asia-south1`. Likely causes: the GitHub token cannot read
`sakalya-backend` (a `fatal: could not read Username` or 404 while fetching); the Rust image tag
`1.99` (set `ARG RUST_VERSION` to match `rust-toolchain.toml`); or a build timeout on the
2-vCPU machine (raise `timeout` in `scripts/cloud-run-deploy.sh`).

The older Cloud Build pipeline below (`cloudbuild.yaml`, `deploy/cloud-run/*.yaml`) is for the
staging project once CI resumes (`docs/cicd.md`). It is not needed for the trial deploy.

---

## Cloud Run + Cloudflare Workers (staging)

The API moves off the founder's Mac onto Cloud Run; the Workers don't change except for one
`--var API_ORIGIN:<cloud-run-url>` redeploy. Everything here is free tier. `docker` isn't
installed in this environment, so the Dockerfile and image build were reviewed by hand, not
built — build it once with real Docker before relying on it:
`DOCKER_BUILDKIT=1 docker build --secret id=git_token,env=GIT_TOKEN -t aarogyam-api:test .`
(`GIT_TOKEN` is a GitHub read-only token for the private `sakalya-backend` repo).

### One-time setup (run interactively; needs `gcloud auth login` first)

```bash
PROJECT=sakalya-clinic-staging
REGION=asia-south1

# 1. APIs
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com --project "$PROJECT"

# 2. Artifact Registry (scanning off, a cleanup policy, Mumbai region)
gcloud artifacts repositories create services --repository-format=docker \
  --location="$REGION" --project "$PROJECT" --disable-vulnerability-scanning \
  --description="aarogyam container images"

# 3. Least-privilege runtime service accounts (not the default compute account, which has Editor)
gcloud iam service-accounts create aarogyam-api-run --project "$PROJECT" \
  --display-name="aarogyam-api Cloud Run runtime"
gcloud iam service-accounts create aarogyam-migrate-run --project "$PROJECT" \
  --display-name="aarogyam migrate job runtime"
# Both need Secret Manager access to the secrets they read (below); neither needs more.
for SA in aarogyam-api-run aarogyam-migrate-run; do
  for SECRET in aarogyam-db-url aarogyam-edge-secret aarogyam-files-signing-key aarogyam-db-owner-url; do
    gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
      --member="serviceAccount:${SA}@${PROJECT}.iam.gserviceaccount.com" \
      --role="roles/secretmanager.secretAccessor" 2>/dev/null || true  # skip secrets a SA doesn't use
  done
done

# 4. A deploy account needs iam.serviceAccountUser on the two runtime accounts above, plus
#    Cloud Run Admin and Artifact Registry Writer. Cloud Build's own service account already has
#    Cloud Build's default roles; grant it these two:
CLOUDBUILD_SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')@cloudbuild.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${CLOUDBUILD_SA}" --role="roles/run.admin"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${CLOUDBUILD_SA}" --role="roles/iam.serviceAccountUser"

# 5. Secrets, from a git-ignored .env.supabase (DB_URL, DB_OWNER_URL, SAKALYA_BACKEND_READ_TOKEN,
#    SUPABASE_SECRET_KEY) — never echoed
set -a; . ./.env.supabase; set +a
printf '%s' "$DB_URL" | gcloud secrets create aarogyam-db-url --project "$PROJECT" --data-file=-
printf '%s' "$DB_OWNER_URL" | gcloud secrets create aarogyam-db-owner-url --project "$PROJECT" --data-file=-
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create aarogyam-edge-secret --project "$PROJECT" --data-file=-
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create aarogyam-files-signing-key --project "$PROJECT" --data-file=-
# A read-only GitHub token for the private sakalya-backend repo (cargo's git dependency, and
# cloudbuild.yaml's GIT_TOKEN secretEnv):
printf '%s' "$SAKALYA_BACKEND_READ_TOKEN" | gcloud secrets create sakalya-backend-read-token --project "$PROJECT" --data-file=-
# supabase-secret-key: provisioned for future Supabase management-API use. No ARO_* field reads
# it today (config.rs has no such setting), so it isn't mounted on the Cloud Run service yet.
printf '%s' "$SUPABASE_SECRET_KEY" | gcloud secrets create supabase-secret-key --project "$PROJECT" --data-file=-

# 6. Budget alert (all free tier, but catch surprises)
gcloud billing budgets create --billing-account="$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)')" \
  --display-name="aarogyam staging" --budget-amount=100INR \
  --threshold-rule=percent=0.5 --threshold-rule=percent=1.0

# 7. Cloud Build trigger (or skip and use scripts/deploy-api.sh / gcloud builds submit by hand)
gcloud builds triggers create github --project "$PROJECT" \
  --repo-name=aarogyam --repo-owner=sakalyatechnologies --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --substitutions=_SUPABASE_PROJECT_REF=<project-ref>
```

Fill in `<project-ref>` once the staging Supabase project exists, and replace the placeholder
digests in `deploy/cloud-run/*.yaml` — `cloudbuild.yaml` does this automatically on every build,
so those two files only need editing for a one-off `gcloud run services replace` by hand.

### Deploy

```bash
# API: either push to main with the trigger above, or run it by hand:
scripts/deploy-api.sh <supabase-project-ref>

# Workers: point the existing deploy script at the Cloud Run URL instead of a tunnel.
CLOUD_RUN_URL="$(gcloud run services describe aarogyam-api --region asia-south1 \
  --project sakalya-clinic-staging --format='value(status.url)')"
scripts/deploy-workers.sh "$CLOUD_RUN_URL"
```

### Map the demo clinic's host

Same `org_domains` SQL as the tunnel demo above — the Workers' public hosts don't change when
the API moves to Cloud Run, so if it's already run once there's nothing more to do here.

### Smoke test

```bash
API_URL="$(gcloud run services describe aarogyam-api --region asia-south1 --project sakalya-clinic-staging --format='value(status.url)')"
curl -s -o /dev/null -w '%{http_code}\n' "$API_URL/healthz"             # 200 direct (no edge secret needed on /healthz)
curl -s -o /dev/null -w '%{http_code}\n' "$API_URL/api/v1/me"           # 401: no edge secret, refused as designed
curl -s -o /dev/null -w '%{http_code}\n' https://aarogyam-portal.aarogyam.workers.dev/api/v1/me  # 401: reached the API, no token
```

### Rollback

```bash
# API: list revisions, then move traffic back to the one that was serving before.
gcloud run revisions list --service aarogyam-api --region asia-south1 --project sakalya-clinic-staging
gcloud run services update-traffic aarogyam-api --region asia-south1 --project sakalya-clinic-staging \
  --to-revisions=<previous-revision>=100
# Migration job: migrations are expand-then-contract (docs/architecture.md), so a rollback never
# needs a database change; re-running the job is safe if it ever does.
```

### Costs

Cloud Run: free tier covers staging traffic at min 0 / max 2 instances with CPU only while
handling requests. Artifact Registry and Cloud Build: free tier (2,500 build-minutes/month).
Workers: free plan. Supabase: free project. The ₹100 budget alert above is the only thing to
watch; nothing here is expected to bill.
