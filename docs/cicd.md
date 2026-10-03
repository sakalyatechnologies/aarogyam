# CI and CD

Push code, and the pipeline tests it, deploys it, and tells you where to look. The workflows here call reusable ones in `sakalya-platform`, so every Sakalya project behaves the same way.

## What happens when

| You do | Pipeline does | You see |
|---|---|---|
| Open or update a pull request touching the API | CI (fmt, clippy, tests with Postgres, docs, audit), build the image, deploy a **preview revision** on staging with no traffic | A PR comment with the preview's own URL, e.g. `https://pr-42---arogyam-api-….a.run.app` |
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

1. **GitHub:** create the `arogyam` and `sakalya-platform` repositories in the `sakalyatechnologies` organisation and push. In `sakalya-platform` settings, allow its workflows to be used by other repositories in the organisation (Settings → Actions → Access). Tag `v0.1.0`.
2. **Google Cloud:** create projects `arogyam-staging`, `arogyam-prod` and `sakalya-artifacts` under one billing account, with a ₹100 budget alert on each.
3. **Artifact Registry:** in `sakalya-artifacts`, create a Docker repository `services` in `asia-south1`. Give both environments' Cloud Run service agents read access.
4. **Workload Identity Federation:** one pool for GitHub, restricted to the `sakalyatechnologies` organisation; a deploy service account per project with Cloud Run Admin, Artifact Registry Writer (artifacts project only) and Logs Viewer.
5. **GitHub Environments:**
   - `artifacts`, `staging` and `production`, each with variables `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER` and `GCP_DEPLOY_SA`.
   - `production` requires your approval.
   - A repository variable `IMAGE_REGISTRY = asia-south1-docker.pkg.dev/sakalya-artifacts/services`.
6. **Cloudflare (when the web app starts):** an API token with Workers permissions, stored as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
7. **Supabase:** a free staging project now; the Pro production project when real patients are near. Database URLs go in Secret Manager, never in GitHub.

## Watching a deploy

- GitHub's job summary lists the URL, revision and image for every deploy.
- `sk errors --project arogyam-prod --service arogyam-api --since 30m` summarises errors after a release.
- `sk slow --project arogyam-prod --service arogyam-api` shows whether a release made anything slower.
