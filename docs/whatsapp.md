# WhatsApp

How Aarogyam sends patient messages on WhatsApp through Meta's Cloud API. The decision is in `docs/decisions.md` ("WhatsApp channel"). WhatsApp is **off** until the credentials below exist (`ARO_WHATSAPP__ENABLED=false`): queued WhatsApp messages are then skipped with `channel_disabled`, never failed.

## Account model

- **Pilot: one shared Sakalya number.** Sakalya owns one Meta Business account, one WhatsApp Business Account (WABA) and one phone number. Every clinic sends through it, with **utility templates only** (reminders, care notes, follow-ups). Patients see Sakalya's verified name; the clinic's name is the first variable of every template.
- **Later: a number per clinic**, through Meta's Embedded Signup, so a clinic sends under its own name and its own templates. The tables already hold templates per clinic.

## Meta setup (once, by hand)

1. Create or verify the **Meta Business account** for Sakalya Technologies (business verification needs the company documents).
2. In the Meta developer console, create an app of type **Business** and add the **WhatsApp** product. This creates a WABA and a test number.
3. Add the real number (one not used on the WhatsApp app), verify it by SMS or call, and set the display name (Meta reviews it).
4. Create a **system user** in Business settings with the WhatsApp app assigned, and generate a **permanent access token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
5. Note the **phone number id** (not the number) from WhatsApp, API setup.
6. Add a payment method to the WABA (needed beyond the free service conversations).

## Secrets and settings

Store in Secret Manager and pass to Cloud Run as environment variables (`docs/cicd.md`):

| Variable | What |
|---|---|
| `ARO_WHATSAPP__ENABLED` | `true` to send; default `false` |
| `ARO_WHATSAPP__ACCESS_TOKEN` | The system user's permanent token (secret) |
| `ARO_WHATSAPP__PHONE_NUMBER_ID` | Meta's id of the sending number |
| `ARO_WHATSAPP__APP_SECRET` | The app's secret, which signs webhooks (secret) |
| `ARO_WHATSAPP__VERIFY_TOKEN` | Any long random string; also typed into Meta (secret) |
| `ARO_WHATSAPP__DAILY_BUDGET` | Messages a day across the platform; default 250 (Meta's first tier) |
| `ARO_WHATSAPP__COST_*_PAISE` | Price per category, stored as `messages.cost_paise` |

The API and the outbox job both need them: the API for the webhook, the job for sending.

## Webhook

- URL: `https://<api host>/api/v1/webhooks/whatsapp`. In the app's WhatsApp configuration, set it with the verify token and subscribe to the `messages` and `message_template_status_update` fields.
- `GET` answers Meta's handshake: `hub.mode=subscribe` with the right `hub.verify_token` gets `hub.challenge` back; anything else is 403.
- `POST` is checked with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret, constant-time compare, 1 MB cap; 401 otherwise) and answers 200 straight after recording:
  - **Statuses** (`sent`, `delivered`, `read`, `failed`) by the message's `wamid`: each once, the furthest one kept whatever the order.
  - **Template reviews**: `APPROVED`, `REJECTED` (and `DISABLED`), `PAUSED` (and `FLAGGED`) update every clinic copy with that name and language that was submitted.
  - **Inbound messages** are checked for a STOP keyword and dropped. Their text is never stored, logged or passed on.

## STOP

The keywords are `aarogyam_domain::whatsapp::STOP_KEYWORDS`: English (`stop`, `stop all`, `stop promotions`, `unsubscribe`, `cancel`, `end`, `quit`, `opt out`), Hindi (`रोको`, `रोकें`, `रोका`, `बंद`, `बंद करो`, `बंद करें`, `band`, `band karo`, `roko`) and Marathi (`थांबवा`, `थांबा`, `बंद करा`, `thambva`, `thamba`). A reply is a STOP only when it is one of them as a whole, ignoring case, spaces and punctuation; text, a template button and a list reply are all checked.

On the shared number a reply doesn't say which clinic it is for, so the clinic is resolved in this order (`app.whatsapp_stop`, migration 0377):

1. the clinic whose message the reply quotes (Meta's `context.id`);
2. else the clinic that last sent that phone a WhatsApp message in the past 30 days;
3. else, to be safe, every clinic that ever queued a WhatsApp message to the phone.

Every patient at that clinic with the phone opts out of WhatsApp for all purposes (`contact_preferences`, source `stop_keyword`), and their queued WhatsApp messages are skipped. Opting back in is a staff action on the patient's word (`POST /patients/{id}/contact-preferences`).

## Opt-in and the 24-hour window

- **Opt-in.** Meta requires the patient's opt-in before a business messages them. A WhatsApp message is sent only when the patient has `whatsapp_opt_in_at` on a WhatsApp preference, recorded by staff with `whatsapp_opt_in: true`; otherwise it is skipped with `no_opt_in`. Consent for the purpose (`app.may_contact`) and opt-outs still apply.
- **The 24-hour window.** Free-form text is allowed by Meta only within 24 hours of the patient's last message. Aarogyam never sends free text on WhatsApp: only approved templates, which work at any time. `POST /messages` refuses a `body` on WhatsApp, and the table refuses it too.

## Templates

Every clinic has its own copies (`message_templates`), seeded from the platform defaults when the clinic is created. WhatsApp copies start as `draft`.

- Bodies use `{{variables}}` from the allow-list (`aarogyam_domain::messaging::allowed_variables`): `clinic_name` and `booking_link` everywhere, `subject` for `care.note` and `promo.offer`, `due_on` for `reminder.follow_up`, `appointment_time` and `doctor_name` for `appointment.reminder`. Never the patient's name or anything clinical.
- At Meta the template is written with positional `{{1}}`, `{{2}}`... **in the same order** as the variables appear in our body. The worker sends the values in that order.
- Categories as Meta returns them: `utility` (about something the patient has: an appointment, a follow-up), `marketing` (offers), `authentication` (codes). Meta may re-categorise; keep ours in step.

### Submitting (by hand for the pilot)

1. In WhatsApp Manager, Message templates, create the template with the name in `provider_template_ref` (for example `aro_appointment_reminder_v1`), the category, the language (`en`, `hi` or `mr`) and the body with `{{1}}`... and a sample value for each.
2. In the clinic, `POST /api/v1/templates/{id}/submit` records `submitted`. If Meta already approved the same name, language and text for another clinic, it becomes `approved` at once.
3. Meta's review arrives on the webhook and sets `approved`, `rejected` or `paused`. Only `approved` templates are sent; a paused one skips with `template_paused`.
4. Editing a WhatsApp copy's text, name or category (`PATCH /api/v1/templates/{id}`) puts it back to `draft`: submit again.

## Errors

| Meta error | Outcome |
|---|---|
| 131049 (marketing limit per user) | skipped, `marketing_limit` |
| 132015 (template paused) | skipped, `template_paused` |
| 131026 (undeliverable: not on WhatsApp) | skipped, `undeliverable` |
| HTTP 429, 5xx, 130429, 131056, 80007 (rate limits, outages) | retried with backoff |
| anything else (a bad token, wrong parameters) | failed, to look at |

## Costs

Meta charges per delivered template message by category and the patient's country. India, mid-2025, approximately: marketing about ₹0.88, utility and authentication about ₹0.13; utility templates inside an open 24-hour window are free. The configured price per category is stored on each message as `cost_paise`; check Meta's rate card before relying on totals. The daily budget (`ARO_WHATSAPP__DAILY_BUDGET`) caps spend, and the pilot sends utility templates only.

## Testing

Tests use recorded and fake payloads only: a recorded signature, Meta's documented answers and errors, and a fake Graph API on a local port. Nothing calls Meta.
