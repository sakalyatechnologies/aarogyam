<!-- Copied from sakalya-platform. Edit it there, then run scripts/sync-guidelines.sh. -->

# Keeping builds fast

Rust build times grow with code size unless the structure prevents it. These rules keep the edit-check loop under a few seconds.

## Structure

- **Many small crates.** Cargo rebuilds only crates that changed and the crates that depend on them. A change in a leaf crate rebuilds little. (M-SMALLER-CRATES)
- **Keep the dependency graph shallow.** `domain` must not depend on `sqlx`, `axum` or `tokio`. Heavy crates sit at the edges.
- **Generics stay out of hot public APIs.** Every generic instantiation is compiled in the calling crate. Prefer concrete types.
- **Proc macros are expensive.** `serde`, `sqlx::query!`, `utoipa` and `thiserror` are worth it. Avoid adding others.
- **Minimal features.** Declare dependencies with `default-features = false` and list the features used.
- **One version of each crate.** Run `cargo tree -d --workspace` after adding a dependency. If two versions appear, align on the one the ecosystem uses (tower-http is pinned to 0.6 because reqwest still uses it).
- **Check for unused dependencies** with `cargo machete` before a release.

## Commands

- Iterate with `cargo check -p <crate>`. It skips code generation and is several times faster than `build`.
- Test one crate with `cargo test -p <crate>`.
- Find slow crates with `cargo build --timings` and open the generated HTML report.
- `sqlx` compile-time queries run with `SQLX_OFFLINE=true`, using the committed `.sqlx` folder, so builds never need a database.

## Profiles

The workspace sets:

- `debug = "line-tables-only"` for our code and no debug info for dependencies in dev builds. Backtraces still show file and line.
- `incremental = true` (Cargo's default for dev).
- Release builds use thin LTO and strip debug info.

## Optional local speed-ups

- `sccache` shares compiled dependencies across repositories: `brew install sccache`, then set `RUSTC_WRAPPER=sccache`.
- On Linux CI, the `mold` linker cuts link time. The macOS default linker is already fast.

## CI

- `Swatinem/rust-cache` caches `target/` between runs.
- Clippy and tests run in the same job so dependencies compile once.
