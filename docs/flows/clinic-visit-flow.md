# Clinic visit flow

This is the single source for the patient visit, from the front desk to the follow-up. It applies to mobile, web and the backend: each device builds the same steps and the same patient states. It was written on 10 Oct 2026 from the founder's walkthrough. The "today" column was checked against commit 939b534.

## Patient states

`waiting` → `called` → `in_consult` → `in_chair` → `ready_to_bill` → `done`. A patient can leave at any point, which is `left`.

- `called` and `ready_to_bill` are new on the server (BE2).
- `in_consult` means the visit is open and the patient is not in a chair.
- Until BE2 lands, apps show `called` from `queue_tokens.called_at` and mark `ready_to_bill` as Preview.

## Steps

| # | Step | Who | Today | Missing |
|---|---|---|---|---|
| 1 | Search by mobile number and show every profile on that number | Front desk | `GET /patients/lookup`. Phone is not unique; up to 10 matches. | Family links (BE1) |
| 2a | New patient: details, allergies, consent, photo | Front desk | `POST /walk-ins` (allergies, consent). Photo goes through `POST /patients/{id}/attachments`. | Profile photo field; "add family member" (BE1) |
| 2b | Returning patient: confirm and check in | Front desk | `/appointments/{id}/check-in`, walk-in token | — |
| 3 | See free chairs and doctors, and pick a doctor | Front desk | `GET /today` (chairs, shifts, leave) | Per-doctor queue filter (BE2) |
| 4 | Patient waits; the doctor is told | System | queue `waiting` | Notification (BE4), live updates (BE3) |
| 5 | Doctor taps **Send in**; the desk is alerted and calls the patient | Doctor → desk | `called_at` only | `called` state and call endpoint (BE2), alert (BE4) |
| 6 | Consultation: history, allergies, consent, teeth, typed or voice notes, photos and X-rays | Doctor | visit, notes, chart, attachments | Live sync between devices (BE3) |
| 7 | Chair: voice notes hands-free, tap teeth, procedures done or planned | Doctor / assistant | procedures, dictation | — |
| 8 | Back in consultation: show the plan and X-rays, and upload them to the profile | Doctor | attachments; the plan is stored as planned procedures | — |
| 9 | Close the visit with a follow-up date and the fee; the desk is told to collect | Doctor | `/recalls`; invoices with `encounter_id` | Close takes the follow-up and fee and creates the invoice (BE5); alert (BE4) |
| 10 | Collect the payment (UPI, cash or card) with a photo of the proof | Desk | `POST /payments` (method, `Idempotency-Key`) | Proof attachment (BE6) |
| 11 | Welcome message (app link, waiting time, clinic site) and thank-you message (visit summary link, follow-up booking) | System | outbox, `messages`, email through Resend | WhatsApp/SMS (BE7), visit summary page (BE8) |
| 12 | Works offline: saved on the device, sent when the network returns, never twice | Apps | client ids, `Idempotency-Key` | Mobile outbox (F3) |

Laptop difference: the desk uploads photos from files instead of using the camera. Everything else is the same.

## Backend brief (for the backend agent)

1. **BE1 Family profiles.**
   - Add a `patient_relations` table (patient, related patient, relation: guardian, child, spouse, other).
   - Lookup returns the family group.
   - Walk-in can add a person to an existing family.
2. **BE2 Queue states.**
   - Add `called` and `ready_to_bill` to `queue_tokens.status`.
   - Add `POST /queue/{id}/call` for the doctor.
   - Add a `practitioner_id` filter to `GET /queue`.
3. **BE3 Live updates.**
   - An SSE stream `GET /events` per branch, for queue, visit and notification changes.
   - Polling stays as the fallback.
4. **BE4 Staff notifications.**
   - New kinds `patient_waiting`, `send_in` and `collect_payment`.
   - In-app now, push later.
5. **BE5 Close with follow-up and fee.**
   - `POST /visits/{id}/close` takes a body `{follow_up_on?, fee_paise?, note?}`.
   - In one transaction it creates the recall and a draft invoice linked to the visit.
6. **BE6 Payment proof.** Add `attachment_id` on payments, with attachment kind `payment_proof`.
7. **BE7 WhatsApp/SMS.**
   - A provider adapter: Meta Cloud API or Gupshup, chosen by the founder. SMS needs DLT.
   - Templates `welcome`, `visit_summary` and `follow_up_booking` in en/hi/mr.
   - Messages carry no patient name and no clinical detail, only a link with a PIN.
   - Respect `contact_preferences` and the WhatsApp opt-in.
8. **BE8 Visit summary page.**
   - A `share_links` kind `visit`.
   - The public page shows the treatments done, the history, the follow-up date and a Book button.
9. **BE9 Education pages** on the clinic site: hygiene and short treatment explainers. Content comes from the founder.

## Mobile tasks (iOS first, then Android)

| Task | What | Until the backend lands |
|---|---|---|
| F1 | `PatientState` mapper (shared) | — |
| F2 | Desk lookup by mobile number with a profile picker | — |
| F3 | Offline outbox (shared) | — |
| F4 | Waiting-room board | `called` and `ready_to_bill` shown as Preview until BE2 |
| F5 | Close sheet with follow-up and fee | uses `/recalls` plus an invoice; switches to BE5 |
| F6 | Payment proof photo | uploaded as a patient attachment until BE6 |
| F7 | Polling every 20 s plus pull to refresh | replaced by BE3 |
