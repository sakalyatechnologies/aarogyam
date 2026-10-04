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
