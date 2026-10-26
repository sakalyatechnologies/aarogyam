# v9 be-fix: e2e defects D1-D3, D7 and the BE7 gap (branch v9-be-fix, base 58b3cad4)

## API shape changes the apps must know
- **`GET /payments?patient_id=<uuid>`** now filters (it was ignored: D3). Invoices already filtered; no other
  billing list had a dead filter (`/lab-payments` filters vendor and dates; price items take none).
- **Draft bills report what is owed.** `total_paise` and `balance_paise` (total - paid) are real on a draft, in
  `GET /invoices` (it was 0 for drafts) and `GET /invoices/{id}` (balance was 0). `payment_state` stays null.
  Apps can drop the "read each draft to get its total" workaround. Void bills still have balance 0.
- **`POST /invoices/{id}/issue` on an issued bill is `200` with the bill unchanged** (was `409`). Only a void
  bill is `409` now. Retry-safe; the desk's issue-then-pay flow works for an already issued bill, and the
  `409 means already issued, so pay` fallback is no longer needed (keeping it is harmless).
- **`POST /visits/{id}/procedures` with a client `id`**: first create `201`; a retry with the same `id` and
  content is `200` with the existing row. Other content under the id is still `409 id_conflict`.
- **Cross-clinic IDs are `404` for every role** on `/invoices/{id}` (get, patch, issue, void, upi-link) and
  `/payments/{id}` (get, void). Before, a member without billing rights got `403` (D2). In the member's own
  clinic the role still decides: a record that exists but isn't allowed is `403`.
- New message skip reason `follow_up_resolved` (`messages.skip_reason`; migration 0428).

## Decision: visit close stays draft
`POST /visits/{id}/close` with `fee_paise` still makes a **draft** (docs/decisions.md, 2026-10-11). Issuing takes
the next gap-free number and freezes the bill; at close the desk hasn't reviewed lines, discounts or place of
supply, and a clinician's slip would burn a number. The mobile flow (issue, then pay) is unchanged and safe.

## BE7 gap: follow-up booking message
The queued `visit.follow_up_booking` message (not yet sent) is skipped with `follow_up_resolved` when the patient
books (app, public page, or desk booking: any new appointment for that patient) or when the recall is marked
done (`POST /recalls/{id}/done`). A sent or already skipped message is left alone.

## Gaps
- There is no recall "dismiss" endpoint, so only done and booking cancel the message; a future dismiss must call
  `auto_messages::follow_up_closed` (it is the one place that skips the message).
- A booking does not set the recall to `booked`; the status is never set by any path today.
- The `issue` handler logs `invoice.issued` on a retry too (the log line, not the record).

## Tests
`billing.rs` (cross-clinic 404 for a no-billing member, patient filters, draft total and balance, issue retry),
`client_ids.rs` (procedure retry 200), `auto_messages.rs` and `patient_app.rs` (message cancelled), `visit_close.rs`.
