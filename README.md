# Aarogyam

*Ārogyaṁ dhana sampadā*: health is wealth.

A multi-specialty clinic platform: a portal and phone apps for doctors and their staff, specialty-specific views (starting with dental and general medicine), and later a patient app that brings records from every Aarogyam clinic together.

- What it is, who it is for, features and phases: [`docs/product.md`](docs/product.md)
- Rules for humans and agents: [`AGENTS.md`](AGENTS.md)
- How it fits together: [`docs/architecture.md`](docs/architecture.md)
- Data model: [`docs/data-model.md`](docs/data-model.md) and every table in [`docs/database.md`](docs/database.md)
- API contract (generated): [`docs/api/openapi.json`](docs/api/openapi.json)
- Decisions: [`docs/decisions.md`](docs/decisions.md)
- CI and CD: [`docs/cicd.md`](docs/cicd.md)

Shared Rust foundations (types, config, telemetry, HTTP, auth, database, test kit) live in [`sakalya-backend`](../sakalya-backend).

Status: walking skeleton. The API serves sign-in, the clinic session, patients and Sakalya's console on a database with row-level security, and the clinic portal and console run against it locally. Where things stand and what's next: `docs/handoff.md`.

## Quickstart

You need Rust (`rustup` installs the pinned toolchain), Postgres 17, pnpm, and read access to the private `sakalya-backend` and `sakalya-web` repositories. Clone `sakalya-web` next to this repository (the web apps link its source). Cargo fetches `sakalya-backend` v0.2.0 itself, with your git credentials, once `~/.cargo/config.toml` has `[net]` `git-fetch-with-cli = true`.

```sh
brew services start postgresql@17         # or any Postgres 17 on localhost:5432
scripts/dev-db.sh                         # a Supabase-shaped owner and the aarogyam_dev database
cargo run -p aarogyam-server -- migrate   # migrations, as that owner
scripts/dev-db.sh --seed                  # two fictional clinics and a Sakalya admin
cargo run -p aarogyam-server -- serve     # http://localhost:8080 (curl localhost:8080/healthz)
```

Then the web apps, in another terminal:

```sh
(cd ../sakalya-web && pnpm install)
pnpm install
VITE_API_MODE=http pnpm dev:console       # http://console.localtest.me:5174: Sakalya console
VITE_API_MODE=http pnpm dev:portal        # http://sunrise.localtest.me:5173: Sunrise Dental's portal
```

Sign in with the development sign-in (pick a seeded person). Without `VITE_API_MODE=http` the apps run on fake data. Settings: `config/local.toml` and `ARO_*` variables for the API (`.env.example`), `web/apps/<app>/.env.local` for the apps (`VITE_API_MODE`, `VITE_API_BASE_URL`, and `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` for email-code sign-in). Run `scripts/install-hooks.sh` once per clone for the pre-commit gate.

Real sign-in locally: export `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env.supabase` (not the whole file: its database URLs point at the cloud), then `ARO_AUTH__MODE=supabase cargo run -p aarogyam-server -- serve`; dev tokens keep working. Make the founder console owner once, over the owner connection: `cargo run -p aarogyam-server -- admin grant-platform --email <founder email> --role owner` (it finds or creates their confirmed Supabase account; `--auth-uid <id>` skips Supabase).

Web checks: `pnpm check` (typecheck, lint, tests, build); `VITE_LIVE=1 pnpm vitest run --project portal live` drives both running dev servers against the API (it adds a patient and a clinic). After `docs/api/openapi.json` changes, run `pnpm --filter @aarogyam/api-client generate`. A clinic created in the console comes with the owner's invitation link, `http://<clinic>.localtest.me:5173/invite#<token>`: the token sits in the fragment, so it never reaches a server log.

