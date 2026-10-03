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

Status: the Cargo workspace and a server that migrates the database and answers health checks. Next: the foundation migrations, then tenancy, auth and the patients module (see `docs/decisions.md`).

## Quickstart

You need Rust (`rustup` installs the pinned toolchain), Postgres 17, and read access to the private `sakalya-backend` repository. Cargo fetches it with your git credentials when `~/.cargo/config.toml` sets `net.git-fetch-with-cli = true`.

```sh
brew services start postgresql@17         # or any Postgres 17 on localhost:5432
createdb aarogyam_dev
cargo run -p aarogyam-server -- migrate   # applies db/migrations as your OS user
cargo run -p aarogyam-server -- serve     # listens on localhost:8080
curl localhost:8080/healthz               # in another terminal: ok
```

Settings come from `config/local.toml`; `ARO_*` environment variables override them (see `.env.example`). Run `scripts/install-hooks.sh` once per clone for the pre-commit gate. To build against a local `sakalya-backend` checkout, add a `[patch."https://github.com/sakalyatechnologies/sakalya-backend"]` section to a `.cargo/config.toml` outside this repository.
