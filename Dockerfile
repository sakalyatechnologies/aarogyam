# syntax=docker/dockerfile:1.7
#
# Image for the `aarogyam` binary: `serve` (the API, on $PORT) and the operator commands
# (`migrate`, `outbox drain`). Built remotely by Cloud Build (scripts/cloud-run-deploy.sh) or
# any BuildKit. See docs/deploy.md.
#
# Builder and runtime pin the same Debian release (bookworm / Debian 12) so the glibc the binary
# was linked against is the one it runs on. `sakalya-backend` is a private git dependency: a
# BuildKit secret carries a read-only token into the one RUN step that fetches and compiles, and
# only there. It is passed through git's environment config, so it is never written to a file or
# a layer, and the builder stage is not shipped anyway.
#
# No cargo-chef: Cloud Build starts from an empty cache every time, so a dependency layer would
# only add a `cargo install` to each build.

ARG RUST_VERSION=1.99

FROM rust:${RUST_VERSION}-slim-bookworm AS builder
# git: cargo fetches sakalya-backend with it. The slim image has none.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV SQLX_OFFLINE=true \
    CARGO_NET_GIT_FETCH_WITH_CLI=true \
    CARGO_TERM_COLOR=never
RUN --mount=type=secret,id=git_token \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:$(cat /run/secrets/git_token)@github.com/.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/" \
    cargo build --release --locked -p aarogyam-server --bin aarogyam \
    && cp target/release/aarogyam /app/aarogyam

# Distroless: no shell, no package manager, non-root (uid 65532). TLS roots are included.
FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/aarogyam /app/aarogyam
# The Supabase database URLs say sslrootcert=config/supabase-ca.crt, relative to /app.
COPY config/supabase-ca.crt /app/config/supabase-ca.crt
ENV PORT=8080
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/aarogyam"]
CMD ["serve"]
