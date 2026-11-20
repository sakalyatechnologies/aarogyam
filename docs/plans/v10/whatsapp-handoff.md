# Send on WhatsApp (visit story C1–C3) and eruption chips (B5): mobile plan

The design is `docs/plans/visit-story-design.md` v4. I start building when the backend pings that the route is on main.

## Send on WhatsApp
- **Route:** `POST /api/v1/visits/{id}/patient-message`.
  - Returns `{phone_e164, text, short_text, url, pin, expires_at, auto_sent_at?}`.
  - Hold the response in the state holder's memory only: no outbox, no retry, no disk, never logged. Log only the event name and the visit id.
- **Shown only with both permissions:** `clinical.read` and `patients.contact`.
- **Where:**
  - the doctor's Done screen after End visit;
  - after Collect, when the doctor collects.

  The queue row's "Prepare WhatsApp summary" is web only in v1.
- **Labels:**
  - "Send on WhatsApp";
  - "Send again on WhatsApp" when `auto_sent_at` is set;
  - afterwards "Summary prepared 5:42 pm", never "sent".
  - The button is disabled while the request is in flight.
- **Refusals (409 problem `code`):**
  - `visit_open`
  - `no_phone`
  - `no_consent`
  - `opted_out`

  404 means an erased patient or another clinic's visit. Each one gets plain wording in en/hi/mr. The backend will confirm the exact field when it lands.
- **Android:** `ACTION_VIEW` on `https://wa.me/<digits>?text=<text>` with `setPackage`, preferring `com.whatsapp.w4b`, else `com.whatsapp`. Declare both in `<queries>`. Test with a number that isn't in contacts.
- **iOS:** `whatsapp://send?phone=&text=`, with `whatsapp` in `LSApplicationQueriesSchemes` (`iosApp/project.yml`).
- **No WhatsApp installed:** "WhatsApp isn't installed on this phone". There is no browser fallback on phones, because it would put the text in a URL.
- **`url`:** the clinic portal host plus `/shared/{token}`. Pass it through unchanged.

## Eruption chips (Phase B)
- **Data:** a new optional `eruptions` array on the chart response.
  - `eruption` is `erupted | partial | impacted | unerupted`;
  - `angulation` is `vertical | mesioangular | distoangular | horizontal`.

  Map both as strings with an Unknown fallback, not as strict generated enums.
- **Writes:**
  - `PUT /patients/{id}/teeth/{tooth}/eruption`;
  - `POST …/eruption/entered-in-error {reason}`.
- **UI:** one optional chip row on the tooth panel.
- **Never add a value to `ToothStatus.health`:** the generated enum is strict, so installed apps would fail to decode the chart. The backend pings before any change.
