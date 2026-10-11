# BE7 automatic patient messages (be-msg)

Branch `v9-be-msg` (from 249e642). Migration 0427 only. Not pushed.

## What it does
- `welcome` (key `patient.welcome`): queued when a walk-in registers a NEW patient. Clinic name, thanks, app link
  (portal home), website link (verified custom domain, else portal home). No wait estimate: no average visit
  length exists in `/queue` or today's data, so the line is omitted.
- `visit_summary` (`visit.summary`) and its PIN (`visit.summary_pin`): queued by the first close of a visit. A visit
  link is made in the same transaction, unless the visit already has a live one (its token cannot be recovered,
  so nothing is sent). The PIN goes in a SECOND message 30 s later (be-share: "PIN sent separately"; the
  prescription flow never mails its PIN, a doctor tells it). Caveat: same channel as the link.
- `follow_up_booking` (`visit.follow_up_booking`): close with `follow_up_on` queues one message scheduled for 09:00
  clinic time, 2 days before the date (now if closer). Chosen over "right away" because the booking link is
  useful near the date. No existing recall sender existed to reuse. It needs `reminders` consent.
- Templates: en/hi/mr, email (approved, text rendered from the row) and WhatsApp (drafts, refs `aro_welcome_v1`,
  `aro_visit_summary_v1`, `aro_visit_pin_v1`, `aro_follow_up_booking_v1`). Variables are links, the PIN and a date
  only; no patient name, no clinical words.
- Channel: WhatsApp only if opted in, not opted out, with an approved template; else email. Consent, opt-out and
  missing address are recorded at queue time as a `skipped` message with `skip_reason` (no link made); the
  worker checks again at send time. `message_events` holds provider events only, so skips live on `messages`.
- Idempotency: dedupe keys `auto:*` plus a repeat close returns before any of this.

## Settings
`GET/PATCH /settings/clinic` gains `auto_messages {welcome, visit_summary, follow_up_booking}` (defaults
true, true, false). Column `org_settings.auto_messages`. No web UI: the dashboard agent can add toggles.

## Going live (founder)
1. In WhatsApp Manager create the 4 names above in en, hi, mr with the bodies in `message_templates`
   (`{{1}}` positional, same order); category utility. Risk: Meta may re-categorise the PIN one as authentication.
2. `POST /templates/{id}/submit` per clinic row; set approved on the webhook.
3. Set `ARO_WHATSAPP__ENABLED=true`, `ACCESS_TOKEN`, `PHONE_NUMBER_ID`, `APP_SECRET`, `VERIFY_TOKEN`,
   `DAILY_BUDGET`, `COST_*_PAISE` (docs/whatsapp.md). Until then everything goes by email.
4. Patients need `whatsapp_opt_in` recorded by staff for WhatsApp.

## Gaps
- A follow-up message still goes if the patient books or the recall is dismissed meanwhile.
- The "app link" is the portal home; no store link is configured.
- Welcome needs a verified portal host; without one nothing is queued.
