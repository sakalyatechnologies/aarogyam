# syntax=docker/dockerfile:1.7
#
# Image for the `aarogyam` binary (`serve` and `migrate`). See docs/deploy.md.
#
# Builder and runtime pin the same Debian release (bookworm / Debian 12) so glibc in the
# compiled binary matches the runtime's libc exactly (see docs/lessons-from-mydwarpal.md:
# "Docker: the same Debian release for builder and runtime"). `sakalya-backend` is a private
# git dependency (see Cargo.toml); a BuildKit secret carries a read-only token for it into the
# two RUN steps that fetch dependencies, and only those — it is never written into a layer or
# baked into the image.

ARG RUST_VERSION=1.99

FROM rust:${RUST_VERSION}-slim-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Cooking the recipe only touches dependency crates, so this layer is cached until a dependency
# (not product code) changes. It still needs the private-repo token to fetch sakalya-backend.
RUN --mount=type=secret,id=git_token \
    git config --global url."https://x-access-token:$(cat /run/secrets/git_token)@github.com/".insteadOf "https://github.com/" \
    && cargo chef cook --release --locked --recipe-path recipe.json \
    && git config --global --unset url."https://x-access-token:$(cat /run/secrets/git_token)@github.com/".insteadOf
COPY . .
ENV SQLX_OFFLINE=true
RUN --mount=type=secret,id=git_token \
    git config --global url."https://x-access-token:$(cat /run/secrets/git_token)@github.com/".insteadOf "https://github.com/" \
    && cargo build --release --locked --bin aarogyam -p aarogyam-server \
    && git config --global --unset url."https://x-access-token:$(cat /run/secrets/git_token)@github.com/".insteadOf \
    && cp target/release/aarogyam /app/aarogyam

# Distroless: no shell, no package manager, runs as non-root (uid 65532). ~30 MB on top of the binary.
FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/aarogyam /app/aarogyam
COPY config/supabase-ca.crt /app/supabase-ca.crt
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/aarogyam"]
CMD ["serve"]
