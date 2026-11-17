# End-to-end tests

The journeys in `web/e2e` drive the real portal and console against a real API and database, the way people use them. They are built on the shared kit, [`sakalya-e2e`](../../sakalya-e2e) (`@sakalya/e2e`, linked like the `sakalya-web` packages); read its `docs/reliable-tests.md` before writing one.

## Running them

```sh
git -C ../sakalya-e2e checkout v0.1.0 && pnpm --dir ../sakalya-e2e install   # once
scripts/e2e-stack.sh up        # its own database (aarogyam_dev_e2e), API :8181, portal :5273, console :5274
pnpm e2e                       # all journeys; or: pnpm --filter @aarogyam/e2e e2e tests/billing.spec.ts
scripts/e2e-stack.sh down
```

`scripts/quality-run.sh` runs them too when the e2e stack is up and records the result for the console's Quality page (the kit's reporter writes each test's status, retries and error, and marks tests that passed only on a retry as flaky). `node ../sakalya-e2e/src/reporter/flakes-cli.ts var/quality` lists tests that were flaky across recorded runs.

## How the suite stays deterministic

- **A fresh clinic per test file** (`web/e2e/src/tenant.ts`): owner, doctor and front desk, two chairs, the doctor's hours (08:00–22:00 every day), a price list, setup done. Created in one transaction as the schema owner through `app.create_clinic`, so files never share data with each other, the seed or earlier runs. Every record a test creates has a unique name (`unique("Patient")`).
- **Setup through the API, journeys through the screen** (`web/e2e/src/clinic-api.ts`).
- **Sign-in as the apps remember it**: the dev sign-in cookie on `localtest.me` (portal) and session storage (console); the app mints its token from the real `POST /api/v1/dev/token`.
- **The clinic's time zone**: pages open in Asia/Kolkata and times come from `nextSlot`, so a run at 23:00 in California books the same way as one at 09:00.
- **No sleeps**: every step waits for the response it needs (`waitForApi`) or the screen it leads to. The kit's lint rules ban `waitForTimeout`, `networkidle`, CSS/XPath locators and forced clicks.
- **The test inbox** reads the outbox (`web/e2e/src/inbox.ts`): nothing sends email locally, so a message keeps its link secret and the inbox rebuilds the link the template would carry.
- **The e2e stack has its own throttle bypass token** (`ARO_THROTTLE__BYPASS_TOKEN`, accepted only from loopback in `local`); the suite sends it on every request.
- **No retries locally**, one in CI only to detect flakiness.

## Why the old golden journey was flaky (fixed)

1. **The dev sign-in limit.** Every page load minted a token, and the per-IP limit of 30 sign-ins per 15 minutes made the second run within a quarter hour fail with 429s and 401s that looked like product bugs. Fixed with the bypass token for the e2e stack.
2. **Shared, accumulating data.** All tests used the seeded Sunrise clinic and one run-wide patient: tests 3–5 depended on test 2, and every run booked Dr Dev at the dialog's default 09:00 on the same day, piling appointments onto one slot. Fixed with a clinic per file and data per test.
3. **The runner's time zone.** The browser ran in the machine's zone (California) while the clinic works in India's, so "today" and the default booking time disagreed with the server for half of every day. Fixed by opening pages in the clinic's zone and choosing slots there.
4. **A stale payment amount (product bug).** The payment dialog took its amount from the bill's balance once, when the bill page first rendered as a draft (balance 0), so recording a payment right after issuing offered ₹0 and the receipt never came. The dialog now mounts when opened, from the current balance.
5. **Cold dev servers and tight timeouts.** Each page is code-split, and Vite compiled a page on its first visit, which on a busy machine took longer than the 5 s assertion and 30 s test limits. Fixed with Vite `server.warmup` for every page, timeouts sized for a local stack, and waiting for the responses each step needs instead of for text to appear.

## Product bugs the journeys found

- The payment dialog's stale amount (above).
- The printed prescription's QR code opened the API's JSON (`/api/v1/verify/prescriptions/…`) instead of the portal's "Genuine prescription" page; `verify_path` now names the page.
- The queue board never loaded once a token existed: the api-client rejected `"welcome_status": null`. Fixed (the schema takes null); `visits.spec.ts` now checks a patient in at the board and seats them in a chosen chair.
- The portal had no screen to void a payment. A bill's Receipts now have "Void" (billing.write, with a reason); the receipt stays listed as Void with its reason and the bill owes the amount again.

## The new look

The new look (ShellV2, `pages/**/v2`) is the portal default, and the journeys follow it: the visit runs on the patient's own page (Start visit, complaint chips, Fee, End visit, Collect payment) and the prescription is drafted there; the front desk checks in a booking from the queue's Add to queue; the calendar's button is Book. The new patient page has no vitals or signed-note screens, so those two journeys (`visits.spec.ts`) use the classic visit page, still served at `/patients/:id/visits/:visitId`. Patient mail now lives in `aarogyam.messages`, staff mail in `outbox_events`; the inbox reads both.

## Workflows

Status: **covered** (a journey exercises it end to end), **partial** (part of it, the rest noted), **open** (not written yet; next in line from the top).

| Area | Workflow | Spec | Status |
|---|---|---|---|
| Golden journey | console creates a clinic; front desk registers, books and arrives a patient; doctor starts a visit, notes a complaint and ends it with a fee; doctor issues a prescription; front desk bills and takes cash | `golden-journey.spec.ts` | covered |
| Money | bill draft → issue → cash payment → receipt → void refused while paid → payment voided → bill voided | `billing.spec.ts` | partial: the portal has no screen to void a payment, so that step uses the API |
| Money | an empty bill can't be issued | `billing.spec.ts` | covered |
| Clinical | prescription with an allergy alert and override reason → patient email (link, no PIN) → shared page with PIN (wrong PIN refused) → QR verify page | `prescriptions.spec.ts` | covered |
| Clinical | booking checked in from the queue → doctor starts the visit | `visits.spec.ts` | partial: the queue board and seating are `test.fixme` (queue schema bug above) |
| Clinical | note signed, then an addendum (the signed note is never editable) | `visits.spec.ts` | covered |
| Clinical | vitals recorded per reading | `visits.spec.ts` | covered |
| Clinical | allergies, dental chart, voice note (mocked microphone and dictation), treatment plan | — | open |
| Front desk | booking conflicts: same chair refused, same doctor in another chair warned, outside hours warned | — | open |
| Front desk | self-booking on `/book` → requested → front desk confirms | — | open |
| Stock | receive and use stock | — | open |
| Onboarding | registration → console approval → invitation email → accept → setup wizard | — | open |
| Team | staff invite → accept | — | open |
| Access | roles: the front desk has no clinical navigation and the API refuses it a visit; a doctor reads bills but can't take payments; the owner can | `access.spec.ts` | covered |
| Access | cross-clinic isolation: a member of another clinic gets "Choose a clinic" on this clinic's host, "Not found" for its patient id on their own host, and 404/403 from the API | `access.spec.ts` | covered |
| Settings | theme, letterhead, website | — | open |
| Console | metrics, quality, clinics | — | open |

Mobile journeys (Maestro) start with the apps; the kit's `templates/maestro/` and `sakalya-maestro` runner are ready (`docs/mobile-architecture.md`).
