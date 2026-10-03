# Lessons from MyDwarpal

MyDwarpal is Sakalya's society and gate-management product (Node/TypeScript on Cloud Run, Supabase, Next.js, React Native). A read-only study on 3 Oct 2026 judged each practice on its merits. Aarogyam adopts what proved strong, fixes what was weak, and moves generic pieces into the shared `sakalya-*` repositories.

## Adopt

1. **Local token checks** against Supabase's JWKS, with roles and the tenant read from the database (not from JWT claims, which stay stale for an hour), cached briefly.
2. **A session registry with real revocation**: one row per Supabase session, checked on every request. On patient-data routes a failed lookup refuses the request.
3. **Throttles keyed on the account** (OTP send per email, verify per account), a separate budget for token refresh, IPv6 grouped by /64 for carrier-grade NAT. Never exempt canaries from auth throttles; cache their sessions instead.
4. **Payment invariants:** the amount always comes from the server; a local order row is written before calling Razorpay; one live order per invoice (partial unique index); settlement unique per provider order; checkout re-fetches the payment and compares amount and currency; mismatches raise an alert; receipt numbers per clinic and financial year.
5. **Webhooks:** HMAC over the raw bytes, then an event ledger whose `processed_at` lets half-finished events re-run.
6. **Idempotency keys** from the client form to a unique index.
7. **Cleanup ledgers** for steps outside a transaction (creating a login, uploading a file).
8. **Fail-fast configuration**: startup names any missing setting; secrets are read in one module and only ever shown by their last four characters.
9. **Canaries:** named journey steps with last-in-first-out cleanup, synthetic tenants only, a sweeper for leftovers, results stored and shown, a skipped check never counts as a pass. Stubbed end-to-end tests on pull requests, credentialed ones daily, production refused as a target.
10. **Deploy and migration guardrails**: branch-to-service mapping with production refusing other branches; a migration ledger that asks for the project before touching production; graceful shutdown on SIGTERM.

## Do better

| MyDwarpal | Aarogyam |
|---|---|
| The client chose the tenant (`x-society-id`); an admin of one society edited another's data | The tenant comes from the host name, through an extractor that can't be built without a membership check, with row-level security underneath |
| 13 tables without RLS; privileged functions callable with the anon key; Data API open | Data API off, nothing in `public`, lint tests fail the build on any table without RLS or any function executable by `anon` |
| `check-email` revealed whether an account exists and returned invite tokens | The app decides the sign-in method; invites are tied to the verified email and the clinic |
| Temporary passwords sent by email; tokens in `localStorage` and plain storage | No passwords by email; tokens in Keychain/Keystore on phones, one token store on the web with a strict CSP |
| The API proxied every Supabase Auth call, so Supabase's per-IP limits and CAPTCHA protected nothing | Clients call Supabase Auth directly (with Turnstile on the web); the API only verifies tokens |
| Webhook bodies stored before the signature check; settlement split across calls; one unrotatable encryption key | Signature first, 256 KB cap, settlement in one transaction, keys with IDs and a derived key per purpose, daily reconciliation |
| Payments built before Razorpay approved the model (three models in a month, no payment taken) | Written approval of the clinic-as-merchant model before code |
| Audit opt-in, fire-and-forget, whole rows with personal data, read route never mounted | Change history by trigger in the same transaction, changed columns only, masked; access record for every read of a patient's record |
| No request IDs; full URLs (with checkout tokens) in logs; raw database errors in 500s | Request IDs on every log line, no query strings, `ApiError` never carries SQL or input |
| Sensitive documents in a public bucket, then at never-expiring URLs | Private storage with short-lived signed URLs, every access recorded |
| Tests not run before deploy; canaries never scheduled; migrations applied by hand, numbers reused | The local gate (and later CI) runs before any deploy; canaries as a scheduled Cloud Run job with an alert on silence; sqlx migrations with a ledger from day one |

## Email OTP setup (Supabase)

1. **Auth → Email:** confirm email on, OTP length 6, expiry 600 s, sign-ups off. The API creates staff and patients; clients send `shouldCreateUser: false`.
2. **Templates:** `{{ .Token }}` in Magic Link, Confirm signup, Invite and Reauthentication; the expiry text matches step 1; no patient data.
3. **Sender:** Supabase's built-in mailer reaches only the project team. Resend's free tier (3,000 a month, 100 a day) for testing, from an auth subdomain with SPF, DKIM and DMARC; Resend Pro or Amazon SES before the pilot. The SMTP key lives only in Supabase.
4. **Limits:** 60 s between resends per user; per-IP limits on verify and refresh.
5. **Bots:** Cloudflare Turnstile (free) on the web; API throttles for the phone apps until Play Integrity and App Attest.
6. **Tokens:** asymmetric signing keys, refresh-token rotation with reuse detection, 1-hour access tokens backed by the session check; idle expiry enforced by our session registry.
7. **MFA:** TOTP (free) for clinic owners and Sakalya staff; console routes require `aal2`.
8. **Reviewer and canary logins:** passwords only for allowlisted accounts that hold roles only in synthetic clinics.

## Shared components to build (backlog)

| Component | From | Target | When |
|---|---|---|---|
| Session registry rules and revocation | `be/src/modules/auth/sessions.service.ts` | `sakalya-auth` | M2 |
| Throttle presets for OTP send, verify and refresh | `be/src/middleware/rate-limit.middleware.ts` | `sakalya-throttle` | M2 |
| `Idempotency-Key` extractor and unique insert | `be/src/shared/utils/atomic.ts` | `sakalya-http`, `sakalya-db` | M3 |
| Per-request database time on the request log | `be/src/middleware/perf.middleware.ts` | `sakalya-telemetry` | M2 |
| Internal-job auth (Cloud Scheduler OIDC) | `be/src/middleware/cron-auth.middleware.ts` | `sakalya-http` | M5 |
| Webhook verify → ledger → idempotent dispatch | `be/src/modules/society-payments/` | new `sakalya-webhooks` | M5 |
| Secret encryption with key IDs and rotation | `be/src/shared/utils/secret-box.ts` | new `sakalya-crypto` | M5 |
| Canary runner | `be/scripts/canary/runner/` | `@sakalya/canary` | M2.5 |
| OTP sign-in screen, API client (refresh once and retry), Playwright harness | MyDwarpal admin dashboard | `sakalya-web` | Now (console sign-in) |
| Token storage, one refresh at a time, device headers, idempotency per submission, screenshot protection | MyDwarpal mobile app | `sakalya-android`, `sakalya-ios` | Doctor app |
| Fastlane, Maestro flows, daily test report | MyDwarpal mobile app | `sakalya-android`, `sakalya-ios` | Doctor app |
