<!-- Copied from sakalya-backend. Edit it there, then run scripts/sync-guidelines.sh. -->

# Testing

## Layers

| Layer | Proves | Where | Runs |
|---|---|---|---|
| Unit | Rules, parsing, maths | `#[cfg(test)] mod tests` next to the code | Every commit |
| Integration | A crate's public API end to end, including HTTP and Postgres | `tests/` in each crate | Every pull request |
| End-to-end | Real user journeys through deployed services | Product repositories | After deploy to staging |
| Canary | Production still works | Scheduled job against the demo tenant | Every 15 minutes |

## Rules

- Test behaviour a caller can observe, not private implementation. (M-TAUTOLOGICAL-TESTS)
- A test name says what must be true: `rejects_slug_with_uppercase`, not `test_slug_2`.
- One reason to fail per test. Use table-driven tests for many inputs.
- No sleeping in tests. Use `tokio::time::pause` or wait on a signal.
- Tests that need Postgres use `#[sqlx::test]`, which creates a fresh database per test. They are marked `#[ignore = "needs DATABASE_URL"]` so `cargo test` stays offline; CI runs them with `-- --include-ignored`.
- Shared helpers (test telemetry, token minting, a local JWKS server) live in `sakalya-testkit`, used only as a dev-dependency.
- Product repositories add one mandatory test per endpoint: a member of tenant B must not be able to read tenant A's data.
