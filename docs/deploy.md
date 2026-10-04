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
ARO_HOSTS__PORTAL_DOMAIN=aarogyam-portal.aarogyam.workers.dev \
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

The full staging deploy — Dockerfile, Cloud Run service and migration job, Cloud Build pipeline,
and pointing the same Workers at the Cloud Run URL instead of a tunnel — is tracked separately and
lands in this section next.
