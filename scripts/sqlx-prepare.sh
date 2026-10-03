#!/bin/sh
# Regenerates .sqlx/ (the query metadata that lets sqlx check queries without a database)
# against the local development database. Run after changing any sqlx::query! macro.
set -eu
export PATH="$HOME/.cargo/bin:$PATH"
DATABASE_URL="${DATABASE_URL:-postgres://aarogyam_owner@localhost:5432/aarogyam_dev}" \
SQLX_OFFLINE=false \
  cargo sqlx prepare --workspace -- --all-targets --all-features
