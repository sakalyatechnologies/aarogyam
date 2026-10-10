# Decisions

Newest first. Change a decision by adding an entry that supersedes it.

## 2026-10-10: Finishing a visit in one step (Portal v2, B5)

**Decision.** A visit can be finished and handed over with additive endpoints (migrations 0625 to 0629).
- **Finish.** `POST /visits/{id}/finish` (`clinical.write`, body optional) signs the caller's own draft notes, issues a given draft prescription with the allergy check, plans a follow-up (`follow_up_on`, `patients.write`), starts a draft bill linked to the visit (`fee_paise`, `billing.write`) and closes the visit, in one transaction. A closed visit answers `409` `visit_closed`; an allergy alert without an override reason answers `409` `allergy_alerts` and changes nothing. `POST /visits/{id}/close` takes the same optional follow-up and fee; the visit fields stay at the top of its answer.
- **Share links.** `expires_in_hours` (24 to 720, default 168) and `channel` (`whatsapp`, `sms`, `qr`, `link`; default `link`) on `POST /prescriptions/{id}/share`. `whatsapp` and `sms` queue a care message; there is no SMS worker yet, and no approved WhatsApp template for prescriptions, so those stay queued or skipped. New link kind `visit` (`POST /visits/{id}/share`, `clinical.write`; open with `POST /shared/{token}/visit` and the PIN) shows the clinic, visit number, doctor, treatments done and the next follow-up, nothing else.
- **Medicine sets.** The clinic's own sets: `GET/POST /medicine-sets`, `PUT/DELETE /medicine-sets/{id}` (`prescriptions.issue`), merged into `GET /quick-picks` with `own: true`. Configuration without patient data: no erasure step and no retention class.
- **Replays.** An optional `client_id` on dental chart batches, procedures and prescription drafts: the same id with the same request returns the first record, another request is `409` `id_conflict`. Unique per clinic. A batch stores its id on the first entry only.
- **Root canals.** A `root_canal` chart entry may carry `canals` (1 to 8, name and optional working length) and a `sitting` (1 to 20). Recordings may be spoken in `gu-IN`.
- **Validation** errors are `400`. All changes are additive; the OpenAPI document only gains fields, endpoints and optional bodies.

**Why.** The portal and the phone apps finish a visit in one tap, and a lost answer must not double-book a chart entry, a procedure or a prescription.

## 2026-10-10: Dashboard layout (Portal v2, B1)

**Decision.** The Today board's layout is versioned JSON, v2, saved at two levels and checked against one widget registry (migration 0605, `aarogyam-domain/src/dashboard.rs`).

- **Shape.** `{v: 2, tpl, density: compact|cozy, card: flat|soft|outline, rail: {side: left|right, width: narrow|medium|wide}, items: [{key, zone: top|main|rail, size: S|M|L|full, opts}]}`. `S`, `M`, `L` and `full` are 4, 6, 8 and 12 of 12 columns; the rail ignores size. Each widget appears at most once; order is the order within a zone.
- **Registry** (server-side; the same table is the catalogue the API returns): `kpis` (top or main; `metrics`, 4 to 6 of `appointments completed waiting new_patients collected outstanding chairs_busy lab_due`), `nextup` (`count` 1 to 5), `chairs` (`show_chart`), `appointments` (`view` table or list), `attention`, `labs`, `calendar`, `queue`, `collections` (`weeks` 4, 8 or 12), `timeline`, `recent_patients`, `team_today`, `revenue_mix`, `pending_payments`, `busy_hours`. Each carries its zones, sizes, default, options and `requires` (the permission that shows it: money widgets `finance.view`, `pending_payments` `billing.read`, `labs` `labs.read`, `recent_patients` `patients.read`, the rest `appointments.read`; metrics have their own). Saving does not check `requires`: a clinic default may hold widgets some roles never see, and the board hides them.
- **Templates:** `medsync` (the built-in default), `executive`, `care`, `focus`, `compact`, `front_desk`. The catalogue carries each template's full layout, so "Reset to template" saves it.
- **Levels.** `PUT/GET/DELETE /settings/dashboard-layout` is the clinic default (`settings.manage`); `GET/PUT/DELETE /me/dashboard-layout` is the member's own (any member, keyed by membership, so it follows them across devices). Reading `/me` falls back to the clinic default, then MedSync; `source` says `member`, `clinic` or `template`. Reset (DELETE) removes the row and returns what applies now. Every response carries the catalogue.
- **Validation.** A bad layout is `400` `invalid_layout`, naming the place (`items[2].opts.weeks`), never the value: unknown or repeated widget, a zone or size the widget does not allow, an unknown option, an option out of range, another version, an unknown field. Options left out are saved with their defaults. A stored layout the registry no longer accepts (a widget retired later) is skipped on read, so the next level shows instead of an error.
- **Data rules.** `dashboard_layouts` (ephemeral: a reset deletes) has `org_id`, RLS, the composite key to `memberships`, the restrictive `patient_account` deny, one clinic row and one row per member (partial unique indexes) and a 16 KB cap. It holds no patient data: no erasure step and no retention class; the change history records it unmasked.

**Why.** Portal v2 lets a clinic and each person arrange the Today board; the server owns the rules so every client (portal, phone) renders and edits the same thing.

**Not done.** Layouts per role or per branch; the board itself (U1) and the Studio editor.

## 2026-10-10: Campaigns

**Decision.** An owner can send a promotional offer to an audience (migrations 0380 to 0383), backend only. `campaigns.manage` goes to owners (backfilled); direct sends to a few patients keep `messages.send`. Support never reads these tables (`no_support`), and campaigns write ordinary `messages`, so consent, opt-out and quiet hours stay in `app.message_dispatch` and are not repeated.

- **Audiences** (`audiences`: name and one typed `filter`, evaluated when the campaign sends by `app.audience_patients`): all active, last visit before or after a date, birthday month, age band, sex, tag. Balance, treatment and visit-kind filters do not exist (purpose limitation: health and money data are not marketing data). A patient never seen matches neither last-visit bound; no birth date matches neither age nor birthday. `POST /audiences/preview` returns only `count`, `count_token` and `expires_at`.
- **Count token.** `<expiry>.<sha256 hex>` over clinic, caller, canonical filter, count and expiry (15 minutes). `POST /campaigns/{id}/schedule {count_token}` recomputes the audience's count and the token; expired, stale (the count moved), another filter, or another caller is `409`, a malformed one `400`. It is a hash, not a keyed MAC: the server never trusts the client's count, so forging one gains nothing beyond skipping the preview. Move to an HMAC once a platform signing key exists.
- **Campaigns** (name, audience, `promo.offer` template of the channel, `email` or `whatsapp`, `offer_text` one line up to 300 characters, `scheduled_at`, status draft, scheduled, sending, sent, cancelled). `offer_text` is allow-listed for `promo.offer` (`{{offer_text}}`) and is the email body; the name is the email subject. Only a draft changes; scheduling needs an approved template and a time not more than an hour past; a scheduled or sending campaign fixes its audience's filter and keeps it from being deleted. Cancelling skips queued messages (`campaign_cancelled`).
- **Fan-out** is a step of the outbox job (`app.campaigns_fan_out_next`, 500 patients a call, at most 20 calls a run). It reads the audience after a stored cursor, queues `messages` with `dedupe_key` `campaign:<id>:<patient>` and purpose `promotional`, and moves the cursor in one transaction, so a crash loses nothing and a rerun, even from a lost cursor, queues nothing twice. The campaign is `sent` when every recipient is queued; sending goes on message by message.
- **Caps** (from `org_settings.notifications`): `promo_per_patient_per_week` (default 2): a patient with that many promotional messages queued or sent in 7 days gets a message skipped as `frequency_cap`, so the count shows it. `promo_daily_cap` (default 200 a clinic a UTC day): the rest are scheduled for the next days with room, never dropped.
- **Kill switch.** `ARO_CAMPAIGNS__ENABLED` (default true). False stops every fan-out and makes `app.messages_claim` leave campaign messages unclaimed (queued, leases included) until it is true again; other messages go on.
- **Counts** are `group by status, skip_reason` over the campaign's messages (`GET /campaigns`, `GET /campaigns/{id}`); nothing is stored.
- **Test-send** (`POST /campaigns/{id}/test-send`) emails the campaign to the caller's verified sign-in address (the token's, never one in the request) through the staff outbox as `campaign.test`: no patient, no `messages` row, not counted. `app_user` cannot read `users.email`, hence the token.
- **API** (all `campaigns.manage`): `GET/POST /audiences`, `GET/PATCH/DELETE /audiences/{id}`, `POST /audiences/preview`, `GET/POST /campaigns`, `GET/PATCH /campaigns/{id}`, `POST /campaigns/{id}/schedule`, `/cancel`, `/test-send`.
- **Data rules:** `audiences` (ephemeral, so an unused one can be deleted) and `campaigns` (mutable) have `org_id`, RLS, composite keys, the restrictive `patient_account` deny and `no_support`; neither holds a patient, so no erasure step (the messages are erased with the patient). `messages.campaign_id` is nullable and promotional only. Retention class `campaigns` (sent or cancelled, 365 days after the last change; report only).

**Why.** The plan's T5: clinics want recall and festival offers, and the review replaced two-person approval with the count token, caps and the kill switch.

**Not done.** The portal composer, cost shown before sending (WhatsApp marketing is about 88 paise), a settings screen for the caps, tag management, a keyed count token, WhatsApp campaigns until a `promo.offer` template is approved at Meta, and a delivery report beyond the counts.

## 2026-10-09: WhatsApp channel and message templates

**Decision.** Patient messages can go on WhatsApp through Meta's Cloud API, approved templates only, from one shared Sakalya number for the pilot (migrations 0375 to 0377; setup, costs and steps in `docs/whatsapp.md`). It is off until credentials exist: `ARO_WHATSAPP__ENABLED` defaults to false, and WhatsApp messages are then skipped with `channel_disabled`, never failed.

- **Templates per clinic.** `message_templates` holds each clinic's copies (key, channel, language, body, Meta category, `provider_template_ref`, status draft/submitted/approved/rejected/paused, nullable DLT columns for SMS), seeded from `app.message_template_defaults()` by a trigger on new clinics and backfilled; no row without a clinic. Bodies use only their key's allow-listed `{{variables}}` (`messaging::allowed_variables`; never the patient's name or anything clinical). Email rows start approved and keep the wording in code; `POST /messages` needs the clinic's template for the channel to be approved (email without a row still sends), and the worker skips one that isn't (`template_unavailable`, `template_paused`).
- **API** (`settings.manage`): `GET/POST /templates`, `PATCH /templates/{id}` (a WhatsApp copy whose text, name or category changes goes back to draft), `POST /templates/{id}/submit` (records `submitted`; Meta submission is by hand for the pilot; a copy whose name, language and text Meta already approved for another clinic is approved at once). Meta's `message_template_status_update` webhook sets the review result on submitted copies.
- **Sending.** The outbox job claims due WhatsApp messages (`app.messages_claim`, provider `meta`, `ARO_WHATSAPP__DAILY_BUDGET`, default 250) and checks them at send time like email, plus: the patient's `whatsapp_opt_in_at` (`no_opt_in`), an approved template, no free text (refused when queued, and by the table). It sends `type=template` with the body parameters in the order the body names them. Meta 131049, 132015 and 131026 are permanent skips (`marketing_limit`, `template_paused`, `undeliverable`); 429, 5xx and rate-limit codes retry with backoff; anything else fails. `cost_paise` is the configured price of the template's category.
- **Webhook** `GET/POST /api/v1/webhooks/whatsapp`: the `hub.challenge` handshake with the verify token; `X-Hub-Signature-256` (HMAC-SHA256 with the app secret over the raw body, constant-time, 1 MB cap). Statuses (`sent`, `delivered`, `read`, `failed`; `read` added to `messages.delivery` and `message_events.kind`) are found by the definer lookup on `(meta, wamid)`, counted once each, and the furthest kept whatever the order.
- **STOP.** Inbound text is checked against `whatsapp::STOP_KEYWORDS` (English, Hindi, Marathi; whole reply only) and dropped: never stored or logged. A STOP opts out of WhatsApp (category `all`, source `stop_keyword`) every patient with that phone at the clinic it is for: the clinic of the quoted message, else the last to send that phone a WhatsApp message in 30 days, else every clinic that queued one to it (`app.whatsapp_stop`).
- **Data rules:** `message_templates` has `org_id`, RLS, the restrictive `patient_account` deny and no patient data (no erasure step); retention class `message_templates`, rejected or paused templates 365 days after their last change (report only).

**Why.** The plan's T4: WhatsApp reaches patients email doesn't, and Meta allows business-initiated messages only through approved templates with the patient's opt-in. A shared number lets the pilot start before each clinic verifies its own business with Meta.

**Not done.** Per-clinic numbers (Embedded Signup), submitting templates through Meta's API, appointment reminders on WhatsApp (the reminder job queues email only), SMS, a START keyword, and portal screens.


## 2026-10-09: Staff app API additions

**Decision.** Additions the staff phone apps asked for (migrations 0384 to 0389), all additive: no field or route is removed or renamed.

- **Chart corrections across surfaces:** a new chart entry may carry `supersedes_id`, a current dental entry of the same patient on any tooth or surface. That entry is superseded (the freeze rule still allows only `current` → `superseded`) and the new one links to it; the current entry for the new entry's own tooth and surface is superseded as before, without the link. Another patient's or clinic's entry is a 400, one no longer current a 409. The status change is audited by the table's audit trigger.
- **Seating in a chosen chair:** `POST /queue/{id}/status` takes an optional `room_id` with `in_chair` only. The room must be active and in the token's branch (else 400); it is stored on the token (`queue_tokens.room_id`, migration 0384) and the token's appointment moves to it, with a `changed` appointment event (`{"room_id": [old, new]}`). A chair already booked at the appointment's time is a 409. Sending `in_chair` again with another chair moves the patient; with the same chair it is a repeat.
- **Idempotent expenses:** `POST /expenses` takes an optional `Idempotency-Key` header, checked like payments (8 to 100 of letters, digits, `-_.:`). The key and a hash of the request are stored on the expense (migration 0385, unique per clinic when present). A retry with the same key and request returns the first expense with `200`; the same key for a different expense is a 409. Optional, so existing clients keep working.
- **UPI payment link:** `GET /invoices/{id}/upi-link` (`billing.read`) returns a `upi://pay` link and the same text as `qr_data` for an issued bill's balance, built from the clinic's UPI ID in settings, its name and the bill number. No gateway and nothing recorded: the front desk records the payment as usual. A draft or void bill, a settled one, or a clinic without a UPI ID is a 409.
- **Analytics for the phone:** `GET /reports/analytics` adds, in the same one statement and without money: `patients.sex` (female, male, other, unknown), `procedures_by_category` (done procedures by the category of the bill line that charged them, `uncategorised` when not billed; most first), `chair_time` (booked chair minutes, no-shows included: `chair_time.treatment` for procedure and emergency kinds, `consult` for new and follow-up, `admin` reserved at 0 because no appointment kind maps to it) and `visit_sources` (`booked` visits against `walk_in` tokens without an appointment, not counting those who left). Needs `analytics.view` as before; the money fields still need `finance.view`.
- **Staff avatars:** `PUT /me/avatar` (multipart, any member, their own only; migration 0386 on `memberships`) takes exactly one of `preset` (an id the apps ship, 1 to 32 of `a-z0-9_` starting with a letter; the server knows no list) or `file` (PNG or JPEG, up to 2 MB, by content, kept under the clinic's folder like the letterhead images). `DELETE /me/avatar` clears it. It is per clinic, shown as `avatar` (`preset`, `photo_url`, `photo_expires_at`) on `GET /session` (`user`), `GET /me` (each clinic, with photo links on that clinic's `host`) and `GET /staff` (members). Photos are read through signed links (`GET /avatars/{id}/content?token=`, an hour, bound to the clinic and photo, a prefix of their own so letterhead tokens don't work). No permission beyond membership.
- **Links to a patient's records:** `POST /patients/{id}/record-shares` (`patients.read`, plus `clinical.read` for `chart` and `xrays`, `billing.read` for `bills`) makes a `share_links` row with resource `records` (migration 0387, `record_types`) for one to three kinds and a lifetime of `1h`, `24h` or `7d`. Same token and PIN as prescription links, five wrong PINs lock it. `GET /shared/{token}` also returns `record_types`; `POST /shared/{token}/records` with the PIN returns the chosen kinds only; X-rays come through signed paths (`GET /shared/{token}/records/xrays/{id}?sig=`, ten minutes, never past the link). The access record gets `share` per kind, `view` per record opened and `download` per X-ray, purpose `patient_self` for the patient. `GET /patients/{id}/record-shares` lists them without secrets. No revoke yet.

**Why.** A finding charted on the wrong tooth or surface could only be marked in error and charted again, losing the link between the two.
## 2026-10-09: Patient messaging core

**Decision.** Every message to a patient is a row in its own queue, `messages` (migrations 0370 to 0373), not the outbox. **This is an exception to AGENTS.md rule 10** ("handlers write an outbox row"): handlers write a `messages` row instead, in the same transaction, and still never call a provider. The outbox stays for staff, system and lab email and is unchanged (no `patient_id`, `outbox_claim` untouched). Booking answers, prescription links and app invitations moved over, so no patient address sits in the outbox: a message holds the patient's id and is addressed when sent.

- **Send time decides.** The outbox job (`aarogyam outbox drain`) queues appointment reminders, claims due messages (`app.messages_claim`, lease plus `SKIP LOCKED`), and reads each through one definer function, `app.message_dispatch(org_id, message_id)`: the address, `app.may_contact` for the message's purpose, opt-outs, the patient's state (erased, merged, deleted, deceased), the end of quiet hours, the clinic and the appointment. `aarogyam_domain::messaging::decide` turns that into send, skip (with `skip_reason`) or wait. The worker never reads `patients` itself.
- **Consent.** A withdrawal skips the patient's queued messages of that purpose (`consent_withdrawn`, in the withdrawal's transaction); a message already claimed is stopped by the send-time check (`no_consent`).
- **Quiet hours** are per clinic in `org_settings.notifications.quiet_hours` (`{"start": "21:00", "end": "09:00"}` by default, clinic time). Reminders and promotional messages inside them wait until the end; care messages go at once. No settings screen yet.
- **Re-runs never send twice:** `unique (org_id, dedupe_key)`. Reminders use `reminder:appt:<id>:24h`; staff batches `manual:<batch_id>:<patient_id>`, so resending a batch after a lost answer queues nothing new.
- **Budget.** A platform-wide daily budget per provider (`ARO_EMAIL__DAILY_BUDGET`, default 100, Resend's free tier), counted in UTC days inside the claim; due messages beyond it move to the next day.
- **Staff sending:** `POST /messages`, 1 to 50 patients, `messages.send` (owner, doctor, front desk; backfilled). Templates are fixed in code (`messaging::Template`): `care.note` and `promo.offer` take free text and a `subject` (email only), `reminder.follow_up` an optional `due_on`; other variables are refused. WhatsApp and SMS were refused until T4 (WhatsApp now: see "WhatsApp channel and message templates").
- **Reading and preferences:** `GET /patients/{id}/messages` (metadata only, `patients.read`); `POST /patients/{id}/contact-preferences` (per channel and category `all`, `care`, `reminders`, `promotional`; `patients.write`; opting out skips queued messages it covers; `whatsapp_opt_in_at` for WhatsApp).
- **Unsubscribe:** reminder and promotional email carry `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058) pointing at `POST /api/v1/public/unsubscribe/{token}` on the clinic host. The token is 24 random bytes, stored only as its SHA-256; the answer names nobody. It opts the patient out of email for that purpose.
- **Resend webhook:** `POST /api/v1/webhooks/resend`, Svix signature over the raw body (`svix-id`, `svix-timestamp`, `svix-signature`, 5 minutes' tolerance, constant-time compare, 64 KB cap, `ARO_EMAIL__RESEND_WEBHOOK_SECRET`). The message is found by a definer lookup on `(provider, provider_message_id)`; each event is stored once (metadata only, keyed by `svix-id`), the latest report by time is kept, and a bounce or complaint opts the patient out of email altogether. Events about outbox email are accepted and ignored.
- **Data rules:** every table has `org_id`, RLS, composite keys and the restrictive `patient_account` deny; the change history masks the body, variables, secret, error and unsubscribe hash, and keeps provider events as metadata only; erasure deletes a patient's messages, events and preferences; retention class `messages`, 365 days from queuing (report only; a purge comes later). No partitioning.

**Why.** The review asked that patient messages be addressed and consent-checked at send time, with their own per-recipient queue, so the outbox stays simple and holds no patient addresses.

**Not done.** The portal composer and list, a page for the unsubscribe link in the body, the quiet-hours setting screen, WhatsApp (T4), campaigns and caps (T5), and the lab and chat parts of the plan.

## 2026-10-09: Staff chat

**Decision.** Staff chat (migrations 0390 to 0392) is one-to-one (`direct`) or group conversations between members of one clinic, in plain text (1 to 4000 characters), polled; no live connection.

- **Permission:** `chat.use`, on every standard role (backfilled). Not in the support-grant read set: Sakalya support never reads chat.
- **Who sees what:** a restrictive policy on `conversations`, `conversation_members` and `chat_messages` lets only active members of a conversation see it (`app.chat_conversation_ids()`: the caller's active clinic membership and active user, member row not left). Leavers, removed members and deactivated staff get nothing, through the API (404) and directly. Inserts check the caller is an active member and the author; only the author deletes (text and patient cleared, row kept).
- **Direct conversations** are one per pair (`direct_key` = both membership ids, smaller first, unique per clinic); starting one again from either side returns it (`200`). They can't be left. Groups have admins: the creator, then whoever an admin adds; a last admin who leaves hands the role to the earliest-joined member.
- **API:** `GET/POST /conversations`, `GET /conversations/{id}`, `POST /conversations/{id}/members`, `DELETE /conversations/{id}/members/{membership_id}`, `POST /conversations/{id}/leave`, `PUT /conversations/{id}/mute`, `GET /conversations/{id}/messages?after|before&limit`, `POST /conversations/{id}/messages` (idempotent by `client_id`, unique per author), `POST /conversations/{id}/read`, `DELETE /conversations/{id}/messages/{message_id}`, `GET /me/badges` (chat unread in unmuted conversations plus the notifications count, in one statement). The list and each page are one statement.
- **Patients:** a message may name one patient, within the author's `patients.read` reach (else 404). Fetching a page with such a message writes one access-record entry (resource `chat`, the conversation as resource id) per reader, patient, conversation and clinic day, in the same statement. Message text is masked in the change history and never logged; read pointers are left out of it. Erasure drops the patient reference and keeps the message.
- **Retention:** `chat_messages`, 365 days from posting (the table above); the report lists them, no purge yet.
- **Limits (0396, T6):** a group holds at most 100 active members, enforced by a trigger that locks the conversation and counts (`400`); starting a chat with, or adding, someone whose role lacks `chat.use` is `403`. Erasing a patient keeps the message and clears its `patient_id` (registered in `audit.erasure_steps`). `tests/support_chat.rs` proves support gets `403` or `404` on every chat route and sees no chat rows.

**Why.** Clinics coordinate over personal WhatsApp groups, which puts patient details on phones the clinic doesn't control. Membership checked in the database means a bug in a handler can't leak a conversation.

**Not done.** UI, push, archiving and renaming, and a purge job.

## 2026-10-09: Labs

**Decision.** Clinics keep their outside labs, the people there, the work sent, and what they pay (migrations 0360 to 0363). Backend only; the portal, console and phone screens come later.

- **Tables:** `lab_vendors` (kind `dental_lab`, `pathology`, `radiology`, `other`) and `lab_contacts` (several per lab; phone, email, WhatsApp flag, preferred channel), both soft-deleted; `lab_orders` (number `LAB-<n>` from `number_sequences` kind `lab_order`; lab, contact of that lab, patient, doctor as a membership, optional procedure and visit of the same patient; status, stage, instructions, sent, due, received; `rework_of_id` for a remake of the same patient's order), `lab_order_items` (work type, FDI teeth, shade, material, qty, unit cost), append-only `lab_order_events`, and finalizable `lab_payments`. `attachments.lab_order_id` is a nullable expand column; nothing reads it yet.
- **Statuses** move forward only: draft to sent or cancelled; sent to in_progress, received or cancelled; in_progress to received or cancelled; received to fitted or returned_for_rework. A remake is a new order pointing at the old one.
- **Permissions:** `labs.read` and `labs.write` (owner, doctor, assistant, front desk; backfilled to existing clinics). Both can be narrowed to `own`: the orders a member is the doctor on, created, or treats the visit of (`app.clinical_in_reach`); a new order's patient must be in reach (`app.patient_in_reach`). Unit costs are shown and accepted only with `finance.view` (setting one without it is 403). Payments need `expenses.write` and `finance.view`; listing payments and a lab's balance need `finance.view`.
- **Payments and expenses:** recording a payment records an expense in the clinic's `lab` category in the same transaction (note "Lab: <lab>, bill <ref>"); voiding the payment voids that expense, and the expense can't be voided on its own (409). The balance is the items of sent, not cancelled, orders at the lab's prices less recorded payments.
- **Reminders** are a step of the outbox job (`aarogyam_notify::remind_labs`, every 2 minutes, before delivery) through the definer function `app.run_lab_reminders`: while the clinic's own clock is 09:00 to 20:00, work still at the lab gets an email two days before its due date (`due_soon`) and on the day (`due_today`), and is flagged once when overdue (no email; it writes one `lab_overdue` staff notification per order and due date: migration 0395, `lab_order_id` and `lab_due_on`, exactly one subject; members with `labs.read` see it within their scope, decided when reading, and the feed and count return a `lab_order` brief; work received, cancelled or re-dated handles it). Each step is a conditional update of its per-day column, so it runs once per due date whatever runs overlap; a new due date clears the columns (trigger). `POST /lab-orders/{id}/remind` queues one now. Lab contacts are not patients, so these go through the outbox with `recipient` set, to the order's contact if they have an email, else the lab's first contact with one; a lab without one gets a `reminder_skipped` event and the manual remind is refused (409). The payload (`app.lab_reminder_payload`) has the clinic name, order number, work types, teeth, shades and due date, and no patient field at all. Pathology and radiology requisitions, which need patient identity, are printed or shared later and never sent in a reminder.
- **Analytics** gains `lab_turnaround`: orders received in the range and their average days from sent to received (no money; `analytics.view`).
- **Reads** are one statement each (`app.lab_order_json` builds an order with its lab, patient, doctor and items), within the round-trip budget. Reading a patient's lab orders writes no access-log entry: they are work orders, not the clinical record. Revisit if clinics treat them as clinical.
- **Changing items and the contact log** (migration 0364): `POST /lab-orders/{id}/items` (body as a create item; 201), `PATCH /lab-order-items/{id}` (fields left out stay, empty shade or material clears, `unit_cost_paise: null` clears) and `DELETE /lab-order-items/{id}` check like creation (FDI teeth, qty, a cost set or cleared only with `finance.view`, else 403; a cost the caller can't see is kept), need `labs.write` and the order's reach, and are refused (409) once the order is fitted, returned for rework or cancelled. A new item takes the line after the last (a gap once line 50 is used, 50 items at most); removing one leaves the other line numbers; an order keeps at least one item (409). Each records `item_added`, `item_changed` or `item_removed` with its `line_no`; the items' own change history is the audit (`lab_order_items` became ephemeral so rows can be removed). `POST /lab-orders/{id}/contacts-log` (`channel` call, whatsapp, email or visit; optional `contact_id` of the order's lab, `outcome` reached, no_answer, promised_date or other, `note` up to 500 characters, `promised_on`) records a `contacted` event by the caller and sets `lab_orders.last_contacted_at` and `last_contacted_by`; `promised_on` becomes `due_on` (the trigger restarts the reminders; refused with 409 on a final order). A manual remind sets them too; the reminder job doesn't. Order list and detail responses carry `last_contacted_at`, `last_contacted_by`, `last_contacted_by_name`, `contact_phone`, `contact_email`, `contact_whatsapp` and `vendor_phone`, so the portal can offer a dialler or WhatsApp button; items carry their `id`. All endpoints return the order with its history.
- **Retention:** `lab_work` (orders, items, history and payments, 8 years from the order) and `lab_contacts` (365 days after removal); see the schedule below. Audit masks: contact names, phones and emails, lab phone, email, address and note, order instructions, item work type, shade and material, event and payment notes. Erasing a patient clears their orders' instructions and event notes (contact log included); orders, items and history stay.

**Why.** The founder asked to keep lab contacts, record lab work, remind labs and pay them. Recording the expense with the payment keeps one source of truth for lab spending in Analytics; keeping the patient out of the reminder payload means a lab email can never leak who the work is for.

**Not done.** STL scans over 10 MB, WhatsApp to labs (comes with the messaging service), and payment method on lab payments.

## 2026-10-08: Clinic notifications, reminders and escalation

**Decision.** An online booking (public page or patient app) writes a `staff_notifications` row in the booking's transaction: `booking_requested` when the clinic waits for confirmation (`online_booking.auto_confirm` false, the default), `booking_confirmed_auto` otherwise. A patient cancelling in the app writes `booking_cancelled_by_patient` through `app.notify_patient_cancelled` (a patient account may not touch staff tables). Rows hold IDs only (migration 0320).

- **Who sees one** is decided when reading, not fanned out: every member whose role has `appointments.read` and whose scope reaches the appointment's doctor (`app.practitioner_in_reach`). At `own`, only their own doctor's bookings. Read state is per member (`staff_notification_reads`).
- **Handled** is set in the status change's transaction when staff confirm, decline or cancel an online or requested booking (`handled_by` is the member, shown by display name), and with no member when the patient cancels.
- **API:** `GET /notifications` (feed, `unread_only`, `limit`, `before` = last id), `GET /notifications/count` (one statement; last 30 days, at most 100), `POST /notifications/{id}/read`, `POST /notifications/read-all`, `GET /inbox`. All need `appointments.read`. The portal polls; no live connection.
- **Reminders and escalation** are a step of the outbox job (`aarogyam outbox drain`, every 2 minutes, `aarogyam_notify::remind`). A `booking_requested` still unhandled after `online_booking.reminder_minutes` (default 15, 5 to 240) while the clinic is open by its own clock gets `reminded_at` and a `booking_reminder` inbox message for the clinic (same audience as the notification). After as long again since the reminder it gets `escalated_at` and a `booking_escalation` message addressed to members with the owner role. So a night booking is reminded at opening and escalated N minutes later, never both at once. Each step is recorded once (`app.record_booking_request_step`), whatever runs overlap. Requests whose appointment already started, and suspended clinics, are skipped.
- **Inbox** (`staff_inbox_messages`) is append-only; a message is open until its notification is handled.
- **Opening hours:** clinics can't set them yet, so the job uses 09:00 to 21:00 in the clinic's time zone (`OpenHours::DEFAULT`). When clinic opening hours exist (Track B), pass them instead.
- **Push** plugs in at `StaffChannel` in `aarogyam-notify` (in-app only now; the rows are the delivery). FCM/APNs payloads will carry `StaffAlert`'s IDs only.

**Why.** Founder testing found online bookings went unnoticed. Deciding visibility at read time keeps scope changes and new staff correct without backfills; IDs only keep notifications safe to push and log.

**Not done.** Portal bell, Today's unhandled list, and the staff app list and push (UI and credentials pending).

## 2026-10-08: Erasure job

**Decision.** Patient records past retention are erased by `aarogyam erase` (migrations 0344 to 0346), building on the retention report.

- **Legal hold and override first.** `patients.legal_hold` (with reason and time; `PUT /patients/{id}/legal-hold`, `settings.manage`) stops erasure; it doesn't make a front desk edit stale. `org_settings.patient_retention_years` (7 to 50, null = the default 7) lets a clinic keep longer, never shorter (`aarogyam admin retention-years`).
- **Dry run by default.** `aarogyam erase [--clinic <slug>]` logs per clinic how many patients are past retention (last visit, appointment, bill or registration older than the clinic's years; children until 21) and how many legal holds keep (`erasure.planned`). `--apply --clinic <slug> --log-file <path>` erases that clinic only, one transaction per patient, appending each erased id to the log file as it goes and logging `retention.applied` with the count.
- **What erasure does** (`app.erase_patient`, owner only): the patient row becomes a tombstone (id, number, `status = 'erased'`, `erased_at`, soft-deleted) with name (`Erased`), phones, email, address, birth date, blood group and tags cleared; the rows of every table registered in `audit.erasure_steps` are deleted (identifiers, link codes, share links, missing-details entries, front desk notes, recalls), updated (app links revoked, imported spreadsheet cells and the bill's printed recipient cleared; lines and totals stay) or kept; `audit_events.changes` of the patient and of every registered row is scrubbed (who and when stay); `audit.erasure_log` records the id. Consents stay with the tombstone. Append-only and final rows refuse changes except inside an erasure (`app.erasure`, never for the API's roles).
- **Registry.** `audit.erasure_steps` says per table how to find the patient's rows (a filter, `patient_id = $2` by default) and whether to delete, update (a SET clause) or keep them. A new table holding patient data (labs, messages, chat) adds its row in its own migration; a test fails while any `aarogyam` table with a `patient_id` isn't registered.
- **Restores.** The log file outside the database is replayed after any restore (`aarogyam erase --replay <path>`), erasing again whoever came back, whatever their state then (docs/ops.md).
- **Not yet:** clinical content (notes, observations, conditions, allergies, charts, plans, prescriptions) and files are kept (registered `keep`); deleting them, their Storage objects and voice notes is the next step, as is the `erased` status in the portal and a patient's own erasure request.

## 2026-10-08: Retiring and renaming dental terms

**Decision.** A clinic's own dental terms (`dental_terms`) can be renamed and retired (migration 0342, expand only). `GET /dental-terms` lists the clinic's additions with who added and retired them (`clinical.read` or `settings.manage`); `PATCH /dental-terms/{id}` renames, `POST /dental-terms/{id}/retire` and `/restore` retire and bring back (`settings.manage`, owner by default).

- **History shows the current label.** Chart entries name a term by id and are never rewritten, so a rename shows on old entries too. Renaming is for fixing how the same thing is written ("Lithium silcate" to "Lithium silicate"); the change history keeps every old label. To change what a term means, retire it and add a new one. A rename to a standard term's label or to another of the clinic's labels is refused (`409`).
- **Retired** terms leave the chart's type-ahead and are refused for new entries, but old entries keep showing them, as retired seeded terms already do. Adding the same label again brings the term back instead of making a twin.
- The table is now mutable for `label`, `retired_at` and `retired_by` only (column grants and a trigger); nothing is ever deleted.

## 2026-10-08: Support grants

**Decision.** Sakalya staff read a clinic's records only under a support grant (migrations 0340 to 0341). A clinic owner (`support.grant`, owner only by default, backfilled for existing owners) names one active staff member by sign-in email (platform role `owner` or `support`), gives a reason (3 to 500 characters) and an end 15 minutes to 7 days away; the grant starts at once. `POST /support-grants`, `GET /support-grants`, `POST /support-grants/{id}/revoke` and `GET /support-grants/{id}/actions` are on the clinic host; `GET /console/support-grants` lists a staff member's grants on the console host. One active grant per staff member per clinic. Nothing about a grant changes except its revocation (a trigger), and it ends by itself at `ends_at`.

- **Read-only.** While a grant is active, the staff member uses the normal clinic routes on the clinic's host with their own token (the clinic still comes from the host). Only routes that name a permission (`Require`, `RequireEither`) admit them, never member-only routes such as `/me/working-hours`. Their permissions are fixed: `patients.read`, `appointments.read`, `clinical.read`, `billing.read`, `inventory.read`, all at `all`. Contact details stay masked; money reports, the change history, settings and every write are refused (`403`), and file downloads are refused because signed links don't carry the grant. The transaction runs with actor kind `support`; `app.set_row_meta` refuses any insert or update from it, so a route that forgot to refuse a write still fails in the database. Console writes by staff (inviting a clinic's doctors) now record actor kind `platform` instead of `support`.
- **Audited per request.** `app.support_authorize` checks the grant, records the sign-in session (so it can be revoked) and writes one `audit.support_actions` row per request (grant id, staff user, method, route template, request id) in the same round trip, before the handler runs. Patient reads also write the access record with actor kind and purpose `support`. The clinic sees the actions per grant.
- **Second factor.** As in the console, support access needs `aal2` when `auth.staff_mfa` is on.
- **Not built:** the console and portal screens (the founder asked for backend only), write access (a later `access` value such as `settings` if a clinic asks), and a request flow where staff ask and the owner approves.

- **Never read by support (0397, T6):** chat, the messages the clinic sent patients (with their provider events) and contact preferences. Support holds `patients.read`, which opens `GET /patients/{id}/messages`, so a restrictive `no_support` policy on `messages`, `message_events` and `contact_preferences` returns no rows to actor kind `support` (the list is empty, not an error). A clinic that wants support to see message metadata needs a new decision and a grant `access` value.

**Why.** Staff can't hold memberships (0172), so support needs its own narrow door. Reads through the existing routes keep row-level security, scopes and the access record in force without a parallel API; fixing the permissions in code means a clinic's role edits can't widen support access.

## 2026-10-07: Analytics: chair utilization and material costs

**Decision.** `GET /api/v1/reports/analytics` (`analytics.view`, owner by default; money figures null without `finance.view`) reads everything in one statement in one clinic transaction.

- **Chair utilization** = booked minutes ÷ open minutes, per chair (rooms of kind `chair`) per month or week. Booked minutes are the lengths of appointments starting in the period that are not deleted, cancelled or unconfirmed online requests; no-shows count, because the chair was held. Open minutes come from the **opening hours of the chair's branch** (`clinic_hours`, migration 0330, `GET/PUT /clinic-hours`): each day of the period inside the range counts that weekday's open minutes, split shifts added up, and a closed day counts zero. A chair whose branch has no opening hours falls back to **9 hours (540 minutes) on every calendar day**; each chair says which it used (`uses_clinic_hours`) and the response carries the fallback as `open_minutes_per_day`. The figure can pass 100% when a chair is booked for longer than it is open. Clinics that existed got their opening hours once from the union of their active doctors' hours (the setup wizard had copied the clinic's hours onto each doctor); after that the two are kept apart, and the wizard should save the clinic's hours too.
- **Stock purchases count as material.** Expenses per category are the recorded (not void) `expenses` rows plus stock received in the period at cost (`stock_batches.received_quantity × unit_cost_paise`, by `received_on`), added to `material`. Stock is not copied into `expenses`, so it can't be counted twice or drift; `stock_purchases_paise` shows the stock part. A clinic that also enters a material expense by hand for the same delivery counts it twice; the expense form should say so.
- **Patients.** A visit is an appointment not deleted, cancelled, a no-show or an unconfirmed request. A patient is **new** in the period of their first such visit ever, **returning** in later periods. Age bands use the date of birth on the report's last day; referral counts are by the referral source's kind (not its name, which may name a person), for patients whose first visit is in the range.
- **Range.** The last twelve calendar months by default, at most 731 days (24 months).

## 2026-10-07: Staff authenticator is a setting, off in the demo

`auth.staff_mfa` (`ARO_AUTH__STAFF_MFA`, default on) controls whether Sakalya staff need an authenticator code (`aal2`) for the console; the console reads it from `/me` (`staff_mfa_required`). It is off in the demo deploys (`STAFF_MFA` unset) and **must be on before real patient data** (pilot: `STAFF_MFA=true`).

## 2026-10-07: Patient accounts, links and the patient API

**Decision.** Patients sign in with Supabase email codes into a platform `patient_accounts` row (no clinic data). They read a clinic's records only through an active `patient_links` row made by a clinic-issued link code or by a match the clinic confirms; never by phone or name. Patient reads run in a normal clinic transaction with actor kind `patient_account`, and restrictive `patient_account` policies on every clinic table limit them to the linked record (deny by default for new tables, checked by the schema lint). Cross-clinic reads live on the app host and aggregate per linked clinic; writes for one clinic (book, cancel) and file downloads go to that clinic's host, so the clinic still comes from the host. Patients see appointments, issued prescriptions, issued bills and files the clinic marked shared; notes and the chart stay internal (D3). Booking from the app reuses the public booking rules in the public scope, for the linked record.

**Sessions (8 Oct).** Patient app sessions are recorded in `patient_sessions` by the same one-trip `app.patient_access` (a new four-argument version; the old one stays for a rolling deploy). The patient lists them (`GET /me/patient/sessions`) and signs one out (`DELETE /me/patient/sessions/{id}`, `204`, another account's id `404`); the signed-out session gets `401` from its next request, as no patient access is cached.

**Why.** RLS keeps enforcing isolation without a second database role, and a patient bug can only under-show, never leak another record. Codes and confirmed matches satisfy "verification before linking" without paid SMS.

## 2026-10-06: Bringing in a clinic's existing records

**Files (built).** A clinic uploads its own CSV or Excel file in whatever layout it has (`POST /api/v1/imports/sessions`, web Patients → Import).

- **Parsing in the API, never stored as a file.** CSV in any delimiter (comma, semicolon, tab, pipe) and encoding (UTF-8 with or without a byte-order mark, UTF-16, else Windows-1252, which Excel on Windows writes); `.xlsx` by content (calamine), first sheet or one chosen by name; old `.xls` is refused with "save as .xlsx or CSV". Limits: 5 MB streamed and refused at the first byte over, 64 MB unpacked (zip bombs), 5,000 rows, 100 columns. The parsed rows live only in an `import_sessions` row: cleared on commit, on discard, and 24 hours after upload (ended when the clinic next uploads), and excluded from the audit log. The original file is not kept; keeping it would need a clinic-level attachment the clinic can delete, which doesn't exist yet (`attachments` belong to a patient).
- **Mapping without AI.** The header row is found below any title rows. Each column gets a suggested field from its header (English, Hindi and Marathi synonyms in Latin letters and Devanagari: "Naav", "Mobile No.", "Vay", "Ling", "Patta", "Baki"; headers about someone else, such as "Father's name", never match), from its values (Indian phones, day-first dates and month names, ages such as "32 yrs", sex words, emails; serial-number columns are ignored), and from what the clinic chose last time for the same header (`import_column_memory`, saved on commit). Each has a confidence; a header contradicted by its values is doubted. Each field goes to one column. The clinic reviews and changes the mapping before anything is checked.
- **Missing data: import what is present, never invent.** Only a row without a usable name fails. Unreadable values are left empty with a warning that never repeats the value; two-digit years are refused rather than guessed. A new patient lacking a phone, sex or date of birth (or age) is imported and put on the front desk's to-do list (`patient_gaps`, `GET /api/v1/imports/incomplete`); what is still missing is worked out from the current record, so filling a detail clears it, and "Can't get these" dismisses an entry. Balances are recognised (so they aren't mistaken for another field) but not imported: opening balances belong in billing.
- **Duplicates by phone and name** (lower case, single spaces), against the clinic's patients and earlier rows. Rows without a phone are never called duplicates. The clinic chooses skip (default) or merge, per file and per row, or "import as new". A merge only fills empty details (sex when unknown, date of birth, email, address, last visit, identifiers); it never overwrites.
- **Review before commit.** Preview shows each row's result, missing details, warnings and the values as they will be saved (contact details hidden without `patients.contact`), and saves nothing. Commit is one transaction per uploaded file (the batch, at most 5,000 rows), locks the session so concurrent commits serialise, and is idempotent: a second commit returns the recorded result. Each row is recorded in `import_rows` against its import, which carries the file name, sheet and session: the source reference of every imported record.
- **Round trips:** upload 3, preview 4, a first commit at most 9 (one statement per table written), a repeated commit 4, the to-do list 3.

**Paper (designed, not built).** Photographed or scanned case sheets become patients through extraction, with the same review and to-do list.

- **Upload:** the phone or web uploads images or PDF pages as a batch; each page is stored as a clinic-level import attachment in Supabase Storage (Mumbai) that the clinic can delete, and becomes an `import_sessions` row with `file_kind = 'scan'`.
- **Extraction is a background job, never in the request path:** the upload writes an outbox row; the worker sends the page to the provider, stores the extracted fields per row with a confidence per field and the page region they came from, and marks the session ready. Failures retry with the outbox's backoff and end as "needs manual entry", never as guessed values.
- **Provider requirements, all contractual and checked before use:** no training or retention on our data (zero data retention, or deletion within the request); processing in India where the law or a clinic requires it, else a region listed in the clinic's data-processing agreement; a data-processing agreement naming Sakalya as the fiduciary's processor (DPDP Act); encryption in transit; no human review of content; audit of each call by session id (never content). Candidates are evaluated against these, not by brand; an on-device or self-hosted OCR model (on Cloud Run in Mumbai) is the fallback if no provider qualifies. The extraction prompt asks only for fields on the page and for "unreadable" instead of a guess.
- **Side-by-side review:** each page is shown next to its extracted fields, every field highlighted on the page and marked by confidence; low-confidence fields start empty. Nothing becomes a record until a person confirms the page. Confirmed rows go through the same commit as files (lenient rows, duplicates, to-do list), with the scan id, page and region as the source reference; extracted clinical history arrives as `source = 'ai_draft'` and needs a clinician's confirmation.
- **Cost:** within the free tier or the clinic's plan; a per-page counter shows usage before a batch is sent.

## 2026-10-05: Central sign-in and the session handoff

- **People sign in once, on the public site** (`aarogyam.sakalyatechnologies.com/sign-in`). `/me` then decides: Sakalya staff to the console, one clinic to that clinic, several to a picker. Portals send signed-out visitors there with `?next=<host>` (console: `?next=console`) when `VITE_CENTRAL_SIGNIN_URL` is set, which `scripts/deploy-workers.sh` does for every deployed build; local development (unset) keeps the in-app sign-in. The site honours `next` only for a host `/me` lists. Signing out on a clinic host returns to the site.
- **A session belongs to one origin, so it is handed over, not shared.** `POST /api/v1/auth/handoff {host}` (signed in) returns a random 32-byte code valid 60 seconds, bound to the person and that host, only for an active member of that open clinic or staff for the console (otherwise `404`). The browser goes to `https://<host>/auth/handoff#code=…`; the fragment never reaches a server or log. `POST /api/v1/auth/handoff/redeem {code}` on that host uses the code up on the first attempt, right or wrong, and answers with a Supabase magic-link token hash (`generate_link`, nothing emailed) that the page trades with `verifyOtp` for a session of its own; locally, a development token. Only the code's SHA-256 is stored (`auth_handoffs`, migration 0161); both steps are in the change history and logged as `handoff.*` events; redeem is throttled to 20 per IP per 10 minutes.
- **`/me` says `console_access`** for active Sakalya staff. Staff only: the console; staff with clinic memberships: the picker with "Sakalya console" first. **Super admin accounts should be separate from clinic accounts;** support access to a clinic goes through time-limited grants (built 8 Oct, see "Support grants"). Enforced in the database (migration 0172): active platform staff can't hold an active clinic membership or accept an invitation, and the last active owner can't be removed.
- **Slugs stay readable.** The approve form checks the address as it is typed (`GET /api/v1/console/slugs`) and offers `<name>-<city>` or a three-character suffix when it is taken; the unique constraint has the final say.

## 2026-10-05: Automatic clinic addresses

**Problem.** The clinic comes from the host name, and workers.dev has no wildcard subdomains, so every clinic needed its own Worker (`<slug>-aarogyam.<account>.workers.dev`) deployed by hand. A clinic the founder had just created or approved had no address, so its owner couldn't sign in.

**Decided with the founder.** Addresses stay readable, host-based subdomains: `<slug>-aarogyam.spring-snow-130f.workers.dev` now, `<slug>-aarogyam.sakalyatechnologies.com` later, never UUIDs. Clinics' own domains map a host to the clinic id later (Cloudflare for SaaS).

| Option | Cost | Security | Founder must |
|---|---|---|---|
| **B1. Recommended: one portal Worker on a wildcard route, `sakalyatechnologies.com` nameservers moved to Cloudflare's free plan** (GoDaddy stays registrar) | $0. Universal SSL covers one level (`*.sakalyatechnologies.com`), so `<slug>-aarogyam.` works; `<slug>.aarogyam.` would need Advanced Certificate Manager ($10 a month) | No per-clinic API calls and no token in the backend. DNS for the whole company domain moves, so every record must be copied first | Follow the checklist in `deploy.md` ("Moving the domain to Cloudflare"): copy records, verify, switch nameservers, add the wildcard record and route |
| **A. Interim, built: a Worker per clinic through the Cloudflare API** | $0. Free plan allows 100 Workers per account, so about 95 clinics on workers.dev. Service bindings add no cost | The token ("Workers Scripts: Edit") can change any Worker in the account, so only the outbox job holds it, never the API service or a browser. Names come from a parsed `Slug` and must match the stored host. Platform Workers can't be overwritten | Create a dedicated token once; run the backfill once |
| **B2. B1 on a separate cheap domain** | About $10 a year (Cloudflare Registrar, at cost) | As B1, and the company domain's DNS is untouched | Buy the domain. Breaks "zero spend" |
| **C. Cloudflare for SaaS custom hostnames** | First 100 free | Each hostname is validated | Still needs a zone on Cloudflare, plus a CNAME per clinic in the hostname's own DNS (GoDaddy, by hand). Kept for clinics' own domains (`www.smilecatchers.in`), as planned |
| **D. DNS records through GoDaddy's API** | Since 2024 the production Management and DNS APIs need 10 or more domains in the account or a paid Discount Domain Club plan | A GoDaddy key could change every DNS record of the company | Pay or hold 10 domains. It doesn't solve the problem anyway: a GoDaddy CNAME to workers.dev isn't served, because Workers only answer hostnames in Cloudflare zones |

**Decision: B1 as the destination, A until the nameservers move.**

- **B1: a new clinic needs no deploy at all.** A proxied wildcard DNS record and a Worker route send every clinic host to the portal Worker, which already forwards the request's own host. The route `*-aarogyam.sakalyatechnologies.com/*` is safer than `*.sakalyatechnologies.com/*`: a route matches by host name whatever the DNS says, so the broad one would also catch other products' proxied subdomains. More specific routes win, so `console-aarogyam.sakalyatechnologies.com/*` goes to the console Worker and `aarogyam.sakalyatechnologies.com/*` to the public site. Explicit DNS records (mail, the company site, other products) keep overriding the wildcard record.
- **A is automatic today.** A new portal host is queued as `pending` by the database whatever path creates it (console, approved application, seed). The outbox job (`aarogyam outbox drain`, every 2 minutes) handles addresses before email, so the owner's invitation link works when it arrives. It uploads a tiny Worker named `{slug}-aarogyam` whose only job is to hand every request to `aarogyam-portal` through a service binding, then turns on its workers.dev address. Both calls are idempotent. Failures are retried with the outbox's backoff, then marked `failed` with a reason.
- **The clinic Worker holds no secret.** The portal Worker reads the clinic's host from the request URL, which only Cloudflare or our own bindings can set, and forwards it with the edge secret as before. A portal release reaches every clinic without redeploying anything.
- **Status lives on `org_domains`** (`edge_status`, migration 0160), not in the outbox. Outbox rows are messages and are purged after 30 days, but the console needs the status for good. The console shows "Address ready / pending / failed".
- **Moving from A to B1 needs no code or console change.** Set `ARO_EDGE__HOSTS=wildcard` (the job then marks hosts ready without calling Cloudflare) and `ARO_HOSTS__PORTAL_HOST_TEMPLATE={slug}-aarogyam.sakalyatechnologies.com`, re-point existing hosts, remove the job's Cloudflare token, and delete the per-clinic Workers.

## 2026-10-07: Clinic sites go live

**Problem.** Publishing in Settings, Website saved a flag and showed a placeholder address; nothing served the site.

**Decision.** Reuse the automatic address design (2026-10-05) with a second host kind.

- **A `site` host next to the `portal` host.** Publishing writes `org_domains` (kind `site`, migration 0240) through definer functions that take the clinic from the transaction, never an argument; the outbox job claims it like a portal host and uploads a `<slug>-site` Worker bound to the shared `aarogyam-site` Worker. Status is `pending`, `ready` or `failed`, shown in Settings. Free address `<slug>-site.spring-snow-130f.workers.dev` now, `<slug>-site.sakalyatechnologies.com` with `wildcard` later: only configuration changes.
- **Take down removes it.** The API 404s at once (the host stops verifying); status `removing` lets the job delete the Worker and the row, so the 100-Worker limit isn't spent on dark sites. Publishing again recreates it.
- **Public by construction.** `aarogyam-site` forwards only `GET /api/v1/public/site` and its pictures; every other `/api` path is a 404 at the edge. The API returns the same 404 for an unpublished site, a clinic with no site host, and another clinic's host. Booking stays the portal's `/book` page, framed.
- **No placeholders.** Defaults are local (`localtest.me`); `scripts/cloud-run-deploy.sh` and `scripts/demo-api.sh` set the real templates.

## 2026-10-04: The visit record (M4)

- **Clinicians are memberships.** Visits, notes, procedures and plans point at `memberships`; a doctor's practitioner record (registration, fees) hangs off the same membership. `encounters.appointment_id` has no foreign key until the appointments table merges; a follow-up migration adds the composite key.
- **Final means frozen by trigger.** `app.freeze_when()` lets a signed note, a recorded reading, a chart entry or a done procedure only move to its allowed next status (entered in error, corrected, superseded); corrections are new rows. Every child of a visit carries `patient_id` with a composite key `(org_id, encounter_id, patient_id)`.
- **Only a note's author edits or signs it;** any clinician may add an addendum or mark a signed note entered in error with a reason.
- **Clinical flags need only `patients.read`:** everyone who can see the patient learns that flags exist and how many; substances and conditions need `clinical.read`.
- **Files are typed by their content** (JPEG, PNG, PDF, DICOM), stored at `<clinic>/<file>` behind a `Storage` trait (local disk in development, a private Supabase Storage bucket in the cloud), and served through five-minute HMAC links that write the access record.

## 2026-10-03: Fourth review (three independent principal engineers) and the build plan

Three reviewers checked strategy and cost, the library code, and the database design before coding (71 findings, 17 marked P0; full reports are summarised in `delivery-plan.md`). Decided with the founder:

- **Today's target is a walking skeleton:** libraries fixed, the M1 migrations, the full request pipeline and patients (create, read, search) with isolation tests, docs a senior engineer can onboard from. Invitations, the console API and staging come next.
- **CI/CD is parked.** Workflows run only by hand; the local pre-commit hook is the gate. When resumed, builds and deploys move to Google Cloud Build as in MyDwarpal, because GitHub Free has no environments, branch protection or approvals for private repositories. **All repositories stay private.**
- **Local Postgres first,** shaped like Supabase (a non-superuser owner). A Supabase project arrives with staging; migrations are tried on it once before then.
- **Database:** statuses are text with CHECK constraints, not enums (enums defeat indexes under row-level security). Tables in `aarogyam`, the change history and access record in `audit`, nothing in `public`, Supabase's Data API off. The API logs in as `aarogyam_api`, which can't read anything outside a clinic transaction; lookups before the clinic is known are three audited definer functions. Every table has a lifecycle. The change history stores changed columns only.
- **Change history and access record are records, not logs.** They stay in the database (same transaction as the change or read, queryable per patient), about 13 months hot, then archived to Cloud Storage. Application logs go to Cloud Logging.
- **Edge trust:** the API accepts the forwarded host and client IP only with Cloudflare's secret header. Phone apps call a neutral host for their clinic list, then the clinic's own host.
- **Connections:** Supabase's pooler in session mode (sqlx prepared statements are unsafe in transaction mode), TLS with certificate checks, timeouts on every transaction.
- **Prescription links in the pilot** open with a PIN printed on the prescription, sent from the clinic's own WhatsApp; OTP comes after DLT and Meta verification, which start now.
- **Doctor app in 1A is online-first:** a local read cache and a durable queue of drafts; phone dictation (free) plus recordings. No sync engine yet.
- **Appointments:** the hard rule is one appointment per chair at a time; a dentist double-booked across chairs gets a warning.
- **Plan changes:** a free staging deploy becomes M2.5; patient import from Excel/CSV joins M3; background jobs are triggered by Cloud Scheduler.
- **Web track started in parallel:** the shared UI kit gains forms, dialogs and a data table; the clinic portal and super-admin console run on sample data until the API serves them.

## 2026-10-03: Final review before freezing the foundation

A third review found the design ready to implement. Four small changes were applied:

- **Offline signing conflicts:** signed clinical records are never merged automatically. A change that collides with a note already signed on the server is kept as a separate note with status `conflict`, linked by `conflicts_with_id`. Its author resolves it by marking one version `entered_in_error` with a reason. "Latest change wins" applies only to non-clinical fields.
- **Share links** use typed, tenant-aware foreign keys (`prescription_id`, `invoice_id`, `attachment_id`) with a check constraint, instead of a generic resource id.
- **Branch access** moves from an array on `memberships` to a `membership_branches` table. No rows means every branch.
- **Consent purposes** are care, referral and insurance. Research consent is out of scope; adding it later needs its own decision and ethics review.

**Phase 1A scope is frozen,** and the web portal and doctor phone app ship together, as decided. The golden clinic journey is the hard build order, so each step works end to end before the next starts. New ideas go to 1B or Phase 2.

**Next:** freeze the foundation schema and write the first migrations.

## 2026-10-03: Cloudflare, domains and startup credits

**One Cloudflare account for all Sakalya products,** owned by the company identity, with each product in its own zones and teammates as members. The same rule applies to Google Cloud and Supabase: one company login, separate projects per product.

**Cloudflare stays thin:** static hosting, the `/api` proxy, DNS, attack protection, Cloudflare for SaaS, Access, Turnstile, Web Analytics, and R2 for public images only. No D1, KV, Durable Objects, Queues, Workers AI or paid add-ons. Architecture details are in `architecture.md`.

**Domain not chosen yet.** `aarogyam.com` (registered 2005), `aarogyam.in` (2012), `aarogyam.app` (2018), `aarogyam.co.in` and `aarogyam.org` are taken. Candidates still available on 3 Oct 2026: `aarogyam.health`, `aarogyam.care`, `aarogyam.clinic`, `aarogyam.io`, `getaarogyam.com`, `myaarogyam.com`, plus `aarogyam.dev` for staging. Long-held registrations signal trademark risk, so the IP India search comes before buying. Only one main domain is needed: clinic subdomains are free and unlimited under a wildcard record and certificate. Docs use `aarogyam.example` until then. Buy just before the first pilot.

**Startup credits are timed, not rushed.** Credits usually expire after 12 months.
- **Now:** a company-domain email and Startup India (DPIIT) recognition.
- **About a month before the pilot:** Cloudflare for Startups (bootstrapped tier, $5K, needs a company-domain email), Google for Startups Start ($2K) and Supabase (up to $3K).
- **As usage grows:** PostHog ($50K) and Sentry.

## 2026-10-03: The product is Aarogyam; permanent identifiers stay neutral

**Decision.** The product name is spelled **Aarogyam**. Identifiers that can never be renamed carry no brand: Google Cloud projects `sakalya-clinic-staging` and `sakalya-clinic-prod`, app IDs `com.sakalya.clinic` and `com.sakalya.patient`. Names that can change later (repositories, crates, services, UI text) use the brand.

**Why.** A future rename should only cost a find-and-replace, a repository rename and a domain redirect. App store IDs and cloud project IDs can never change.

## 2026-10-03: Gaps found against existing clinic software

**Added.**
- **Prescription safety:** an allergy check in Phase 1A. Drug interactions, contraindications, pregnancy and breastfeeding cautions, child dosing and precautions from a licensed drug database in Phase 2. Overrides are recorded with a reason (`prescription_alerts`).
- **Quick Rx:** repeat the last prescription and favourites per diagnosis (1A); AI suggestions later.
- **Phase 2 additions:**
  - Smart Scan (`document_extractions`, confirmed before use)
  - AI past-visit summaries
  - teleconsultation, moved from phase 4 (`teleconsult_sessions`)
  - a light patient page on share links
  - doctor-facing prescription analytics
- **Pricing hypotheses:** bundled message credits and support tiers per plan.

**Not adopted.** Diagnostic decision support (conflicts with "AI never diagnoses" and may be regulated as a medical device) and paid research on clinic data (a trust risk for a privacy-first product).

## 2026-10-03: Review outcomes (product brief and database)

Two independent reviews were checked against the repository; agreed points are recorded here.

**Phase 1 is split.** 1A: Aarogyam Core plus the Dental pack, web portal and doctor mobile experience, with 3 to 5 dental clinics (Smile Catchers first). 1B: General Medicine as the second pack, proving the Specialty Pack architecture before more specialties.

**Product boundaries.** Internally Aarogyam is Clinic OS (practice operations), Patient (the patient's own health record, phase 3) and Platform (identity, consent, notifications, payments, audit, integrations). Specialties are **Specialty Packs**: forms, schemas, views, dashboards, vocabulary and permissions as data on top of Core. Customers see one brand.

**Foundation = the golden clinic journey.** Patient, appointment, arrival, visit, dental chart, treatment, prescription, bill, payment, follow-up, with isolation and audit. Plans, subscriptions and feature flags arrive when pilots need them.

**Clinical data levels.** Patient-level (allergies, problem list, history, long-term medicines), episode-level (`care_episodes`, optional, built when a pack needs it), visit-level (complaint, vitals, notes, procedures, prescriptions) and specialty state (longitudinal `specialty_records` with status and supersession). Clinical codes are optional columns; free text always works. Important clinical rows record provenance (`source`, verified by).

**Immutability.** Signed notes take addenda; issued prescriptions are cancelled and reissued; issued bills are voided and replaced; observations are corrected by superseding rows. Readable numbers are assigned by the server at issue, never on a device.

**Offline and sensitivity are part of the model.** Every table is classified as read-write, read-only or server-only on devices, and by sensitivity (public, internal, personal, financial, health). Logging, export, analytics, support access and AI processing follow the classification.

**Identity.** A phone number is contact information, never identity. Cross-clinic linking needs verification (OTP, ABHA or clinic confirmation). Merges never move records and can be undone. The clinic owns its clinical record; the patient controls cross-clinic sharing.

**Access ledger and consent.** `access_log` records purpose and device as well as who, what and when. `consents` records purpose, data categories and source.

**Test results live outside the healthcare database.** CI, end-to-end and canary results go to a separate operations store (a BigQuery dataset, free tier); the super admin Quality page reads from there.

**Prescriptions.** Doctors and staff see every prescription in the patient's history and can print or reprint it on the clinic letterhead or plain paper (A4, A5 or thermal), with a small "Prescribed with Aarogyam" footer and a QR code that opens the verified copy. Higher plans may remove the footer later. Before the patient app, patients receive an expiring WhatsApp or SMS link that opens after a one-time code, backed by `share_links` and logged in the access ledger.

**Letterhead.** Every clinic document (prescription print, patient shared page, bill, receipt) renders under one clinic letterhead: either an image the clinic uploads (PNG or JPG, up to 2 MB, checked by content, kept in file storage under the clinic's folder and shown through signed one-hour links that need no sign-in) or one of six generated designs filled from clinic details, doctors (qualifications and registration numbers live on the practitioner, migration 0100), an accent colour, which details to show and a footer line. It is stored under `branding.letterhead` in `org_settings`, edited through `PATCH /settings/clinic`, read for printing at `GET /letterhead` (`patients.read`) and for a share link's page at `GET /shared/{token}/letterhead`. It holds no patient data. Settings, "Letterhead & theme", also switches the portal palette (shared presets in light or dark, or any brand colour) through the existing branding keys. The sheet, picker, preview and theme picker are product-neutral components marked `moves to sakalya-web`.

**Website.** Phase 1 links a clinic's existing website and adds booking. Phase 2 offers about five excellent templates (with the automated repository per clinic). AI-written copy comes later. Whether the website is a paid feature or a free acquisition hook is tested with pilots.

## 2026-10-03: Platform repositories are named by stack

**Decision.** `sakalya-platform` is renamed `sakalya-backend`, alongside the planned `sakalya-web`, `sakalya-android` and `sakalya-ios`. Crate names keep the `sakalya-` prefix.

## 2026-10-03: Clinics own their patient rows

**Decision.** Replace the shared `persons` table with clinic-owned `patients` rows. Cross-clinic views use `patient_links` (a patient's own account verified against each clinic's record) plus `consents`.

**Why.** With a shared person row, one clinic's edits to a name or phone number would show up at another clinic, and matching people automatically across clinics risks merging strangers. Under the DPDP Act each clinic is the data fiduciary for its own records, so each keeps its own copy, and the patient decides what is joined.

## 2026-10-02: Repositories

**Decision.** Three kinds of repository:

1. `sakalya-backend`: shared, product-agnostic Rust crates, depended on by git tag.
2. `aarogyam`: one monorepo for the whole product (API, worker, migrations, specialties, phone apps, web, infra).
3. One repository per clinic website, created automatically when a clinic publishes a site.

**Why.** MyDwarpal's four repositories drift apart: the mobile app hand-copies about 3,680 lines of backend types, and a review found 19 client calls with no matching route. In a monorepo an API change and its client updates land in one pull request, and agents see the whole contract. The platform repo stays separate because it must never learn product concepts, and a repository boundary enforces that. Clinic sites get their own repositories so each has a history and can be handed to the clinic.

| | Monorepo (chosen) | One repo per component (MyDwarpal today) |
|---|---|---|
| API and client changes | One pull request | Coordinated releases across repos |
| Shared types | Generated in place | Copied by hand or published as packages |
| Agents | See everything | See one side of each contract |
| CI | Path filters run only what changed | Simple per repo |
| Access control | Same for all code | Per repo |

## 2026-10-02: Stack

Rust backend (Axum, sqlx, Tokio), Kotlin Multiplatform for shared app logic, Jetpack Compose on Android, SwiftUI on iOS, TypeScript and React on the web. The founder knows Rust and will build mostly with agents; the compiler catches more of an agent's mistakes than any other mainstream language. Desk-heavy work goes on the web so fewer screens are built twice.

## 2026-10-02: Data and tenancy

PostgreSQL on Supabase (Mumbai). Shared schema with `org_id` and row-level security, enforced through `sakalya-db` scoped transactions. The clinic is resolved from the host name only.

## 2026-10-02: Spend nothing until real patients

Local Postgres for development, Supabase free for staging, Cloud Run's free tier, Cloudflare free, GitHub free, Sentry free. The first paid items are Supabase Pro ($25 a month) before real patient data, and domains when needed.

## 2026-10-02: Notifications as a service

One notification module owns every outbound message. Rules (birthdays, appointment reminders, recalls, health tips, promotions) create scheduled messages; a worker sends them through channels (WhatsApp, SMS, email, push, in-app) with consent checks, quiet hours, deduplication, retries and per-clinic cost metering.

## 2026-10-02: Automated clinic websites

Onboarding answers become a site configuration. A GitHub App creates the clinic's repository from a template, commits the configuration, and a shared workflow builds it with Astro and deploys to Cloudflare. Website repositories hold only public content, so they can be public and get free CI minutes.

## 2026-10-04: Front desk scheduling rules (M3)

- A chair is the hard limit: an exclusion constraint refuses two active (not cancelled, not no-show, not deleted) appointments overlapping in one room, answered as `409`. A doctor booked in two chairs at once, on leave or outside weekly hours is allowed with `warnings` (R3-11).
- Statuses are `booked`, `confirmed`, `arrived`, `in_chair`, `completed`, `cancelled`, `no_show`, moving only forward (`aarogyam_domain::schedule`); cancelling needs a reason. Kinds are `new`, `follow_up`, `procedure`, `emergency`. These replace the web draft's `scheduled`/`in_progress`/`teleconsult`.
- Arrival issues a queue token numbered per branch per clinic day from `number_sequences` (kind `queue_token`, series = branch, period = local date). Tokens are `waiting`, `in_chair`, `done` or `left`; moving a token moves its appointment.
- Chairs, doctors and weekly hours change with `settings.manage`; leave with `appointments.write`, because the front desk records it.
- Patient imports take CSV text (≤ 5,000 rows, ≤ 2 MB) with a column mapping; a preview saves nothing, a commit saves the valid rows in one transaction and records every row's result.

## Next milestone: foundation (golden clinic journey)

1. Cargo workspace with the six product crates, depending on `sakalya-backend`.
2. Migrations for the ★ tables in `data-model.md`, with RLS and policy tests.
3. Host-based tenancy, session check, typed permission extractors, route-permission audit test.
4. Patients module end to end as the reference for all other modules.
5. Deploy to staging on Cloud Run with Supabase free.

## 2026-10-05: Mobile architecture

**Decision.** Product-agnostic Kotlin Multiplatform libraries live in a new `sakalya-mobile` repository (core, http, auth, secure storage, outbox, design tokens and components for Compose and SwiftUI), replacing the planned `sakalya-android` and `sakalya-ios`. The Aarogyam apps live in `aarogyam/mobile` (shared KMP module with the generated API client and screen state holders, a Compose app, a SwiftUI app generated by XcodeGen). Tenancy stays host-based: the app calls each clinic's host. Online-first with a read cache and an outbox. Details: `docs/mobile-architecture.md`.

**Why.** Kotlin Multiplatform puts the logic in one tested place, so one repository serves both platforms; the API client is generated so it can't drift (MyDwarpal hand-copied types and enums). MyDwarpal's lessons are applied: secure token storage from day one, only a rejected refresh signs out, idempotency keys per submission, request IDs, small screens with logic in testable state holders.

## 2026-10-05: Optional password sign-in

**Decision.** The clinic portal and console keep the email code as the default and add an optional password (Supabase `signInWithPassword`, `updateUser({ password })`). A wrong password and an unknown email give one message. "Forgot password?" sends the email code, then offers a new password after sign-in. Passwords are at least 12 characters, never logged or stored by us. The API is unchanged: it only verifies Supabase JWTs (issuer, audience, signing keys), which look the same whichever way the person signed in. Sign-in attempts are throttled by Supabase Auth itself (per-IP and per-email limits on the token endpoint, plus the email-send limits that already cover codes); the screen shows the same "too many attempts" message for both.

**Founder must enable in Supabase (not done in code).** Authentication, Providers, Email: keep "Enable email provider" and password sign-in on; set minimum password length to 12 and require letters and digits; keep "Confirm email" on; consider "Leaked password protection" (Pro plan only). Review the Auth rate-limit page ("Rate limit for sign-ups and sign-ins" defaults to 30 per 5 minutes per IP).

**Second step for super admins (built 2026-10-07).** Sakalya staff need an authenticator-app code (Supabase Auth TOTP MFA, free) before the console. The console, after sign-in by either method or the central handoff, checks `auth.mfa` and shows an enrolment screen (QR code and key) or a code prompt until the session is `aal2`. The API's `PlatformRequest` refuses every console route with `403 mfa_required` unless the token's `aal` claim (parsed by `sakalya-auth`) is `aal2`; non-staff still get the plain staff-only `403`, so the check reveals nothing. Clinic users are unaffected (optional MFA for them is in the backlog). Development sign-in tokens carry `aal2` (there is no second step locally). **Setup:** TOTP must be enabled in the Supabase project (Authentication, Multi-Factor; on by default). **Recovery:** a staff member who loses their authenticator is reset by deleting their factor in the Supabase dashboard (Authentication, Users); they then enrol again at next sign-in. Enrolling is open to a signed-in staff session, so the first sign-in of a new super admin should be done promptly after the grant.

## 2026-10-05: Supabase Storage for files, streamed through the API

**Decision.** `ARO_FILES__BACKEND=supabase` keeps file bytes in a private bucket (`ARO_FILES__BUCKET`, default `aarogyam-files`) through Supabase's Storage REST API and the server key; `local` stays the default for development and tests. Downloads still go through our permission-checked route, which fetches the object and streams it. We do not redirect to a Supabase signed URL.

**Why.** The route already checks the permission, writes the access record and enforces the five-minute link. A redirect would hand the browser a second bearer URL that outlives our check and sits in browser history and proxy logs, and would need an extra Storage call to mint it. Streaming adds no database trip and one hop inside Supabase's network; files are capped at `MAX_BYTES`, so memory is bounded. Objects are named `<clinic id>/<attachment id>`, so no patient data is in a key, URL or log. Revisit with redirects if files grow large.

## 2026-10-06: Clinics edit their roles

**Decision.** A new `roles.manage` permission (owner only by default) lets a clinic change what each role may do (`PUT /api/v1/roles/{key}/permissions`), create custom roles from a standard role and remove unused ones. The owner role is never edited or removed, nobody edits their own role, and nobody grants a permission or a wider scope they don't hold (keeping what a role already has is not granting). Every change is one statement that also writes `role_changes` (who, before, after); the API forgets the cached permissions of everyone with the role, so it applies on their next request. Removed roles are soft-deleted so history and old invitations still point at them. Standard role defaults are unchanged: `finance.view` stays with owner and finance.

**Known gap (closed 2026-10-06, see "Permission scopes are enforced").** `own` and `assigned` scopes were stored and offered, but routes checked only whether a permission was held.

## 2026-10-06: Permission scopes are enforced

**Decision.** A permission held at `own` reaches only the member's own records; anything else is `404`, exactly like another clinic's record, in lists, search, counts, single reads and writes. The route's permission decides the scope (`ClinicActor::reach`), and each query takes the member as one nullable parameter (null at `all`) checked by SQL functions in its own `WHERE` (`app.patient_in_reach`, `app.clinical_in_reach`, `app.practitioner_in_reach`, migration 0171), inside the request's one scoped transaction, so scoping adds no round trip.

What `own` means, per record:

- **Patients** (`patients.read`, with their identifiers, recalls and clinical flags; and patient-level records under `clinical.read`/`clinical.write`: allergies, conditions, dental chart, files, treatment plans): patients the member has seen in a visit (`encounters.clinician_id`), who are booked with the member's practitioner record (any appointment not deleted), or whom the member registered (`patients.created_by`).
- **Appointments, queue tokens and leave** (`appointments.read`/`write`): those with the member's own practitioner record. Booking, walk-ins and leave with another doctor are refused; a walk-in must name the member as the doctor.
- **Visits, notes, prescriptions, procedures, vitals** (`clinical.*`, `prescriptions.issue`): the member is responsible (the visit's clinician, the note's author, who issued it), created it, or treats the visit it belongs to.
- **Invoices and payments**: billing permissions only come at `all` (the catalogue), so they are not narrowed. If that changes, `own` would mean bills for the member's visits.

**`assigned` behaves like `own`.** The schema has no care-team or patient assignment, so `assigned` narrows to the member's own records too. When care teams exist, `assigned` adds their patients.

**Consequences.** Starting a visit or prescribing needs the patient in reach first, so a narrowed doctor can't make any patient their own; booking a patient with themselves (at `appointments.write` `own`) does, and that is how a patient becomes theirs. Clinic set-up stays visible to anyone who can see the calendar (rooms, doctors, hours, leave, letterhead, the drug list). A patient's header still shows their next appointment even if it is with a colleague. Editing a patient (`patients.write`, which is `all` only) still needs the patient within `patients.read` reach, because the answer shows the record. The consultant template, which was `assigned` from the start, is now narrowed as intended.


## 2026-10-07: Notice and consent records (DPDP)

**Decision.** `aarogyam.patient_consents` (migration 0280) records, per patient and purpose (`care`, `reminders`, `promotional`, `sharing`, `research`): the clinic's notice the patient was shown (since migration 0332 a published version in `consent_notices` as `notice_id`, with its label in `notice_version`; earlier rows carry only the label, such as `v1 2026-10`), when they agreed, how (`paper`, `verbal`, `app`) and which staff member recorded it. A withdrawal fills `withdrawn_*` once and the row is then final (`freeze_when_final`); consenting again adds a new row. At most one active consent per patient and purpose. The routes are `GET`/`POST /patients/{id}/consents` and `POST /consents/{id}/withdraw`, under `patients.read` and `patients.write` (so reception can record them, and scopes apply). Every change is in the change history. Patient 360 shows them in a Consent tab, and the header and quick look say whether consent to care is recorded; this replaces the earlier "consent form on file" label, which only looked at a Files item.

**Why.** The clinic is the data fiduciary and must be able to show a notice was given and consent taken, and when it was withdrawn (DPDP sections 5 to 6). The notice text is the clinic's document. Since 8 Oct 2026 clinics author it in the product: `POST /consent-notices` (`settings.manage`) publishes a new numbered version that is never edited, `GET /consent-notices` (`patients.read`) lists them, and the newest is the current notice. A consent records the notice named (`notice_id`), else a label the caller gives (the earlier way, still accepted), else the current notice, else the template's label `v1 2026-10` (`web/apps/website` legal pages). Expand, then contract: `notice_version` stays required and filled for now; a later release may drop the label once every reader uses `notice_id`.

**Consent drives messaging (8 Oct 2026).** There never was a `consent_channels` table, and nothing gated messages by consent: the outbox only carries care messages (booking answers, prescription links, app invitations). `app.may_contact(org_id, patient_id, purpose)` (migration 0333, security definer, stable signature) answers from `patient_consents` whether a clinic may message a patient now; the Rust wrappers are `aarogyam_dal::contact::may_contact` (any connection, such as the worker's) and `aarogyam_app::contact::may_send` (in a clinic transaction). The matrix lives in code (`aarogyam_domain::contact::PatientMessage`): booking confirmations, prescription links and app invitations need `care`; appointment reminders and recalls need `reminders`; campaigns and birthdays need `promotional`. With no consent row, `care` messages are allowed and `reminders` and `promotional` ones are not; a withdrawn `care` consent stops care messages until it is given again. Senders call it at send time, so a withdrawal stops messages already queued and consenting again restores them. The `messages` table does not exist yet, so the withdrawal hook (`contact::cancel_queued`) cancels nothing for now; the messaging work fills it in.

**Not done.** Patient self-service consent (app) comes with the patient app.

## 2026-10-07: Retention schedule and anonymisation design (DPDP)

**Decision.** Each class of record has a default retention period, kept in code (`aarogyam-domain/src/retention.rs`) and here, and an operator job lists what is past it: `aarogyam retention` (needs `ARO_DB__OWNER_URL`; add `--sample N` for identifiers). It is a dry run and has no other mode; erasing is `aarogyam erase` (see "Erasure job"). Counts, the oldest date and a few IDs are logged per clinic and class (`retention.past` events), never names. A test checks the code table against this one.

| Class | What | Kept | Counted from | Basis (a lawyer must confirm) |
|---|---|---|---|---|
| `patient_record` | Patient and everything under them: visits, notes, prescriptions, files, charts | 7 years; children until 21 | Last visit, appointment or bill | Medical councils require records for at least 3 years; the Limitation Act (3 years from majority) and disputes argue for longer; 7 is the cautious default; DPDP section 8(7) says erase when the purpose ends |
| `invoices` | Bills and payments | 8 years | Date issued | GST law (72 months) and company law (8 years) |
| `outbox` | Sent or abandoned messages | 90 days | When sent or abandoned | Not needed once delivered; names recipients |
| `messages` | Messages to patients (queued, sent, skipped) and their provider events | 365 days | Queued | Proof a reminder or notice went out; names the patient and holds free text |
| `share_links` | Patient links, after expiry | 30 days | Expiry | Not needed once expired |
| `import_sessions` | Uploaded spreadsheets of patients | 30 days | Upload | Working copy only; the patients are in the clinic's records |
| `access_log` | Who viewed a record | 3 years | Entry | Lets a clinic answer "who saw my record"; the DPDP Rules ask for logs to be kept at least 1 year |
| `audit_events` | Who changed a record | 7 years | Entry | As the patient record it describes |
| `clinic_applications` | Requests for access that were never approved | 365 days | Decision | Not needed after the decision |
| `chat_messages` | Staff chat messages, which may name a patient | 365 days | When posted | Working messages, not the record; the record is the chart |
| `lab_work` | Lab orders with their items, history and payments | 8 years | Order recorded | The payments are clinic accounts (as bills); the orders describe work on a patient |
| `lab_contacts` | People at labs, after the clinic removes them | 365 days | Removal | Business contacts, named with phone and email; not needed once removed |
| `message_templates` | Message templates Meta rejected or paused | 365 days | Last change | No patient data; a dead template is clutter once nobody revisits it |
| `campaigns` | Campaigns sent or cancelled | 365 days | Last change | No patient data (a name, a filter, an offer); the messages it made are the `messages` class |

A clinic may keep records longer where its profession or a dispute requires; per-clinic overrides, and a legal hold that stops erasure of a patient, come before erasure is built (backlog). Consent records stay with the patient record and for 3 years after it.

**Anonymisation and erasure design (built 8 Oct in part, see "Erasure job").**

1. **Erase is the default end of a patient record; anonymise only what the clinic still needs for statistics.** A patient row stays as a tombstone (`id`, `org_id`, `number`, `status = 'erased'`, `erased_at`) because other tables point at it; identity columns (name, search name, phones, email, address, birth date) are cleared. Bills inside their 8 years keep their lines and totals, with the recipient snapshot cleared, until they too pass retention.
2. **One transaction per patient, in dependency order:** files (the rows, then the Storage objects, with an outbox row to retry a failed delete), voice notes, notes and addenda, observations, conditions, allergies, specialty records, procedures, treatment plans, prescriptions and their items, share links, recalls, queued messages, then the identity columns. Consent rows stay and point at the tombstone.
3. **The change history holds old values.** `audit_events.changes` for the erased rows is scrubbed by an owner-run function (the table is append-only to the app role); access-log entries hold only IDs and stay.
4. **Backups.** Erased data remains in backups until they expire (14 daily and 8 weekly dumps, `docs/ops.md`: about 8 weeks). The notice says so. An `erasure_log` of erased patient IDs is replayed after any restore so erased people don't return.
5. **Who decides.** The dry-run report goes to the clinic owner, who confirms by clinic and class; the job then runs with `--apply --clinic <slug>`, and the run records `retention.applied` with counts in the change history. A patient's own erasure request (DPDP section 12) uses the same procedure, but refuses records still inside their legal minimum and says why.
6. **Needs first:** the legal-hold flag, the per-clinic override, an `erased` patient status the UI understands, and a restore-drill step for the erasure log.

## 2026-10-08: Online sign-ups: duplicates by phone and completion at arrival

**Decision.** Online booking still matches a clinic's patient only by verified email (a merged record counts as the patient it was merged into). When no email matches but a patient has the same phone, the booking goes to a new self-registered record and `patient_duplicates` (migration 0331) flags the pair; nothing is merged automatically, because a shared family phone is common. The front desk sees `GET /patient-duplicates` (`patients.read`) and either dismisses a flag or merges with `POST /patients/{id}/merge` (`patients.write`). A merge moves the self-registered record's appointments, queue tokens, patient-app links, identifiers and active consents (for purposes the existing patient has none for), fills the existing patient's email if it has none, and marks the record `merged`; every change is in the change history. It is **refused whenever the self-registered record has any clinical or billing data** (a visit, allergy or "No known allergies", note, file, prescription, plan, recall, bill or payment), not only when both do: moving finalized clinical rows between records is out of scope, so resolve duplicates before checking the patient in. Appointment and queue patient briefs carry `registration_incomplete` (self-registered and missing sex or a date of birth). `POST /appointments/{id}/check-in` (`intake.write`, `patients.write`, `appointments.write`) completes sex and age or date of birth, records reported allergies or "No known allergies" and desk consents with the walk-in's intake code, and marks the appointment arrived (issuing the token) in one transaction; repeating it records details without a second token, and an unconfirmed online request must be confirmed first.

## 2026-10-08: Walk-in fast path

**Decision.** `POST /walk-ins` registers a walk-in (new, or picked from `POST /patients/lookup` by phone), records what they say about allergies or "No known allergies", records the consents they give at the desk, and issues a queue token, in one transaction. It needs `intake.write` (migration 0310: owner, doctor, front desk, assistant), `patients.write` and `appointments.write`. `intake.write` grants no clinical reading. Allergies recorded this way are patient-reported: `source = 'patient'` with no verifier, until a clinician confirms them (`POST /patients/{id}/allergies/{aid}/confirm`); no new allergy columns were needed. `patients.allergies_reviewed` (`unknown`, `none_known`, `has_allergies`) makes "No known allergies" explicit; it doesn't bump `row_version`. Desk consents use the clinic's current published notice (`consent_notices`), or `v1 2026-10` (`consent::DEFAULT_NOTICE_VERSION`) before the clinic publishes one, unless the request names one. `POST /queue/{id}/start-visit` (`clinical.write`) seats the token and starts a visit linked to it (`encounters.queue_token_id`) or returns the visit it already has; closing that visit marks the token done.

**Why.** Most patients in Indian clinics walk in unregistered; three screens and two searches became one. Front desk staff can't judge clinical facts, so their entries wait for a clinician.

## 2026-10-10: Today for any day, the open lab slice, and the queue's called and ready-to-bill states

**Decision.** All additive; no field is renamed, removed or retyped, because the phone apps call these endpoints.
- `GET /today?date=YYYY-MM-DD` (default: the clinic's today; years 2000 to 2100) returns that day's appointments, queue tokens, counts, hours, chairs and team, plus `completed_visits` (visits closed that day, with patient and clinician, no clinical content) and `money` (that day's collections and bills). Money (`money`, and `billed_paise` and `paid_paise` on a completed visit) is present only with `finance.view`. What is about *now* (the chair in use, late arrivals, long waits) shows for today only; a past day has no next patient. Stock is always what is on the shelf now. Still one statement.
- `GET /appointments/month-summary?month=YYYY-MM` gives every day of the month with `booked` (requested, booked, confirmed, arrived, in the chair), `completed`, `cancelled`, `no_shows` and `total` (all but cancelled), counted in the clinic's time zone, narrowed to the member's reach like the calendar.
- `GET /lab-orders?open=1` lists work that still needs something done (draft, sent, in progress, back from the lab and not yet fitted), soonest due first, undated last. Every lab order now carries `pipeline_stage` (`to_send`, `sent`, `in_progress`, `ready_to_fit`, `fitted`, `rework`, `cancelled`), `late` (still at the lab after its due day, in clinic time) and `days_late`. `stage`, the free-text step between trials, is unchanged.
- `GET /reports/collections?weeks=N` (1 to 52, not with `from` or `to`) covers the current week and the weeks before it, so `by_week` has exactly N entries.
- **Queue states** (migration 0610, expand only): `called` and `ready_to_bill` join `queue_tokens.status`. Order: waiting, called, in_chair, ready_to_bill, done. Allowed moves: waiting to called, in_chair, done or left; called to in_chair, done or left; in_chair to ready_to_bill or done; ready_to_bill to done. Every earlier move stays valid. `POST /queue/{id}/call` (`clinical.write`, the patient in the member's reach or the token naming them as the doctor) sets `called` and stamps `called_at`; repeating it changes nothing; past `called` it is refused with `409` and the token as it is. An appointment stays `arrived` while its token is called, and stays `in_chair` while the token is ready to bill. Start visit seats a called token. Closing the visit still marks the token done. `GET /queue` takes `practitioner_id` (`GET /appointments` already did). Today's `counts` gain `called` and `ready_to_bill`; `waiting` counts waiting tokens only.

**Why.** The Today board shows any day, the calendar shades busy days, and the doctor's phone sends patients in; the desk needs to see who is called and who is ready to pay.

## 2026-10-10: Own profile, notification switches and more staff notification kinds (portal v2 settings)

**Decision.** All additive; no field is renamed, removed or retyped, because the phone apps call these endpoints.
- **Own profile** (migration 0615): `PATCH /me` changes the person's own `display_name` and `phone` (+91 assumed; empty clears; `400` names the field, `409` when another account holds the phone) through `app.update_my_profile`, which only touches the caller's row; `GET /me` also returns `display_name` and `phone`. `POST /me/sessions/revoke-others` signs out every session but the current one. The phone is masked in the change history.
- **Clinic**: `POST /settings/clinic/logo` (multipart `file`, PNG or JPEG up to 2 MB) is the letterhead logo slot returning the clinic's settings; `branding.mode` also accepts `auto` (follow the device); `online_booking.default_visit_minutes` (15, 30, 45 or 60, default 30) is how long a staff booking lasts when `ends_at` is left out (now optional on `POST /appointments`).
- **Notification switches** (migration 0616): `GET` and `PATCH /settings/notifications` (`settings.manage`) keep `reminder_24h` (default on), `reminder_2h` (off), `receipts` (off), `recall` (on), `low_stock` (on), `lab_due` (on) and `quiet_hours` (`enabled`, `start`, `end`) in `org_settings.notifications`, merged so keys other features keep there (campaign caps) stay. Each is a real gate: `receipts` queues a `payment.receipt` email (care purpose, one per payment) when a payment is recorded for a patient with an email; the two reminder switches choose the 24-hour and 2-hour reminders (with `reminder_2h` on, an appointment inside two and a half hours gets only the 2-hour one); `recall` and `lab_due` decide whether those alerts are written; `low_stock` hides low stock on Today; `quiet_hours.enabled` off lets reminders and offers go at any hour.
- **Staff notification kinds** (migration 0617, expand only): `arrival`, `payment_due`, `recall_due`, `patient_waiting`, `send_in` and `collect_payment` join the feed, each with `href` (a path inside the portal, never a name or diagnosis) and a subject (`appointment`, `queue_token`, `invoice` or `recall`). Triggers write arrival, bill issued, visit closed with a draft bill and a token sent in; the reminder job writes `recall_due` and `patient_waiting` (a token waiting 15 minutes). Who sees what is decided when reading: appointments.read for arrival and the queue kinds, billing.read for the bill kinds, patients.read (within reach) for recalls. The feed, count and read routes accept any of the four read permissions.

**Why.** The portal's settings and bell need real switches and links, not mock ones. Receipts are opt-in and the 2-hour reminder is off because both send more mail than clinics asked for.
