# v9 clinic visit flow: end-to-end run

Code: `feat/v9` at 19399e0. Run on 11 Oct 2026 against a fresh database `aarogyam_v9e2e` (owner and api roles, migrated: 115 applied, seeded with `db/seed/local.sql` and `db/seed/demo-billing.sql`). Server: v9 build on :8080, `ARO_WHATSAPP__ENABLED=false`. All calls went through `*.localtest.me:5173` with dev tokens. Data: seed people plus synthetic patients only.

Actors: Farah Shaikh (front desk), Asha Kulkarni (owner, doctor; practitioner d102), Dr Dev Rao (second pass), Bina Joshi (Lotus owner).

## Result: steps 1-12

| Step | Result | Evidence (codes and IDs only) |
|---|---|---|
| 1 Lookup shared number, register child with `family_of` | PASS | `POST /patients/lookup` 200 (2 matches, SD-2 and SD-10). `POST /walk-ins` with `family_of {relation: child}` 201, child 01a12b8f-7acd-72aa-a569-b70aae7ad70d (SD-13), `family_link_id` returned. Lookup after: 3 matches. `GET /patients/{parent}/family` 200 lists the child. |
| 2 Check in: `waiting`, `patient_waiting` | PASS | Walk-in with `patient` registers and issues the token in one call (token 01a12b8f-7e01-77c1-aeba-a2933fb32ccf, `waiting`). Asha got `patient_waiting`. Dev Rao got none (token is Asha's). |
| 3 Call: `called`, `send_in` | PASS | `POST /queue/{id}/call` 200 `called`; repeat 200. Farah has one `send_in`, unread count 1. |
| 4 Visit, note patch and sign, procedure twice | PASS | `start-visit` 201 (visit 01a12b8f-a947-72cc-8ff7-5c0fc14e4cfc, token `in_chair`); repeat 200. Note 201 draft, `PATCH` with `If-Match` 200 (row_version 2), sign 200 (repeat 200). Procedure with client id sent twice: 201, 201, same id, 1 row in DB. |
| 5 Rx linked to visit | PASS | Create 201 (draft, `encounter_id` = visit); issue 200 RX-1; item `1-0-1`, `after_food`, 3 days. |
| 6 Close with follow-up and fee | PASS | Close 200: `recall_id` 01a12b90-0dd7-7489-9595-d54e946aae3e (due 2026-10-25), `invoice_id` 01a12b90-0f08-7050-8cff-006267d77f5a (draft, linked to visit). Token `ready_to_bill`, `collect_payment` row exists. Repeat close 200, identical body; DB: 1 recall, 1 invoice, 1 procedure. |
| 7 Proof upload and payment, twice | PASS | Farah issued the invoice (200). Upload `kind=payment_proof` 201 (01a12b90-7b14-7486-90e2-be3708f77fc4); Farah uploading `xray` is 403. `POST /payments` with `attachment_id` and Idempotency-Key: 201, repeat 200 same id 01a12b90-7b68-73eb-9f69-90082f3c104e; DB: 1 payment for the patient. Invoice `paid`, token `done`, `collect_payment` marked handled. |
| 8 Share and `/shared/{token}` with PIN | PASS | Farah 403 (needs clinical.read); Asha 201. Meta 200 (`usable`), wrong PIN 403 `wrong_pin`, right PIN 200. Treatments (Composite filling, tooth 36) and the Plan advice appear, plus Rx and follow-up. The S, O and A texts, fees, name and phone are absent. The SPA page `/shared/{token}` 200. |
| 9 SSE during steps 2-7 | PASS | See below. |
| 10 Lotus member gets 404 | PASS | Bina on lotus host: 18 record routes (patient, visits, visit, close, share, queue call, start-visit, invoice, payment, Rx, note patch and sign, attachment content and download, procedure, family, Rx list, procedures) all 404. Her queue, lookup and invoice lists do not contain them. Bina on the Sunrise host 404. Dev Rao on the Lotus host: 404 on all except invoice and payment, which are 403 (see D2). |
| 11 No name or phone in logs or events | PASS | `api.log` (192 lines): 0 hits for the patient names, the shared phone, note text, drug name, share PINs, bearer tokens. Logs use route templates, not raw paths, so share tokens are absent too. Only IDs appear (`walk_in.registered patient_id queue_token_id`). SSE frames carry ids only. Notifications for all three staff contain no patient name or phone (`patient_number` and token only). |
| 12 Offline: retries never twice | PASS (server side) | Covered by the retries in steps 3, 4, 6, 7: no duplicates. The device outbox itself was not exercised (UI taps cannot be scripted). |

Dr Dev Rao: his clinic choice works. He signs in at Sunrise, sees `patient_waiting` for a token assigned to him, filters the queue with `practitioner_id`, and calls it (200, `called`). On Lotus his queue works. That token (SD-9) was left `called`, and a second one (SD-3) `waiting`, for the board screenshots.

## SSE events seen (Farah, `GET /api/v1/events`, 12 events plus `ready` and 2 heartbeats)

| # | Event | Cause |
|---|---|---|
| 1 | `ready` | stream live |
| 2-3 | `queue.changed`, `notification.created` | walk-in (`patient_waiting`) |
| 4-5 | `queue.changed`, `notification.created` | call (`send_in`) |
| 6-7 | `queue.changed`, `visit.changed` | start-visit |
| 8-10 | `visit.changed`, `queue.changed`, `notification.created` | close (`collect_payment`) |
| 11 | `queue.changed` | payment (token `done`) |

Each frame is `{"kind","id","branch_id"}`. Repeated calls, notes, signing, procedures, Rx and the share made no event (documented gap: `visit.changed` only on start and close). The stream worked through the Vite proxy.

## Screenshots (`mobile/docs/screenshots/v9/e2e/`)

Local iOS build installed on both simulators (iPhone 18 Pro, iPhone 18 Pro Max); I read each image.
- `01-board-called.png`: Waiting room as Farah. Banner "Patient called in", a Called section (#5), Waiting (#2, #6), In chair (#3).
- `04-board-promax.png`: the same on the Pro Max.
- `02-history.png`: Asha, Aarav Verma, History tab: Composite filling, tooth 36, Rx chip, Paid chip; header Visits 1, Paid 2,400, Due 0.
- `03-visit-detail.png`: visit detail: treatment with price, signed notes, Rx RX-1 with `1-0-1` and Morning 1, Afternoon 0, Night 1, 3 days, 6 tablets, bill paid in full. The bill below the fold is partly covered by the tab bar.

## Defects and observations

No blocking defect. Nothing failed.

- D1 (low). A draft invoice reads `balance_paise` 0 while `total_paise` is 240000. Repro: close a visit with `fee_paise`, `GET /invoices/{invoice_id}`. A client that shows "balance" from a draft would show nothing due.
- D2 (low, rule 5). For a cross-clinic id, a member without billing rights gets 403 instead of 404. Repro: as Dev Rao on the Lotus host, `GET /invoices/{sunrise invoice}` and `GET /payments/{id}` return 403 (everything else 404). The code does not depend on the id, so nothing leaks.
- D3 (low). `GET /payments?patient_id=` returned all 15 payments, not the patient's 1. Either the filter is missing or it is not in the API; the iOS app did not need it.
- D4 (note). A draft invoice needs `POST /invoices/{id}/issue` before a payment can apply. Farah can do it. The desk app must issue first; be-int does not say so.
- D5 (note, tooling). The iOS `AAROGYAM_DEV_SIGN_IN` hook is ignored while a session is stored (my first History screenshot was as Farah: "Your role can't open this"). Add `AAROGYAM_DEV_SIGN_OUT=1`. Also, `AAROGYAM_DEV_OPEN_FIRST` opened Aarav only because the list is ordered by recent.
- D6 (note). A shared visit opens only on the clinic host (`sunrise...`); on the app host it is 404.
- D7 (note). A procedure retry returns 201 both times, as documented, not 200.

## How to restart the stack

- v9 server (running now, log in the scratchpad `e2e/api.log`):
  `ARO_DB__URL=postgres://aarogyam_api@localhost:5432/aarogyam_v9e2e ARO_DB__OWNER_URL=postgres://aarogyam_owner@localhost:5432/aarogyam_v9e2e ARO_WHATSAPP__ENABLED=false ~/project/.targets/v9-be/debug/aarogyam serve`
- Rebuild: `cd ~/project/wt-v9 && CARGO_TARGET_DIR=~/project/.targets/v9-be cargo build -p aarogyam-server`.
- Fresh database: `DB=aarogyam_v9e2e scripts/dev-db.sh`, then `aarogyam migrate`, then `psql $ARO_DB__OWNER_URL -f db/seed/local.sql -f db/seed/demo-billing.sql` (drop the database first to rerun).
- Old v7 server (stopped, pid 14767): from `~/project/wt-mobile-v7` run `ARO_DB__URL=postgres://aarogyam_api@localhost:5432/aarogyam_mobile ARO_DB__OWNER_URL=postgres://aarogyam_owner@localhost:5432/aarogyam_mobile ./target/debug/aarogyam serve`. Stop the v9 server first (port 8080).
- The portal dev server on :5173 was left alone.
