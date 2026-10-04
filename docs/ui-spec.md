# UI spec: clinic dashboard

Source: `~/Downloads/aarogyam-dashboard-full.html` (founder's static mock-up, vanilla HTML/CSS/JS, fake data). This spec turns it into what the web team builds against `@sakalya/ui` and the API in `docs/overnight-plan.md`. Phase 2 = no migration or endpoint planned in M2–M5; the screen stays static (mock data, disabled actions) until a later milestone.

Already built in `web/apps/portal/src`: sign-in, clinic switcher (`ClinicGate`), Today (schedule/KPIs/bar chart, M3 shape), Patients (search/list), Patient 360 (header + Overview tab; Visits/Billing tabs stubbed), New patient. This spec extends those and specs the rest.

## 1. Design language

| Mock-up pattern | Mock CSS | Theme token / `@sakalya/ui` component | Note |
|---|---|---|---|
| Brand green, soft tints | `--brand #136650`, `--brand-soft #e1efe8` | `bg-primary` / `bg-primary-soft` / `text-primary-text` via `createTheme` + clinic `branding` | Never hard-code; brand comes from `org_settings.branding`, already wired in `portal-layout.tsx` via `parseHexColor` + `preset("mint")` fallback |
| Status colours (amber/red/green/indigo) | `.pill.warn/.down/.up`, `.tag.*` | `Pill` / `Badge` `tone="warning"\|"danger"\|"success"\|"info"\|"primary"\|"neutral"` | Matches `Status` type already used in `today-page.tsx` (`statusOf`) |
| Card, 18px radius, soft shadow | `.card`, `--r`, `--sh` | `Card` | Already the shared surface; don't re-derive radius/shadow per screen |
| KPI tile (label, big number, trend pill, sparkline) | `.kpi` | `StatCard` (label/value/tone/footer) | Sparkline (`<svg class="spark">`) has no slot on `StatCard` today — see missing list |
| Gradient hero banner (greeting + stat row) | `.hero` | `PageHeader` + a `StatCard` row below it | Drop the gradient/serif hero treatment — `@sakalya/ui` rule #3 forbids hard-coded hex in components, and a fixed gradient clashes with white-label branding per clinic |
| Serif display face (`Newsreader`) for `h1` | `font-family:"Newsreader"` | — | Drop; use the app's existing sans stack so every white-labelled clinic reads consistently |
| Purple "AI" insight banner | `.ai` | — | No component; also no data source (see §3) — leave out of M2–M5 |
| Priority-sorted attention list (dot + text + mini action) | `.att`, `.pri` | `AttentionList` | Direct match, exists today |
| Timeline with "NOW" line and status dots | `.tl`, `.nowline` | `Timeline` | Already used in `today-page.tsx`; `current` prop marks the active row, no literal "NOW" rule line — acceptable simplification |
| Up-next / roster list | — | `PersonList` | Already used |
| Bar chart (booked vs completed, weekly ₹) | `.bars` | `BarChart` | Already used (`total`/`part` semantics) |
| Donut chart (revenue mix %) | inline `<svg>` circles | **missing** | No categorical donut/pie export in `@sakalya/ui` |
| Table with avatar+name cell, status tag, hover row | `table`, `.pname`, `.pav` | `DataTable` + `Avatar` + `Pill` | Already used in `patients-page.tsx` |
| Filter chip row (All / With balance / Recalls due …) | `.chipf` | **missing** | No segmented/toggle-chip group exported |
| Stock level meter | `.stockbar` | **missing** | No generic bounded-value meter/progress bar |
| On/off toggle switch | `.tgl` | **missing** | Only `Checkbox`/`RadioGroup` exist in `choices.ts`, no boolean `Switch` |
| Week calendar grid (7 days × time slots, coloured chips) | `.cal`, `.evchip` | **missing** | No schedule/week-grid component; generic enough (days × slots × coloured chips) to belong in the shared library, not product-specific |
| Slide-over drawer (Patient 360 in the mock) | `.drawer`, `.scrim` | `Drawer` (exists) | Portal already chose a full page instead (`/patients/:id`) — keep that; `Drawer` stays available for lighter previews (e.g. a quick-peek from search) |
| Command-style search (`⌘K`) | `.cmdk` | Compose `Dialog` + `SearchInput` + `Menu` | Not a blocking gap; no dedicated "command palette" molecule needed yet |
| Toast confirmations | `.toast` | `ToastProvider` / `useToast` | Already used in `new-patient-page.tsx` |

**Propose adding to `@sakalya/ui`** (generic, no product concept, reusable beyond Aarogyam):
1. `DonutChart` — categorical share-of-total, same data shape discipline as `BarChart`/`cleanBarData`.
2. `Meter` — bounded value bar with a "low" threshold tone (stock level, utilisation, quota).
3. `Switch` — boolean on/off control, sibling to `Checkbox`.
4. `ChipFilterGroup` (or `SegmentedFilter`) — single/multi-select quick-filter chips for list screens.
5. `WeekGrid` / `ScheduleBoard` — days × time-slots grid rendering coloured, clickable chips per cell.
6. Sparkline — either a new micro-chart export, or a `trend` prop added to `StatCard` (smaller lift).

## 2. Screens

Each row: purpose → layout order → key widgets → actions → empty/loading → milestone → who sees it.

### Role visibility at a glance

Default role bundles per `docs/product.md`'s "Who it is for" table and `docs/schema/model.py`'s `role_templates` (owner, doctor, front desk, assistant, finance). The owner can flip individual permissions per clinic; this is the starting point to build against.

| Permission | Owner | Doctor | Front desk | Assistant | Finance | Gates |
|---|---|---|---|---|---|---|
| `patients.read` / `.write` | yes | yes | yes | yes | — | Patients list, New patient |
| `patients.contact` | yes | — | yes | — | — | Reveal phone/email on Patient 360 |
| `appointments.read` / `.write` | yes | yes | yes | — | — | Today, Calendar |
| `clinical.read` / `.write` (planned, M4) | yes | yes | — | yes | — | Clinical flags detail, Visits tab |
| `billing.read` / `.write` (planned, M5) | yes | — | partial (write only, to take payment) | — | yes | Billing screen, Patient 360 Billing tab |
| `finance.view` (fake-only today, real in M5) | yes | — | — | — | yes | Money `StatCard`s on Today, Consulting payout tile |
| `settings.manage` | yes | — | — | — | — | Settings |

A doctor or assistant without `billing.read` still sees a patient's clinical record in full; a front desk member with `billing.write` but not `billing.read` can record a payment at the counter but can't open the Billing screen's reports — this is the concrete shape of "owner sees money; front desk doesn't."

### 2.1 Today (`/today`) — M3 base, M4/M5 enrich

- **Purpose:** what's happening right now; doctors act, owners glance at money underneath (per `docs/product.md`: "today's work beats dashboards").
- **Layout:** greeting header → KPI row (appointments, waiting, revenue, pending dues) → two-column (schedule timeline | attention list + chair status) → two-column (appointments-by-hour chart | recent patients table) → three-column (revenue mix donut | pending payments | team today).
- **Widgets:** `PageHeader`, 4× `StatCard`, `Timeline` (schedule), `AttentionList`, 3× chair-status tile (compose `Card`+`Pill`, not a new component), `BarChart` (by hour), `DataTable` (recent patients), `DonutChart` (revenue mix — missing component), `DataTable` (pending payments), `DataTable` (team today).
- **Actions:** start next visit (deep-links into the M4 visit screen, not built yet — disable until then), export day plan (no endpoint — drop or defer), remind-all-on-WhatsApp (needs messaging, Phase 2 — disable).
- **Empty/loading:** already patterned in `today-page.tsx` — `Skeleton` grid while pending, `EmptyState` ("Appointments aren't connected yet") on 404, `ApiErrorNotice` otherwise. Reuse the same pattern for the new widgets (e.g. empty attention list = "Nothing needs attention").
- **Milestone:** schedule/KPIs/by-hour chart = M3 (built). Attention list's allergy and recall items = M4/M5. Revenue mix, pending payments = M5. AI brief banner, "avg rating", lab-delay and low-stock attention items, team roster = no milestone — see gaps in §3.
- **Role visibility:** revenue/pending-dues `StatCard`s and the pending-payments table require `finance.view` (owner/finance only, per `permissions.ts` comment "Fake only, for Today's money tiles, until the API has a finance permission"); front desk and assistant see the rest of the page without them. Clinical detail inside the allergy attention item (substance, reaction) needs `clinical.read`; everyone sees that a flag exists.

### 2.2 Patients (`/patients`) — M2/M3, built

- **Purpose:** find a patient fast.
- **Layout:** search + filter chips row → patients table.
- **Widgets:** `SearchInput` (built), `ChipFilterGroup` (missing — "All / With balance / Recalls due / New this month"), `DataTable` (built, columns: name, number, age+sex, masked phone, last visit; mock adds file no. — same as `number` — next appointment and balance).
- **Actions:** new patient (built), row click → Patient 360 (built, via `id` not name), Excel export (no endpoint — drop/defer).
- **Empty/loading:** built (`DataTable` `loading`/`empty` props).
- **Milestone:** base table = M2/M3 (built). "With balance" filter = M5. "Recalls due" filter = M5 (`recalls`). "New this month" = trivial, M2 (date filter on existing search).
- **Role visibility:** balance column/filter needs `billing.read`; hide the column (not just blank it) for roles without it, matching how contact is already masked instead of hidden in `patient-page.tsx`.

### 2.3 New patient (`/patients/new`) — M2, built

No change from current implementation (`NewPatientPage`). Matches `NewPatient` schema exactly (`full_name`, `sex`, `date_of_birth` or `age_years`, `phone`, `email`, `preferred_language`). Gated on `patients.write`.

### 2.4 Patient 360 (`/patients/:id`) — M2 shell built, M4/M5 extend

- **Purpose:** everything about one patient, read before touching them.
- **Layout (page, not the mock's drawer):** header (name, number pill, status pill, masked contact with reveal) → tabs: **Overview** (built) / **Clinical flags** (new) / **Visits** (stub → M4) / **Billing** (stub → M5).
- **Widgets:**
  - Clinical flags: a banner-style `Card` (red/amber accent) listing active allergies (substance, reaction, severity) and active conditions — always visible, not buried, matching the mock's prominent "⚠ Clinical flags" placement and the product rule that allergy flags are safety-critical.
  - Visits: `Timeline` of `encounters` (date, chief complaint, practitioner) with linked `procedures` (label, amount).
  - Billing: `DataTable` of `invoices` (number, date, total, status) + outstanding balance `StatCard`.
  - Overview additions: lifetime value, outstanding balance `kv` rows (mock's drawer shows both).
- **Actions:** reveal/hide phone and email (built), `+ Follow-up` → `POST /appointments` prefilled with `patient_id` (M3), `Message` button → no messaging/thread feature is planned anywhere in M2–M5 or in the full schema's notify tables being migrated — **drop or disable with "coming soon"**, don't wire to a toast that implies it works.
- **Empty/loading:** built pattern (`Skeleton`, `ApiErrorNotice`); Visits/Billing tabs already show `EmptyState` stubs — replace with real empty states once M4/M5 land ("No visits yet", "No bills yet").
- **Milestone:** header/Overview = M2 (built). Clinical flags, Visits = M4. Billing, LTV = M5.
- **Role visibility:** Billing tab and LTV need `billing.read`; Clinical flags tab needs `clinical.read` for detail (substance/reaction) but the existence of a flag should still surface to front desk for safety, same rule as §2.1.

### 2.5 Calendar (`/calendar`) — M3

- **Purpose:** book and see the week at a glance.
- **Layout:** week nav (‹ date range ›) + Day/Week/Month toggle + new-appointment button → 7-day × time-slot grid.
- **Widgets:** `WeekGrid`/`ScheduleBoard` (missing component) rendering appointment chips coloured by `status`.
- **Actions:** new appointment (`POST /appointments`), click a chip → small detail popover with reschedule (`PATCH /appointments/{id}`) and status change (`POST /appointments/{id}/status`), including arrive (issues a queue token) and cancel (requires a reason).
- **Empty/loading:** empty day/week = "No appointments" per cell range, not a full-page empty state (a mostly-empty grid is normal).
- **Milestone:** M3, fully.
- **Role visibility:** `appointments.read` to view, `appointments.write` to create/reschedule/cancel. Front desk and doctors both need this; it is not finance-gated.

### 2.6 Billing (`/billing`) — M5

- **Purpose:** the clinic's money, this week and this month.
- **Layout:** KPI row (collected this month, outstanding, consulting payout, UPI share) → two-column (weekly collections bar chart | invoices table).
- **Widgets:** 4× `StatCard`, `BarChart` (weekly collections), `DataTable` (invoices: number, patient, amount, mode, status).
- **Actions:** Excel export (no endpoint — drop/defer), row click → invoice detail (not in mock, but needed to void/reissue per M5 rules — add a small detail panel reusing `Drawer`).
- **Empty/loading:** `EmptyState` "No invoices yet" before any bill is issued.
- **Milestone:** M5, fully, **except**: "Consulting payout" needs `consultant_payouts`/`consultant_fee_rules` — tables exist in the full schema (`docs/schema/model.py`, `ops` domain) but are **not** in the M2–M5 migration list — flag as a gap (§3). "UPI share %" needs a payment-method breakdown that `GET /reports/collections` isn't explicitly specified to return — confirm with backend before building.
- **Role visibility:** whole screen behind `billing.read`; the "Consulting payout" tile specifically behind `finance.view` even if `billing.read` is broader, per "owner sees money; front desk doesn't." Front desk can still take a payment against an invoice (needs a write permission not yet named in `permissions.ts` — flag) without seeing this screen's reports.

### 2.7 Stock / Inventory (`/stock`) — Phase 2, static

- **Purpose:** material and medicine stock levels.
- **Layout:** 3 summary cards (critical items) → inventory table (item, category, in-stock/reorder, level meter, status) → purchase-order button.
- **Widgets:** 3× `Card`, `DataTable`, `Meter` (missing component).
- **Milestone:** Phase 2 — `inventory_items`, `stock_batches`, `stock_movements`, `suppliers` exist in the full schema (`ops` domain) but have **zero** migrations or endpoints in M2–M5. Build with the mock's static data; no backend work this cycle.
- **Role visibility:** owner/front-desk read; ordering write is owner-only eventually — moot until an endpoint exists.

### 2.8 Messages (`/messages`) — Phase 2, static, with one real sliver

- **Purpose:** reminders, recalls, campaigns.
- **Layout:** KPI row (sent, WhatsApp share, cost, opt-outs) → two-column (templates list | recall campaign builder).
- **Widgets:** 4× `StatCard`, `AttentionList`-style template list, recall campaign `Card` (audience text, message preview, channel `ChipFilterGroup`, send button).
- **Milestone:** Phase 2 for everything — the KPI tiles need `messages`/`message_events`, the template list needs `message_templates`, and the send action needs `campaigns` plus WhatsApp/SMS integration; none of those tables are in the M2–M5 migration list (and WhatsApp/SMS are explicitly "not tonight" in `overnight-plan.md`).
  - **Exception:** `recalls` *is* in the M5 migration list with a planned follow-ups API. Once M5 ships, the campaign's "48 patients due" count can be wired to a real `GET /recalls?status=due` query even though the send button stays disabled. Worth building that one number live; keep the rest static.
- **Role visibility:** Phase 2, deferred.

### 2.9 Settings (`/settings`) — split by panel

- **Purpose:** clinic profile, notification preferences, website.
- **Layout:** two-column — Clinic profile card | (Notifications card, Website card).
- **Clinic profile** (name, address, phone, UPI ID, save): `GET`/`PATCH /settings/clinic` (M2). **Gap:** `organizations` has no `address`/`phone`/`upi_id` columns and `org_settings` has no obvious slot for them either (`branding`, `billing`, `prescription`, `notifications` jsonb only) — confirm with backend whether these ride in `org_settings.branding` or need a new column/jsonb key before building the form.
- **Notifications** (reminder/receipt/recall/low-stock toggles, quiet hours): Phase 2, static — `overnight-plan.md` names this explicitly as staying static tonight; don't partially wire it even though `org_settings.notifications` jsonb exists, since the recall and low-stock toggles depend on modules (`notify`, `ops`) that aren't migrated.
- **Website** (online booking toggle, preview link): Phase 2, static — clinic websites are Phase 2 in `docs/product.md` itself (Phase 1 only links an existing site).
- **Milestone:** Clinic profile = M2. Notifications, Website = Phase 2.
- **Role visibility:** Clinic profile and both Phase 2 panels behind `settings.manage` (owner only).

**Out of scope here** (not in the mock-up, so not specced, but needed per `overnight-plan.md`'s UI-1/UI-2 packages and will need their own short spec before being built): Staff & roles, Sessions, and the Visit screen (notes/vitals/dental-chart odontogram/procedures/treatment plans/prescriptions). The "Team today" widget on Today (§2.1) is the only staff-facing surface the mock-up actually shows. "Avg. rating this week" on Today's hero has no ratings/reviews table anywhere in `docs/schema/model.py` — there is no review feature in the product at all; drop that stat rather than deferring it.

## 3. Data contract per widget

Endpoints marked **existing** are in `docs/api/openapi.json` today; **planned** are named in `docs/overnight-plan.md`'s per-milestone API column; **gap** means no endpoint is planned anywhere in M2–M5 (the table may still exist in the full long-term schema).

### Today

| Widget | Endpoint | Fields | Milestone |
|---|---|---|---|
| Schedule timeline, by-hour chart, waiting/up-next | `GET /api/v1/today` (planned) | `date`, `as_of`, `appointments[].{id,starts_at,ends_at,status,kind,reason,room,arrived_at,patient.{id,number,full_name,sex,age_years},practitioner.{id,display_name}}` | M3 |
| Revenue/pending-dues `StatCard`s | `GET /api/v1/today` `money` field | `money.{collected_paise,pending_dues_paise,pending_dues_patients}` (present only with `finance.view`) | M5 (field already drafted in `contract.ts` `TodayMoney`, needs the real M5 billing data behind it) |
| Trend pills on KPI cards (+12%, +8%) | **gap** | day-over-day deltas aren't in `TodayResponse` | flag for backend: add a `previous` comparison or drop the trend pills |
| Attention: allergy flag | `GET /api/v1/patients/{id}` conditions/allergies, or a new flags read | allergy `substance`, `reaction`, `severity` (table `allergies`) | M4 — **no combined "attention" endpoint is planned**; propose `GET /patients/{id}/flags` or embedding a `flags_summary` on `Patient` |
| Attention: recall due | planned follow-ups API | `recalls.{patient_id,kind,due_on}` | M5 |
| Attention: lab work delayed | **gap** | `lab_orders` (ops domain) — not in M2–M5 | Phase 2+ |
| Attention: low stock | **gap** | `inventory_items`/`stock_batches` — not in M2–M5 | Phase 2+ |
| Chair status | `GET /api/v1/today` + rooms | needs per-room current occupant; `TodayAppointment.room` is currently a free-text string, not a room id/status | M3, needs a small shape addition — confirm with backend |
| Recent patients (treatment + bill) | composite of `GET /patients/{id}/timeline` (M4) + invoice status (M5) | encounter/procedure label, `invoices.status` | M4+M5, no single planned endpoint — propose folding into `GET /today` or a dedicated summary read |
| Revenue mix donut, pending payments table | `GET /api/v1/reports/collections` (planned) | category/module breakdown, `invoices` pending list (`patient`, `total_paise`, `paid_paise`, `status`) | M5 |
| Team today roster | **gap** | no shift/attendance/on-duty table anywhere in the schema | out of scope until a staffing module exists |
| AI morning brief | **gap** | no analytics/LLM service planned | drop for M2–M5 |

### Patients

| Widget | Endpoint | Fields | Milestone |
|---|---|---|---|
| List / search | `POST /api/v1/patients/search` (existing), `GET /api/v1/patients` (existing) | `Patient.{id,number,full_name,age_years,sex,phone(masked),last_visit_at,status}` | M2/M3 (built) |
| "With balance" filter | **gap in `SearchRequest`** | needs a `has_balance` param backed by M5 invoices | M5, extend `SearchRequest` |
| "Recalls due" filter | **gap in `SearchRequest`** | needs a `recall_due` param backed by `recalls` | M5, extend `SearchRequest` |
| "New this month" filter | trivial extension of existing search | `created_at` range | M2 |
| Next appointment column | `GET /appointments?patient_id=...` or embed on patient | not currently on `Patient` schema | M3, propose adding `next_appointment_at` to `Patient` for the list view |
| Balance column | invoices aggregate | `invoices` balance sum per patient | M5, propose `balance_paise` on `Patient` or a batch endpoint |

### Patient 360

| Widget | Endpoint | Fields | Milestone |
|---|---|---|---|
| Header | `GET /api/v1/patients/{id}` (existing) | full `Patient` schema | M2 (built) |
| Clinical flags | planned M4 conditions/allergies endpoints | `allergies.{substance,reaction,severity,status}`, `conditions.{display_text,status}` | M4, needs a combined read (see Today gap above) |
| Visits tab | `GET /patients/{id}/timeline` (planned) | `encounters.{started_at,chief_complaint,practitioner}` + linked `procedures.{label,amount_paise,performed_at}` | M4 |
| Billing tab | invoices list for patient (planned, not explicitly named) | `invoices.{number,issued_at,total_paise,paid_paise,status}` | M5, confirm a `GET /patients/{id}/invoices` or filterable `GET /invoices?patient_id=` exists |
| Lifetime value | **gap** | no aggregate field planned | M5, propose a billing-summary field/endpoint |
| Consent row | **gap** | `contact_preferences` table not in M2–M5 | Phase 2+, hide the row rather than fake "✓" |

### Calendar

| Widget | Endpoint | Fields | Milestone |
|---|---|---|---|
| Week grid | `GET /appointments?from&to&room_id&practitioner_id` (planned) | `appointments.{id,starts_at,ends_at,status,kind,room_id,practitioner_id,patient_id}` | M3 |
| New appointment | `POST /appointments` (planned) | `patient_id,practitioner_id,room_id,starts_at,ends_at,kind,reason` | M3 |
| Reschedule / status change | `PATCH /appointments/{id}`, `POST /appointments/{id}/status` (planned) | arrive issues a `queue_tokens` row; cancel requires `cancel_reason` | M3 |

### Billing

| Widget | Endpoint | Fields | Milestone |
|---|---|---|---|
| Collected / outstanding KPIs, weekly collections bars | `GET /reports/collections` (planned) | weekly `{week_start, collected_paise}`, `outstanding_paise`, bill count | M5 |
| Invoices table | invoices list (planned, not explicitly named as `GET /invoices` — confirm) | `invoices.{number,patient_id,total_paise,status}`, `payments.method` for "mode" | M5 |
| Consulting payout | **gap** | `consultant_payouts`/`consultant_fee_rules` (ops domain) — not in M2–M5 | Phase 2+ |
| UPI share % | likely `GET /reports/collections`, unconfirmed | `payments.method` breakdown | M5, confirm shape with backend |

### Stock, Messages, Settings (Notifications, Website)

All **gap/Phase 2** per §2.7–2.9 — no endpoints planned in M2–M5. Exception: Settings → Clinic profile uses `GET`/`PATCH /settings/clinic` (M2, planned), and Messages → recall count can use the planned M5 `recalls` follow-ups read.

## 4. Navigation

### Sidebar (gated by permission; current `PortalShell` nav only has Today/Patients — extend it)

| Item | Route | Permission | Milestone |
|---|---|---|---|
| Today | `/today` | `appointments.read` | M3 (built) |
| Patients | `/patients` | `patients.read` | M2/M3 (built) |
| Calendar | `/calendar` | `appointments.read` | M3 |
| Billing | `/billing` | `billing.read` | M5 |
| Stock | `/stock` | — | Phase 2, hide from nav until it has data, or show with a "coming soon" state |
| Messages | `/messages` | — | Phase 2, same |
| Settings | `/settings` | `settings.manage` | M2 (profile only; Notifications/Website panels static) |

### Routes — IDs and dates only, never names or phones (per `routes.tsx`'s existing rule and `AGENTS.md` rule 6)

```
/today
/patients
/patients/new
/patients/:id                 (patient id, already enforced by patientId.safeParse)
/calendar?from=...&to=...     (ISO dates, not patient data)
/billing
/billing/invoices/:id         (invoice id)
/stock                        (Phase 2)
/messages                     (Phase 2)
/settings
```

The clinic itself never appears in the path — it comes from the host (`sunrise.aarogyam.example`), per `AGENTS.md` rule 1 and the existing `clinic.tsx`/`useClinicChoice` pattern. Don't add an `org_id` or clinic slug segment to any of the above.

### Build order

1. Calendar + booking (M3) — the biggest gap versus the mock; Today and Patients are already built.
2. Patient 360: Clinical flags, Visits tab (M4).
3. Patient 360: Billing tab; Billing screen (M5).
4. Today enrichment: attention list's recall/clinical items, revenue mix, pending payments, chair status shape fix (M4/M5, incremental on the built page).
5. Settings → Clinic profile (M2, can happen any time in parallel — smallest, self-contained).
6. Stock, Messages, Settings → Notifications/Website: static only, lowest priority, no backend dependency.

## 5. Privacy in this spec

- **URLs:** every route above carries an ID or an ISO date, never a patient name or phone — matches `patientPath()` and the comment in `routes.tsx`. The mock-up's `openP("${p.n}")` keys a lookup by patient **name**; when built for real, key by `id` the same way `patient-page.tsx` already does.
- **Toasts:** keep them generic, as the mock mostly already does ("Allergy record opened", not "Meera Shah's allergy record opened"). Audit any new toast text before shipping — none should interpolate a patient's name, phone, or diagnosis.
- **Contacts:** phone/email stay masked (`Patient.phone`/`email` arrive pre-masked from the API without `patients.contact`) and reveal only on an explicit, per-field click, exactly as `patient-page.tsx`'s `Contact` component already does. Apply the same control anywhere else a phone number could appear (e.g. a future invoice or appointment detail panel) — never default to shown.
- **Tables showing names:** patient names in on-screen tables (recent patients, invoices, pending payments) are fine — the rule is about URLs, logs, and toasts, not the rendered page.

## Decisions on the data gaps (lead, 3 Oct night)

- Today's hero drops "average rating" (no reviews in the product). "Team today" comes from working hours (M3). Lab-delay and low-stock attention items wait for Phase 2 (ops tables); the attention list shows what M3–M5 provide (late arrivals, unsigned notes, unpaid issued invoices, follow-ups due).
- Consultant payouts, stock and the message/recall campaign screens are Phase 2: static, clearly marked.
- Clinic profile: address and phone are the default branch's; the UPI ID lives in `org_settings.billing`. Built in M2's `/settings/clinic`.
- Patient search filters "has balance" and "follow-up due" arrive with M5.
- Patient 360's "Message" button is dropped until WhatsApp exists.
- Staff, sessions, the visit screen and the odontogram follow the same design language; UI agents spec them as they build.
