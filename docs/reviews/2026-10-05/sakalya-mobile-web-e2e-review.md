# sakalya-mobile · sakalya-web · sakalya-e2e — code review

**Source:** `sakalya-all_0_ozws.zip`, inspected 2026-10-05. Backend (`sakalya-backend`) was reviewed separately — see `sakalya-backend-review.md`.
**Method:** full read of all source, tests, configs, and each repo's own rulebook (AGENTS.md/CLAUDE.md/docs). Three parallel deep reviews, one per repo. **Nothing was compiled or run** (no Android SDK, no pnpm install, no browsers on this machine) — findings marked "confirm by running" rest on code/config analysis.
**Secrets:** no real secrets in any of the three repos. No `.env` files, no hardcoded API keys/tokens, no keystores, no `google-services.json`. (`local.properties` in mobile contains a dev-machine username — N3 below.)

## Cross-cutting themes

1. **The product-agnosticism rule is violated in every repo, including by the rulebooks themselves.** Backend had it in doc comments; web ships medical-specialty copy in *user-facing* theme strings (H2); e2e has it in docs/docstrings (L4); mobile has it in Compose previews and KDoc (L1); web's own AGENTS.md names "Aarogyam's clinic portal" two lines above banning product concepts (L1). The rule as written is unlivable — scope it ("no product concepts in `src/` and user-facing strings; docs may name consumers") or scrub everything. Recommend one pass across all four repos.
2. **macOS assumptions in shared hooks** (web N2, e2e N2): pre-commit hooks hardcode `/opt/homebrew/bin` — fine on a Mac, noise elsewhere.
3. **The security-critical paths are genuinely well built everywhere** — token storage (Keystore/Keychain done right), session lifecycle, log redaction, theme-parser hardening, host-safety policy. The findings below are real but the foundations are solid.

---

# sakalya-mobile

**Verdict:** A carefully built, security-conscious KMP library set — token storage, session management, and log redaction are genuinely well designed, and the repo's hard rules are honored in production code. Two Highs to fix before product integration.

## High

### M-H1. `SessionManager.refresh` holds the mutex across network I/O — every request stalls behind a refresh
**File:** `auth/src/commonMain/kotlin/com/sakalya/mobile/auth/SessionManager.kt:140-144`
```kotlin
override suspend fun refresh(rejected: AccessToken): RefreshResult =
    mutex.withLock {
        ...
        when (val refreshed = auth.refresh(current.refreshToken)) {  // network call under mutex
```
`accessToken()` (`:138`) — called by `BearerRefresh` on *every* HTTP request — takes the same mutex. While one refresh is in flight, all API traffic serializes behind it. The refresh has a 20s timeout, so a slow IdP stalls the whole app's networking for up to 20s, nearly exhausting the 30s request timeout of queued calls. `persist()` (`:190-191`, DataStore/Keychain I/O) is also under the mutex.
**Fix:** single-flight `Deferred` for the refresh itself (the pattern `RefreshFlights` already uses in `http`): guard only in-memory state transitions with the mutex, run `auth.refresh` + `persist` outside it, concurrent callers await the shared deferred. *Confirm with a slow-refresh runtime test.*

### M-H2. Outbox payloads live in plaintext SQLite with no backup-exclusion guidance
**Files:** `outbox/src/androidMain/.../OutboxDriver.android.kt`, `outbox/src/iosMain/.../OutboxDriver.ios.kt`, `outbox/README.md`
`outbox_item.payload TEXT NOT NULL` holds product-defined submission bodies — clinical content in a clinic app — protected by OS file encryption only. `secure-storage` documents backup exclusion (`secure-storage/README.md:23`); the outbox README has none, and Android Auto Backup uploads `sakalya_outbox.db` to Google Drive in plaintext by default.
**Fix:** add backup-exclusion guidance to `outbox/README.md` (`databases/sakalya_outbox.db`), and document the SQLCipher-vs-OS-protection tradeoff explicitly.

## Medium

### M-M1. `completeMagicLink` is open to login CSRF if the product doesn't verify the link's origin
**Files:** `auth/.../MagicLink.kt:60-95` (`parse`), `SessionManager.kt:completeMagicLink`. `parse` accepts *any* URL — never checks the host. An attacker mints a valid magic link for *their* session, sends it to a victim ("tap to view your report"); if the product passes the raw deep-link URL through, the victim's app signs in as the attacker and everything the victim enters lands in the attacker's account. The library can't know the product's deep-link host — but nothing says the check belongs in the product.
**Fix:** one KDoc paragraph on `completeMagicLink`/`MagicLink.parse`: "only pass links from the app's verified deep-link host; never pass arbitrary URLs."

### M-M2. `OutboxWorker.runOnce` holds its mutex across the product's `deliver` call
**File:** `outbox/src/commonMain/.../OutboxWorker.kt:43-58`. `runOnce()` holds `mutex` while `deliverer.deliver(item)` runs arbitrary product network code. A deliverer without its own timeout stalls the worker loop and blocks concurrent `runOnce()` callers. The mutex isn't needed for correctness: `markSending` is an atomic `UPDATE … WHERE status='pending'` check-and-set, so concurrent passes can't double-deliver.
**Fix:** scope the mutex to DB state transitions (expire + select due + `markSending`), or document that `OutboxDeliverer.deliver` must be bounded by a timeout.

### M-M3. `design-compose` has zero tests — violates hard rule 2
`design-compose/src/test` is an empty skeleton. AGENTS.md hard rule 2: "Every public behaviour has a `commonTest` test." Testable pure behaviors exist (`initialsOf` in `SkTone.kt:50+`, tone→color mapping, `SkTypography` scale); the other seven modules all have real suites.
**Fix:** unit tests for the pure functions; screenshot tests optional.

## Low

- **M-L1.** Product copy in `design-compose` (hard rule 1): `SkButton.kt:83,95` previews render `"Send prescription"`; `SkChip.kt:83` shows `"Allergy"`; `SkTone.kt:10-17` KDoc mentions "paid", "allergies". *Fix:* generic labels ("Primary action", "Status"), neutral KDoc.
- **M-L2.** Hardcoded dp values (hard rule 9): `SkChip.kt:39` (9.dp/3.dp), `SkFields.kt:107` (18.dp/13.dp) — not mappable to the `Spacing` token steps. *Fix:* add steps to `Spacing` or a component token.
- **M-L3.** `ios/SakalyaUI` is not a Swift package — docs overstate it; two broken README links. Only `SkTokens.swift` exists; no `Package.swift`, no components, no README — yet AGENTS.md:1 claims "one Swift package of SwiftUI components" and hard rule 10 requires dual Compose/SwiftUI components in the same change. `README.md:13-14` links to two READMEs that don't exist. *Fix:* build the SwiftUI kit or downgrade docs to "tokens only"; add the missing READMEs.
- **M-L4.** `signOut` races a concurrent refresh → orphaned provider session (`SessionManager.kt:173-177`). Snapshots session under mutex, calls `auth.signOut` outside it, then `endLocally`; a refresh landing between rotates the IdP pair, and `endLocally` discards the *new* local session whose IdP session was never revoked. *Fix:* re-check under the mutex after the network call.
- **M-L5.** `ConnectivityNetworkMonitor.onLost` blindly reports offline (`ConnectivityNetworkMonitor.kt:38-40`) even when another network is already default — requests fail fast during handover until capabilities correct it. *Fix:* recompute via `currentlyOnline()` in `onLost`.
- **M-L6.** No certificate pinning — documented choice, but for clinical data consider optional pin configuration in `HttpClientFactory`. Recommendation, not a defect.
- **M-L7.** Keystore/Keychain keys don't require user authentication — fine default, but no hook for biometric-gated sessions later. *Fix:* note the extension point in `secure-storage/README.md`.
- **M-L8.** `SecureSessionStore` deletes undecodable sessions; `version` unused (`SessionStore.kt:62-68`). A blob written by a newer app version after a downgrade → silent sign-out. *Fix:* check `version`; only delete known-version corruption.

## Nit

- **M-N1.** `log.debug` is dead: `minLevel` defaults to `Info`, zero `log.debug(...)` call sites in prod. Wire to build type or drop the level.
- **M-N2.** `SkChip.kt:33` — `text.uppercase()` uses device locale ("Waiting" → "WAİTİNG" in Turkish). Use `uppercase(Locale.ROOT)`.
- **M-N3.** `local.properties` is committed with a dev-machine username (`sdk.dir=/Users/…`). Add to `.gitignore`.
- **M-N4.** `SkSurfaces.kt:115` — `height(1.dp)` hairline hardcoded; accept with a named `Hairline` token.
- **M-N5.** `design/README.md` references external artifacts not in the repo (`BrandTheme.kt`, `aarogyam/docs/mockups/mobile.html`) — will rot. Link or inline.
- **M-N6.** `Submission.run` (`Idempotency.kt:39`) unsafe for concurrent `run()` — two in-flight attempts share one key and both rotate. Document "one at a time per `Submission`".

## Mobile strengths (verified)

- **Token storage done right.** Android: AES-256-GCM, Keystore key never leaves device, randomized IV, entry name bound as AAD, versioned format, tampered values read as *missing* not sign-out, I/O on `Dispatchers.IO`, `CancellationException` rethrown. iOS: Keychain with `ThisDeviceOnly`, update-in-place writes, correct `CFRelease` hygiene.
- **Session lifecycle fail-careful.** Rotated pairs persisted before refresh returns; only *rejected* refresh signs out — network errors/429s/5xx keep the session; `Success(null)` vs `Failure` threaded up so a locked device shows `StorageUnavailable`, never a spurious sign-out.
- **Secret hygiene in types and logs.** Redacting `toString`s on token/email/OTP value classes; `Logger` forces typed fields, `text` always through `Redactor` (masks URL fragments, query strings, JWTs, emails, phone-like runs); malformed event names degrade to `log.invalid_event` instead of throwing.
- **HTTP layer disciplined.** `BaseUrl` refuses cleartext by default; header injection sanitized; retries only idempotent methods; mutations via outbox/idempotency keys; offline fails fast; single-flight refresh; `ApiError.decode` never surfaces proxy HTML.
- **Outbox crash-safe.** Atomic `markSending`, `sending`→`pending` recovery on restart, ordering keys, expiry + jittered backoff, throwing deliverers become retries not worker deaths.
- **Build hygiene matches the rulebook.** `explicitApi()`, warnings-as-errors, ktlint/Spotless, versions in `libs.versions.toml`, tests on JVM + Android + iOS simulator, pre-commit full gate. Zero `!!`, `lateinit`, `TODO()`, `GlobalScope`, `println` in prod.

---

# sakalya-web

**Verdict:** A genuinely well-crafted component library — theme-engine color math and contrast guarantees are correct and well-tested, hard type-safety rules hold, accessibility is deeply built in. But `pnpm lint` is broken by a dangling plugin reference (CI's quality gate can never pass), and the shared library ships user-facing copy hard-coded to medical specialties.

## High

### W-H1. `pnpm lint` crashes: `eslint.config.js` references a plugin that isn't installed
**File:** `eslint.config.js:17` — `"import/no-default-export": "off",`. The `plugins` map registers only `react-hooks`; `eslint-plugin-import` appears nowhere (not in plugins, not in devDependencies — verified by repo-wide grep). In ESLint flat config this throws: `Could not find plugin "import" in configuration.` `pnpm check` = `typecheck && lint && test && build`, and CI runs `pnpm check` — so the repo's own "Done means `pnpm check` passes" is unachievable, and hard rule 7 ("No default exports") has zero enforcement (code happens to comply today).
**Fix:** delete the line (it's `"off"` anyway). Don't install `eslint-plugin-import` — it doesn't support ESLint 10 (repo uses `eslint ^10.11.0`); use `eslint-plugin-import-x` or a local rule if enforcement is wanted. *Confirm by running:* `pnpm lint`.

### W-H2. Shared theme presets hard-code medical specialties in user-facing strings
**File:** `packages/tokens/src/presets.ts:18-24` — `"Fresh teal, soft cards. Dental and family clinics."`, `"Warm rose. Gynecology, maternity, skin."`, etc. `Preset.description` renders in a tenant's theme picker — a white-label platform whose preset catalog says "Dental and family clinics" is not white-label for the next non-medical tenant.
**Fix:** describe the *look*, not the vertical ("Fresh teal, soft cards.", "Warm rose."). Move specialty suggestions to product repos/docs.

## Medium

### W-M1. Ten exported components missing from the axe check, despite rule 8
**File:** `packages/ui/src/a11y.test.tsx`. AGENTS.md:8 — "every new component also goes into the axe check." Missing: `PageHeader`, `UserChip`, `LineChart`, `Timeline`, `AttentionList`, `PersonList`, `IconButton`, `Avatar`, `Link`, `Toast`/`ToastProvider`/`useToast`. `LineChart` — the most complex interactive component (keyboard crosshair, live-region tooltip) — has no automated a11y coverage.
**Fix:** add a render case per missing component to the `Catalogue` (Toast via a test component calling `useToast().show(...)` inside `ToastProvider`).

### W-M2. `sortRows` treats `±Infinity` as present → undefined sort order
**File:** `packages/ui/src/components/data-table.tsx:100-103`. `Infinity` passes `isPresent`, then `a - b` → `NaN` for `Infinity - Infinity`; `toSorted` with a NaN comparator has implementation-defined ordering.
**Fix:** `Number.isFinite(value)` instead of `!Number.isNaN(value)`.

## Low

- **W-L1.** The rulebook violates its own rule: AGENTS.md:3 names "Aarogyam's clinic portal" above the product-concept ban; `docs/architecture.md` mentions clinics/doctors/prescriptions/patient app. *Fix:* scope the rule ("no product concepts in `packages/*/src` and user-facing strings; docs may name consumers").
- **W-L2.** Product concepts in component doc comments: `chip-filter-group.tsx:9` ("Filter patients"), `pagination.tsx:20` ("Invoice pages"), `meter.tsx:4` ("Composite A2 stock"). *Fix:* neutral examples.
- **W-L3.** `LineChart` draws negative values outside the plot (`line-chart.tsx:124`) — only the top is clamped while the axis starts at 0. Bar/donut sanitize; line neither clamps nor documents. *Fix:* clamp at 0 or document.
- **W-L4.** `LineChart` tooltip can overflow the right edge (`line-chart.tsx:199`) — no flip. *Fix:* right-align when `activeX / WIDTH > 0.7`.
- **W-L5.** `PhoneInput` bakes in `+91` default (`inputs.tsx:133`, special-cased at line 83). *Fix:* make `callingCode` required (no default).
- **W-L6.** Gallery reads `window.location.search` at module scope (`apps/gallery/src/app.tsx:32`) — crashes under SSR, never re-reads. *Fix:* read inside the component.
- **W-L7.** Gallery chrome ignores the tenant theme (`app.tsx:56-60`) — hard-coded `bg-slate-900` pills demo the exact pattern rule 3 bans. *Fix:* theme tokens.
- **W-L8.** `Pagination` renders empty `<p>` when `summary` is undefined (`pagination.tsx:37`). *Fix:* conditional render.

## Nit

- **W-N1.** `parse.ts:62-64` — `hasEveryColor` is dead code (loop above already fails on any missing/invalid token).
- **W-N2.** Pre-commit hook hardcodes `/opt/homebrew/bin` (macOS assumption).
- **W-N3.** `vite.config.ts:7` — `process.env["SINGLE_FILE"]` bracket notation; dot notation works.
- **W-N4.** No supply-chain audit in CI (backend has `cargo-deny`/`cargo-machete`; nothing here). Consider `pnpm audit --audit-level=high`.

## Web strengths (verified)

- **Theme engine math correct** (hand-checked `mix`/`lighten`/`darken`, `readableOn`, `ensureContrast` walk direction, bounded 25-step walk).
- **Untrusted-theme handling is defense in depth done right.** Strict allowlist parser, `toCssVariables` re-validates through `checked()`, `toCssText` selector allowlist blocks rule/`<style>` breakout.
- **Contrast tests prove the guarantee:** zero issues for every preset × light/dark, no errors for adversarial brands, 4.5:1 on status pills.
- **Hard type rules hold in all of `src/`:** zero `any`, zero `!`, zero `as` (except `as const`), zero `export default`, zero `console.*`; strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` actually set.
- **Components genuinely presentational** — no fetching in `@sakalya/ui`, no hardcoded hex in `packages/ui/src` (grep-verified), all color via `--sk-*` tokens.
- **Accessibility architectural:** native elements, focus rings, `aria-describedby`/`aria-invalid` wiring, visually-hidden chart data tables, keyboard-operable line chart with live-region tooltip, `prefers-reduced-motion`, axe suite over the catalogue.
- **Chart sanitization with accountability:** `cleanBarData`/`cleanDonutData` coerce bad values to 0, cap `part > total`, return per-datum `issues`, surface an "invalid data" note.
- **Portal theming complete** — all four portal components spread `usePortalTheme()`.

---

# sakalya-e2e

**Verdict:** A well-designed, dogfooded test kit — its own suite follows the anti-flake rules it preaches, the host-safety policy genuinely prevents touching production, strict TypeScript + lint posture enforced. No Critical or High findings, no secrets. Three Mediums.

## Medium

### E-M1. `ApiCallError` embeds up to 300 chars of response body — PII reaches Quality reports, violating hard rule 6
**File:** `src/fixtures/api.ts:63-68` — message includes `${body.slice(0, 300)}`. This is what Playwright prints on failure and what the Quality reporter captures (`quality-reporter.ts` → `attemptOf` → `summariseTest` → `excerpt`). A failed API call whose body echoes a submitted form (name, phone, address) puts PII into `quality.json`, which feeds a dashboard. The 300-char cut limits size, not content.
**Fix:** drop the body from the message; keep it on the existing `body` property and the `api-calls.json` attachment (already attached on failure).

### E-M2. The "no CSS/XPath locators" ESLint rule is trivially bypassed
**File:** `src/lint/index.ts:29-32` — the selector only matches selectors *starting* with `.`, `#`, `[`, `//`, `xpath=`, `css=`. `page.locator("button.submit")`, `page.locator("div .save")`, `page.locator("input[name=email]")` all pass while being exactly the CSS locators `docs/reliable-tests.md` §3 bans. The kit's own test only asserts the caught cases.
**Fix:** flag `locator()` calls whose string looks like CSS anywhere (match `/[.#\[]/`), or positively allow only tag-name-only selectors; add bypass cases to `tests/lint.test.ts`.

### E-M3. `TenantPool.disposeAll` aborts on the first dispose failure — remaining tenants leak, teardown fails
**File:** `src/fixtures/index.ts:133-141` — `for (const tenant of [...this.created].reverse()) { await dispose(tenant, this.request); }`. One tenant's dispose throwing (network blip, product bug) skips all remaining tenants, and the exception propagates out of the worker-scoped fixture teardown — failing teardown and masking the real result.
**Fix:** dispose all, collect failures, throw an aggregate `Error` with `cause: failures`.

## Low

- **E-L1.** `pdf()` declares wrong `/Length` — 46 declared vs 43 actual bytes, byte-count-verified (`src/files.ts:30`; fixed template text is 30 bytes, not 33). Strict upload validators could reject the synthetic file. Non-Latin-1 titles widen the gap (char length ≠ byte length). *Fix:* `Buffer.byteLength(stream, "latin1")` on the built stream. A unit test for this pure function would have caught it (see E-L10).
- **E-L2.** Kit's own `fixtures.spec.ts` violates its "tests never depend on order" rule (`e2e/fixtures.spec.ts:5-18`) — second test fails if the first is skipped (`first` stays `undefined`), serial mode is load-bearing. *Fix:* merge into one test or document the sanctioned exception.
- **E-L3.** `runStamp` breaks "one stamp per run" when a product passes custom `env` (`src/config.ts:103`, `src/run.ts:97-106`) — stamp written to the custom object, workers inherit `process.env` and mint their own. *Fix:* always write the stamp to `process.env`.
- **E-L4.** Product concepts in docs/docstrings (`src/media.ts`, `README.md`, `docs/reliable-tests.md`). *Fix:* product-neutral examples.
- **E-L5.** `parseJUnit` ignores testsuite-level errors (`src/maestro/index.ts`) — a Maestro report with zero testcases yields a clean-looking empty suite on the dashboard. *Fix:* synthesize one failed record naming the suite.
- **E-L6.** `attribute()` unescapes only 4 XML entities — `&apos;` and numeric refs stay escaped in reports. *Fix:* add `&apos;` and `&#\d+;`/`&#x…;` decoding.
- **E-L7.** `nextSlot` infinite-loops on `stepMinutes: 0` (`src/clock.ts`). *Fix:* throw `RangeError` for `step <= 0`.
- **E-L8.** `stopSpeaking`/`failSpeech` silently no-op when stubs aren't installed while `speak` throws (`src/media.ts`) — confusing pass/timeout. *Fix:* all three throw the same error.
- **E-L9.** `contextAs` leaks the context if `signIn.prepare` throws (`src/fixtures/index.ts:168-176`) — never pushed to `opened`. *Fix:* push before `prepare` or try/finally.
- **E-L10.** Pure parts lack unit tests despite rule 8 — no `files.test.ts`, no `network.test.ts`, `locators.test.ts` covers only `field`. E-L1 is the concrete cost. *Fix:* add the missing unit tests.
- **E-L11.** `checkAccessibility` reports null-impact violations regardless of `minimumImpact` (`src/a11y.ts`) — contradicts the option's documented meaning. *Fix:* document or filter.
- **E-L12.** Quality `run_id` has 1-second resolution — same-second runs in one `runDir` overwrite each other. *Fix:* random suffix on collision or milliseconds.
- **E-L13.** `pinClock` has no test although rule 8 requires a browser test for new browser helpers. *Fix:* small browser test.

## Nit

- **E-N1.** `package.json` says `0.1.0`, README changelog already lists `0.1.1` — version drift.
- **E-N2.** Pre-commit hook prepends `/opt/homebrew/bin` (macOS assumption).
- **E-N3.** `SAKALYA_E2E_WORKERS="0"` → `workers: "0"` string passed to Playwright; clamp to minimum 1.
- **E-N4.** `e2e/a11y.spec.ts:13` asserts exact axe rule IDs — brittle across axe-core upgrades.
- **E-N5.** `diagnostics.ts` slices console errors to 500 chars; hard rule 6 says 300 — align.
- **E-N6.** `isLocalHost`'s 127.x regex accepts `127.999.999.999` as local — tighten.

## E2E strengths (verified)

- **Host safety real and tested:** `assertSafeTarget` throws `UnsafeTargetError` at config time; every `ApiClient.send` re-checks absolute URLs; the kit's own suite asserts `https://example.com/` is rejected.
- **Dogfoods its anti-flake doctrine:** own eslint config applies `e2eLintRules` to `e2e/**`; zero `waitForTimeout`/`networkidle`/CSS locators in its own tests; `expect.poll` instead of sleeps.
- **Retries detect flakiness instead of hiding it:** `retries: ci ? 1 : 0`; passed-on-retry marked `flaky`; reporter test spawns real Playwright against a fixture project.
- **Test isolation thought through:** one tenant per file, `unique()` names per-attempt/per-run, `forbidOnly: ci`, tenants disposed at worker end.
- **Failure evidence excellent:** request IDs on every API call, `diagnostics.json` + `api-calls.json` attached only on failure, trace/video/screenshot retained on failure only.
- **Type discipline:** `erasableSyntaxOnly`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, strict; Playwright types-only in `src/` enforced by lint.

---

## Remediation order (all three repos)

**Before product integration:**
1. M-H1 — token-refresh mutex: single-flight the refresh, don't hold the mutex across network I/O.
2. M-H2 — outbox backup exclusion guidance + deliberate SQLCipher-vs-OS decision.
3. W-H1 — delete the dangling `import/no-default-export` line so `pnpm lint` (and CI's `pnpm check`) can pass. *Confirm by running `pnpm lint`.*
4. E-M1 — drop the response body from `ApiCallError`'s message (PII in Quality reports).

**Before production:**
5. W-H2 — scrub medical-specialty copy from theme preset descriptions.
6. E-M2 — close the locator-lint bypass; E-M3 — aggregate tenant-dispose failures.
7. M-M1 — document the deep-link host check on `completeMagicLink`; M-M2 — scope the outbox worker mutex / require bounded `deliver`.
8. W-M1 — add the 10 missing components to the axe suite; W-M2 — `Number.isFinite` in `sortRows`.

**Later:** all Lows/Nits; the cross-repo product-agnosticism cleanup; web N4 (`pnpm audit` in CI); mobile M-L3 (SwiftUI kit or doc downgrade + missing READMEs); mobile M-L4/M-L8 (sign-out race, session version check).
