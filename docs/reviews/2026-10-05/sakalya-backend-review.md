# sakalya-backend — code review

**Version reviewed:** 0.2.2 (from `sakalya-all_0_ozws.zip`, inspected 2026-10-05)
**Scope:** `sakalya-backend` only (9 crates, ~11,800 lines of Rust). `sakalya-mobile`, `sakalya-web`, `sakalya-e2e` were in the archive but not reviewed.
**Method:** full read of all `src/`, integration tests, workspace config, CI, docs, and the repo's own rulebook (`AGENTS.md` + `docs/guidelines/*`). Three parallel deep-dives covered crate pairs; the two High-severity findings below were re-verified by direct code reading. **I could not compile or run tests** (no Rust toolchain on my machine) — one finding below is flagged as "confirm by running."

## Verdict

This is a genuinely well-built foundation — the security-critical paths (JWT verification, tenant isolation, edge trust, rate limiting math) are designed correctly and tested against adversarial cases, and the repo's own hard rules are honored in production code. **Not yet production-ready**: two High findings are silent security-control failures (a rate-limit rule shape that never fires, and a TLS downgrade via a copied URL param). Fix those two plus the error-taxonomy gap, and this is in good shape to build on.

## High

### H1. Throttle route-template rules silently never apply with the documented wiring

**Files:** `crates/sakalya-throttle/src/middleware.rs:66-74`, `crates/sakalya-throttle/src/lib.rs:54-56`, `crates/sakalya-throttle/src/throttle.rs:38-39`, `crates/sakalya-throttle/tests/middleware.rs:229-252`

**Evidence.** The middleware reads the route from `MatchedPath`:

```rust
// The route template, such as `/api/v1/patients/{id}`; the raw path when nothing matched.
let route = parts
    .extensions
    .get::<MatchedPath>()
    .map_or_else(|| parts.uri.path(), MatchedPath::as_str);
```

But every doc example wires the middleware with `Router::layer(...)` (`lib.rs:54-56`), which runs **before** axum routing — `MatchedPath` is only populated for `route_layer` middleware and handlers. So `route` is always the raw path, and rule matching is pure prefix matching (`throttle.rs:38-39`: `route.starts_with(prefix)`). A rule configured per the docs as `on_paths(&["/api/v1/patients/{id}"])` never matches `/api/v1/patients/1`, because the literal `{id}` appears in no real path. The protection an operator configured simply doesn't exist, with no warning logged.

The repo's own test contradicts the wiring: `tests/middleware.rs::rules_match_the_route_template` expects 429s from template matching but wires the app with `.layer(...)` (lines 66-77) — by the logic above that test cannot pass as written.

**Why it matters:** a rate limit an operator believes is protecting `/patients/{id}` (or sign-in/OTP endpoints) is silently unenforced. This is the worst kind of security bug — the control exists in config and dashboards but not in reality.

**Fix (pick one, then make docs, code, and tests agree):**
1. Change the doc examples to wire via `Router::route_layer` (post-match, `MatchedPath` available), and explicitly document the tradeoff: `route_layer` doesn't cover unmatched paths (404s bypass throttling).
2. Or change the contract to raw-path prefixes, fix the docs that promise template matching (`lib.rs:22`, `config.rs:108-111`), and fix/replace the template test.

**Confirm by running:** `cargo test -p sakalya-throttle` — I could not compile here; the analysis above says the template test must fail, but run it to see which side is actually wrong.

### H2. `?sslmode=disable` in `DATABASE_URL` silently downgrades TLS for remote hosts

**File:** `crates/sakalya-db/src/tls.rs:51-56`

```rust
let mode = match mode {
    Some(mode) => Some(mode.into()),
    None if url_sets_ssl_mode(url) => None,   // URL wins, even for remote hosts
    None if is_local(&options) => Some(PgSslMode::Prefer),
    None => Some(PgSslMode::VerifyFull),
};
```

**Evidence.** When the URL contains any `sslmode`/`ssl-mode` param, `apply()` returns `None` and the URL's value is honored verbatim — with no locality check. The existing test only covers `sslmode=disable` on `localhost`. The dangerous case is a staging/prod `DATABASE_URL` copy-pasted from local dev carrying `?sslmode=disable`: TLS verification is dropped silently, no log line. Your own security guideline says only a same-machine database may skip verification.

**Why it matters:** `DATABASE_URL` comes from the environment/secret manager and is exactly the string that gets copied between environments. One stale query param = plaintext credentials and patient data on the wire.

**Fix:** in `apply()`, when `!is_local(&options)` and the URL requests `disable` or `prefer`, return a `Configuration` error telling the operator to use explicit `DbConfig::with_ssl_mode` if they really mean it. Keep honoring the URL for `verify-ca`/`verify-full`/`require`. Add the missing test: remote host + `sslmode=disable` → error.

### H3. `ConfigError` and `TelemetryError` have no `kind()` enum — violates your own error rule

**Files:** `crates/sakalya-config/src/lib.rs:135`, `crates/sakalya-telemetry/src/lib.rs:189`

**Evidence.** `docs/guidelines/rust.md` requires "one error struct per crate or module, built with `thiserror`, exposing a `kind()` enum." Both structs are thiserror-built but carry only a pre-formatted message string. A product cannot distinguish "missing key" from "wrong type" from "unknown environment" without string-matching — so startup diagnostics ("`DATABASE_URL` is missing" vs "`HTTP__PORT` is not a number") can't be rendered well, and a product can't tell "bad filter in config — abort boot" (fatal) from "runtime reload failed — keep serving" (non-fatal) in telemetry.

**Fix:** add `#[non_exhaustive] pub enum ConfigErrorKind { MissingKey, InvalidValue, UnknownEnvironment }` (and `TelemetryErrorKind { InvalidFilter, ReloadFailed, AlreadyInitialized }`), store on the struct, expose `pub const fn kind()`. Parse the kind out of the figment error in `From<figment::Error>` (figment exposes the key path; fall back to `InvalidValue`).

## Medium

### M1. `ApiError::new` lets callers break the 5xx non-leak invariant
**File:** `crates/sakalya-http/src/error.rs:33-41`, `236-252`. `new()` is public and `into_response` sends `self.message` verbatim for every kind — so `ApiError::new(ErrorKind::Internal, "db", conn_string)` ships internals to the client, contradicting the type's own docs ("for `ErrorKind::Internal`/`Unavailable`, the client gets a generic message and the cause is logged"). **Fix:** in `into_response`, substitute the generic message for server faults regardless of `self.message`; or make `new` `pub(crate)`.

### M2. `Db::pool()` is a public unscoped escape hatch
**File:** `crates/sakalya-db/src/db.rs`. Nothing in the type system stops product code from running tenant queries on the raw pool, bypassing RLS. Safe today only because of *database grants* (login role has no table grants — asserted by `queries_outside_a_scope_are_denied`), which are invisible at code-review time: one late-night `GRANT SELECT ON patients TO myapp_api` silently voids tenant isolation. **Fix (pick one):** remove/narrow `pool()` (a wrapper type with a fixed operation allowlist), or add a startup self-test asserting the login role gets `Forbidden` on a canary table so a grant regression fails loudly.

### M3. Telemetry `set_filter_for` bumps the generation counter before validating
**File:** `crates/sakalya-telemetry/src/control.rs:69-70`. The generation bump (which cancels the pending auto-restore) happens *before* `self.apply(directives)?` parses. A fat-fingered filter string during a timed debug window returns `Err` but the scheduled restore is already cancelled — the service keeps the old filter with no auto-restore and no error about the cancellation. **Fix:** parse first, bump second (same reorder at lines 52-54 for `set_filter`).

### M4. Telemetry `set_filter_for` panics without a Tokio runtime
**File:** `crates/sakalya-telemetry/src/control.rs:72`. `tokio::spawn` panics outside a runtime — a panic in library code, banned by hard rule 3; a doc comment doesn't satisfy it the way a `Result` does. **Fix:** `if tokio::runtime::Handle::try_current().is_err() { return Err(TelemetryError::no_runtime()); }` before spawning (new `TelemetryErrorKind` variant per H3).

### M5. `Throttle::check` fails open on unknown rule names
**File:** `crates/sakalya-throttle/src/throttle.rs:208-214`. A typo'd rule name logs a warning and *allows* the request — for OTP/sign-in rules this silently disables the limit. **Fix:** fail closed (return `ThrottleError`), or take a typed rule handle instead of a string.

### M6. Unbounded in-memory counter growth under unique-key floods
**File:** `crates/sakalya-throttle/src/store.rs:36-56`. Cleanup (`retain` every 10k new keys) only removes *refilled* keys; a flood of fresh IPs/keys keeps every entry since their TATs are always in the future. Slow-burn memory exhaustion aimed at the baseline `ip` rule meant to stop floods. **Fix:** cap entries (e.g. 100k), evicting smallest-TAT-first.

### M7. Throttle header-key values used raw — budget multiplication
**File:** `crates/sakalya-throttle/src/middleware.rs:82-86`. `value.to_str().ok()` verbatim — case/whitespace variants (`ABC` vs `abc`) get separate buckets, so anyone controlling the header (e.g. a device ID) multiplies their budget by rotating case. **Fix:** trim + lowercase before counting.

### M8. Throttle bypass header not marked sensitive
**File:** `crates/sakalya-http/src/layers.rs:130-135`. `authorization`, `cookie`, `set-cookie`, and the edge secret are marked sensitive, but not `x-sakalya-throttle-bypass` — a 32-byte secret sent on every canary request; any debug-level header logging leaks it. (`sakalya-http` can't name the constant — circular dep.) **Fix:** add `extra_sensitive_headers: Vec<HeaderName>` to `HttpConfig`, or document the requirement in `sakalya-throttle`'s crate docs.

### M9. The `route` span field is always `"unmatched"` — same root cause as H1
**File:** `crates/sakalya-http/src/layers.rs:151-155`. `make_span` reads `MatchedPath`, but the `TraceLayer` is applied via `Router::layer` (lines 136-147), i.e. pre-match. The `http.request` span's `route` field — documented at `layers.rs:90` and relied on by `observability.md`'s "latency by route" dashboards — is dead data. **Fix:** add a tiny inner middleware via `route_layer` that records `route` from `MatchedPath`, or move the trace layer to `route_layer` (accepting that fallback 404s lose spans).

### M10. `sk` silently truncates the file at the first non-UTF-8 line or I/O error
**File:** `crates/sk/src/source.rs:124`. `.map_while(Result::ok)` stops iteration on the first `Err` — but `BufRead::lines()` yields `Err` on invalid UTF-8 too, so one corrupt line drops *every line after it*, while the module doc promises "lines that are not JSON from our services are skipped." **Fix:** `.filter_map(Result::ok)`; optionally count and print `sk: skipped N unreadable lines` to stderr.

## Low

- **L1.** `Id<T>` documents a v7 invariant it doesn't enforce (`crates/sakalya-types/src/id.rs:14` vs `parse`/`from_uuid`/`Deserialize` accepting any version). A v4 UUID from a URL parses fine and silently loses the time-ordering the type advertises. *Fix:* enforce `uuid.get_version() == Some(Version::SortRand)` in `parse`, or soften the docs.
- **L2.** `ConfigError` embeds figment's raw error text (`crates/sakalya-config/src/lib.rs:153`). Safe today (env vars are strings; `SecretString` only fails on non-string input), but one `Deserialize` impl away from echoing a secret into startup logs. *Fix:* strip values from the figment error, or add a test asserting the `Display` never contains a fake secret.
- **L3.** `PhoneE164::parse` validates format + length, not the numbering plan (`crates/sakalya-types/src/phone.rs:50`) — `+911234567890` passes but isn't diallable. *Fix:* document the limitation on `parse`.
- **L4.** `CallingCode::new` accepts any `u16` (`crates/sakalya-types/src/phone.rs:25`); real codes are 1–999. *Fix:* `assert!(code <= 999)` in the const fn.
- **L5.** Product concepts leak into shared-crate docs, against `AGENTS.md`: `crates/sakalya-telemetry/src/fields.rs:8` ("for Aarogyam, the clinic"), `crates/sakalya-telemetry/src/cloud.rs:6-8` (`"patient viewed"` example), `crates/sakalya-telemetry/src/control.rs:15` (`aarogyam_notify` filter example). Doc-only, easiest to fix: use product-neutral examples.
- **L6.** `sk slow` counts completion lines without `latency_ms` as 0 ms (`crates/sk/src/source.rs:125`), dragging p50/p95 down. *Fix:* `filter_map` on `latency_ms` instead of `unwrap_or_default`.
- **L7.** `JwksServer::start` silently drops the serve task's `Result` (`crates/sakalya-testkit/src/jwks.rs:65`) — post-bind failures hang tests confusingly. *Fix:* `tracing::warn!` on `Err`.
- **L8.** `TestClaims` uses `String` where the guideline says `Box<str>` (`crates/sakalya-testkit/src/issuer.rs:24-43`). Test-only and cosmetic, but agents copy patterns from testkit. *Fix:* switch the four fields.
- **L9.** `JwtVerifier::shared_secret` has no guardrail against production use (`crates/sakalya-auth/src/verifier.rs`). HS256 is correctly pinned and docs say "local development," but nothing stops a product wiring it in staging/prod. *Fix:* `tracing::warn!` on construction, or rename.
- **L10.** `bearer_token` accepts tokens with internal whitespace (`crates/sakalya-auth/src/extract.rs:8`) — `"Bearer abc def"` reaches the verifier, failing later as `Malformed`. *Fix:* reject whitespace/control chars at extraction.
- **L11.** `cookie_token` doesn't trim or unquote values (`crates/sakalya-auth/src/extract.rs:17`) — trailing spaces / RFC 6265 quoted values cause spurious verification failures. *Fix:* trim + strip one layer of quotes.
- **L12.** `22P02` (bad input syntax) maps to 500 (`crates/sakalya-db/src/error.rs`, `kind_for_sqlstate`). Defensible (products must parse at the boundary per the strong-types rule), but a 400 would be friendlier.
- **L13.** `CatchPanicLayer` sits mid-stack, not outermost (`crates/sakalya-http/src/layers.rs:136-147`) — layers 1–7 sit outside it, so a panic there drops the connection instead of the documented 500. *Fix:* move outermost per tower_http guidance, or scope the doc claim.
- **L14.** Throttle bypass use is never logged (`crates/sakalya-throttle/src/middleware.rs:60-66`) — canary traffic is invisible to auditing. *Fix:* debug/info line (rule set bypassed, never the token).
- **L15.** `MemoryCounters`/`Counters` derive `Debug` over raw keys (`crates/sakalya-throttle/src/store.rs:27-34`) — a stray `debug!(?throttle)` dumps IPs and phone numbers (custom-rule keys are plaintext). *Fix:* redacted `Debug`.
- **L16.** Postgres counter table grows without bound unless the product runs the scheduled `cleanup()` (`crates/sakalya-throttle/src/throttle.rs:217`) — documented as "run it from a scheduled job," but it's a mandatory operational step that's easy to forget. *Fix:* call it out in `store_migration`'s docs.
- **L17.** Baseline `ip-auth` paths hardcode product route conventions (`/api/v1/auth/`, `/auth/` in `crates/sakalya-throttle/src/config.rs`) in a crate whose `AGENTS.md` requires product-agnosticism. *Fix:* genericize or label them example defaults.
- **L18.** Doctest models a bare `panic!` (`crates/sakalya-db/src/scope.rs:91`) without the `#[expect(clippy::expect_used, reason = "...")]` the rulebook requires. *Fix:* use the `#[expect]` attribute in the example.
- **L19.** Clock asymmetry undocumented: memory store is monotonic (NTP-immune); Postgres GCRA uses `clock_timestamp()` — a backward jump fails closed, a forward jump briefly over-admits. One doc line would set expectations.

## Nits

- `docs/architecture.md` and the `rust-ci.yml` header comment still reference tag `v0.1.0`; workspace is at `0.2.2`. Stale doc references.
- `sk` argument precedence undocumented: when both `--project` and `--file` are passed, the project wins (`crates/sk/src/main.rs`). One doc line.
- No test asserting `ThrottleConfig`'s `Debug` redacts `bypass_token`/`key_secret` (the `HttpConfig` mirror assertion exists in `tests/edge.rs`).
- `Rule::matches` is pure prefix matching: `/api/v1/auth` also matches `/api/v1/authentication`. Document the trailing-slash convention (`config.rs`).
- No automated dependency-update config spotted (no dependabot/renovate); combined with the "never run `cargo update`" rule, minor-version pins can go stale silently.

## Strengths (verified, not vague)

- **Your hard rules hold in production code:** zero `unwrap`/`expect`/`panic!`/`todo!` outside tests, zero `unsafe` (forbidden at workspace level), no `anyhow`, no `println!`. Every integration test file carries the sanctioned `#![expect(...)]` override with a reason.
- **JWT verification is done right:** algorithm confusion defeated two layers deep (allow-list + "the key decides the algorithm, never the token alone"), `kid` missing → reject without network fetch, unknown `kid` → one refetch per 30s, single-flight JWKS cache with stale-while-revalidate, locks never held across await, claims (`exp`/`iss`/`aud`/`sub`) all enforced with pinned issuer/audience and 30s leeway, anonymous denied by default, email redacted in `Debug` (tested).
- **Tenant isolation is done right:** fail-closed RLS (`app.tenant_id` unset → zero rows, never all rows — tested), scope setup is one pooler-safe round trip with injection-audited SQL, and the cancelled-future hole is closed (`after_release` closes connections left mid-transaction — with a dedicated test). This is the subtle bug most homegrown RLS wrappers miss.
- **Edge trust model is excellent:** `X-Forwarded-*` never believed without the 32-byte edge secret (constant-time compare), unverified forwarded headers stripped, single-valued visible-ASCII header values enforced, spoofing covered by tests.
- **GCRA is mathematically correct** in both the Rust and Postgres implementations (verified against the classic formulation, including the retry-after arithmetic); saturating arithmetic, consistent microsecond units; Postgres-store rules fail *closed* (503) on outage — the right call for sign-in/OTP.
- **Error hygiene:** 5xx → generic client message + full cause chain at `error!`; extractors use fixed messages that never echo input (tested with a fake diagnosis string); `ServerError` withholds messages for SQLSTATE classes that can quote values (tested that secrets never appear in the logged chain).
- **Types are real:** `Id<T>` is drop-check-safe; `Paise` does checked-only arithmetic with half-away-from-zero rounding via `i128`; `PhoneE164` masks in `Debug`/`Display` but serializes full; `Slug` enforces DNS-label rules.
- **CI matches the rulebook:** fmt → clippy (`-D warnings`, all targets/features) → tests (Postgres 17 service) → `cargo doc` (`-D warnings`) → `cargo-deny` + `cargo-machete`; the pre-commit hook runs the same gate locally.
- **Secrets scan:** the zip contains no `.env`/`.pem`/`.key` files; the only credential-like values are throwaway CI Postgres passwords for the ephemeral test container. Nothing real.
- Docs on 100% of public items (mechanically verified), explicit `#[doc(inline)]` re-exports (no globs), workspace dependency discipline intact, architecture doc's dependency diagram matches the actual crate graph.

## What I did not verify

- **Could not compile or run tests** (no Rust toolchain on this machine). H1's claim that the template test must fail is by code reading — run `cargo test -p sakalya-throttle` to confirm which side (docs or test) is wrong.
- `sakalya-mobile`, `sakalya-web`, `sakalya-e2e` were not reviewed.
- `cargo-deny`/`cargo-machete` results were not re-run; `deny.toml` policy itself was reviewed (sane: license allowlist, wildcards denied, multiple-versions as warning).

## Remediation plan

**Fix before product integration:**
1. H1 — decide `route_layer` vs raw-prefix contract; fix docs, code, and the template test together.
2. H3 — add `kind()` enums to `ConfigError`/`TelemetryError` (your rulebook requires it; products need it for startup diagnostics).
3. M1 — make `ApiError::new` unable to leak internals (`pub(crate)` or generic-message substitution in `into_response`).

**Fix before production:**
4. H2 — reject `sslmode=disable`/`prefer` from the URL for non-local hosts.
5. M2 — decide `Db::pool()`'s fate (narrow it or add the canary grant self-test).
6. M5 — fail closed on unknown throttle rule names; M6 — cap in-memory counters; M7 — normalize header keys.
7. M3, M4 — telemetry filter-restore ordering + no-runtime guard.
8. L5 — scrub product concepts from shared-crate docs (5-minute fix, keeps the agnosticism rule credible).

**Later:** the remaining Lows and Nits; doc-tag drift (`v0.1.0` → `v0.2.2`); dependabot/renovate for the pinned minor versions.
