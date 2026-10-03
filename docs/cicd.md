# CI and CD

> **Parked on 3 Oct 2026** until staging is needed. Every workflow runs only when started by hand. Until then the local pre-commit hook is the quality gate: format, clippy with warnings as errors, all tests including the database tests, cargo-deny, and the schema-docs check.

## When we resume

GitHub Free gives private repositories no environments, environment secrets, branch protection or deploy approvals (checked against the GitHub API on 3 Oct), so the pipeline must not depend on them. MyDwarpal already works this way:

- **Build and deploy in Google Cloud Build,** triggered by pushes (2,500 free build minutes a month). `main` goes to production and a staging branch to staging; the mapping is committed in `cloudbuild.yaml`, with a guard that refuses to put any other branch on production. Cloud Build's GitHub connection can read private repositories.
- **GitHub Actions only for tests,** inside the 2,000 free minutes that all private repositories share.
- **Private library repositories** are read with a read-only token kept in Secret Manager.
- **Migrations** run (`aarogyam migrate`, as a Cloud Run job) before traffic moves.

### Fix before the first deploy (from the 3 Oct review)

- Add the migration step. Pull-request previews would share the staging database, so drop them.
- Replace the 10% canary, which proves nothing at pilot traffic and sleeps for 10 billed minutes, with a smoke test, a synthetic clinic journey, and a scripted rollback to the revision that had the most traffic.
- `--no-traffic` fails when creating a new service.
- The deploy account needs `iam.serviceAccountUser`. Run the service as its own runtime account, not the default compute account (which has Editor), from a committed service file with at most 2–3 instances.
- One service account and Workload Identity condition per environment (branch and workflow), since environment-scoped variables don't exist on the free plan.
- Docker: the same Debian release for builder and runtime, `# syntax` on line 1, and the binary built once in CI and copied into the image.
- Pin third-party actions by commit; set `permissions` and `timeout-minutes` on every workflow.
- Artifact Registry with scanning off and a cleanup policy; logs in an `asia-south1` bucket.

## Original design (reference; superseded where it relies on GitHub environments)

Push code, and the pipeline tests it, deploys it, and tells you where to look. The workflows here call reusable ones in `sakalya-backend`, so every Sakalya project behaves the same way.

## What happens when

| You do | Pipeline does | You see |
|---|---|---|
| Open or update a pull request touching the API | CI (fmt, clippy, tests with Postgres, docs, audit), build the image, deploy a **preview revision** on staging with no traffic | A PR comment with the preview's own URL, e.g. `https://pr-42---aarogyam-api-….a.run.app` |
| Merge to `main` | CI, build once, deploy that exact image to **staging** (smoke test, then 100%) | The job summary with URL and revision; staging is live in minutes |
| Approve the `production` deployment (one click in GitHub, also on the mobile app) | Deploy the **same image** to production at 10%, watch errors for 10 minutes, then 100%, or roll back automatically | The job summary; a failed canary leaves production on the previous revision |
| Close the pull request | Remove the preview tag | Nothing to clean up by hand |
| Change a website or the web app | Cloudflare build with a preview URL on the PR; merge deploys | A PR comment with the preview URL |
| Change `docs/schema/model.py` | CI checks `docs/database.md` was regenerated | A failing check if you forgot |

Previews cost nothing: Cloud Run tagged revisions without traffic scale to zero.

## Rules that make it safe

- **Build once, promote the digest.** Production runs the image staging tested, pinned by digest.
- **Migrations run before traffic moves** and are backward-compatible (expand, then contract), so a rollback never needs a database change.
- **Old apps keep working.** CI fails on breaking API changes (OpenAPI diff, added with the first endpoints).
- **No keys in GitHub.** Workflows sign in to Google Cloud through Workload Identity Federation.

## Workflows

| File | Trigger |
|---|---|
| `.github/workflows/ci.yml` | Pull requests and pushes that touch Rust, migrations or the schema model |
| `.github/workflows/deploy-api.yml` | Pull requests (preview) and merges to `main` (staging, then production on approval) |
| `.github/workflows/preview-cleanup.yml` | Pull request closed |
| Web and site deploys | Added with the first web app, using `deploy-cloudflare.yml` from the platform |

## One-time setup (about an hour, all free)

1. **GitHub (done 3 Oct):**
   - `sakalya-backend`, `aarogyam` and `sakalya-web` are private repositories under the `sakalyatechnologies` account. Thek10patil is a collaborator with write access.
   - `sakalya-backend` allows other repositories owned by this account to use its workflows, and is tagged `v0.1.0`.
   - In a personal account, only the owner can manage Actions secrets, environments and deploy approvals, so switch with `gh auth switch -u sakalyatechnologies` for those settings.
2. **Google Cloud:** create projects `sakalya-clinic-staging`, `sakalya-clinic-prod` and `sakalya-artifacts` under one billing account, with a ₹100 budget alert on each.
3. **Artifact Registry:** in `sakalya-artifacts`, create a Docker repository `services` in `asia-south1`. Give both environments' Cloud Run service agents read access.
4. **Workload Identity Federation:** one pool for GitHub, restricted to the `sakalyatechnologies` organisation; a deploy service account per project with Cloud Run Admin, Artifact Registry Writer (artifacts project only) and Logs Viewer.
5. **GitHub Environments (as the owner account):**
   - `artifacts`, `staging` and `production`, each with variables `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER` and `GCP_DEPLOY_SA`.
   - `production` requires your approval.
   - A repository variable `IMAGE_REGISTRY = asia-south1-docker.pkg.dev/sakalya-artifacts/services`.
6. **Cloudflare (when the web app starts):** an API token with Workers permissions, stored as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
7. **Supabase:** a free staging project now; the Pro production project when real patients are near. Database URLs go in Secret Manager, never in GitHub.

## Watching a deploy

- GitHub's job summary lists the URL, revision and image for every deploy.
- `sk errors --project sakalya-clinic-prod --service aarogyam-api --since 30m` summarises errors after a release.
- `sk slow --project sakalya-clinic-prod --service aarogyam-api` shows whether a release made anything slower.
