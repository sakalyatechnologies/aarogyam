# Aarogyam

*Ārogyaṁ dhana sampadā*: health is wealth.

A multi-specialty clinic platform: a portal and phone apps for doctors and their staff, specialty-specific views (starting with dental and general medicine), and later a patient app that brings records from every Aarogyam clinic together.

- What it is, who it is for, features and phases: [`docs/product.md`](docs/product.md)
- Rules for humans and agents: [`AGENTS.md`](AGENTS.md)
- How it fits together: [`docs/architecture.md`](docs/architecture.md)
- Data model: [`docs/data-model.md`](docs/data-model.md) and every table in [`docs/database.md`](docs/database.md)
- Decisions: [`docs/decisions.md`](docs/decisions.md)
- CI and CD: [`docs/cicd.md`](docs/cicd.md)

Shared Rust foundations (types, config, telemetry, HTTP, auth, database, test kit) live in [`sakalya-backend`](../sakalya-backend).

Status: design and guidelines only. Code starts with the foundation milestone in `docs/decisions.md`.

## Web

The clinic portal and the Sakalya console live in `web/`: a pnpm workspace with React, TypeScript, Vite and Tailwind. Until `@sakalya/tokens` and `@sakalya/ui` are published, clone [`sakalya-web`](../sakalya-web) next to this repository and install it once, because the apps link its packages' source.

```sh
(cd ../sakalya-web && pnpm install)
pnpm install
pnpm dev:console   # http://localhost:5174: fake data, development sign-in
pnpm check         # typecheck, lint, tests, build
```

Settings go in `web/apps/<app>/.env.local`: `VITE_API_MODE=fake|http` (default `fake`), `VITE_API_BASE_URL` (default: same origin, proxied to `localhost:8080` in dev), and `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` for email-code sign-in (otherwise development sign-in, never in a production `http` build).

