# Patient history: full page (release 1)

> **Scope (founder, 21 Nov 2026):** the full page ships first. The pop-up, the patient story, the per-member choice and the switcher are in the backlog (`docs/backlog.md`, "Patient history: the other styles") and in appendix B. Release 1 has no migration.

Approved mock-up: `scratchpad/history-options/option-1.html` (published at https://claude.ai/artifact/AMfYY815wbjbBaqRrwv5nJ).

Goal: the doctor finds anything about the patient's past in one or two taps, and the patient page stays fast.

## 1. Entry and navigation
- **Button.** "History · N visits" in the patient header (`patients/v2/patient-360.tsx`, `HistoryButton`). N comes from the visit list that the header facts already load (`patient-facts.tsx:37`, the same query key), so the button adds no request.
- **Shortcut H.** It opens the history. It is ignored:
  - in inputs, textareas, selects, contenteditable, textbox and combobox roles;
  - with Ctrl, Cmd or Alt;
  - during IME composition;
  - while a dialog is open (WCAG 2.1.4).
- **One canonical link:** `/patients/:id/history?visit=<visitId>`. Ids only, never names. The visit route `/patients/:id/visits/:visitId` stays as it is.
- **Back and Esc.**
  - Back goes to `/patients/:id`, never `navigate(-1)`, so a deep link still has a way back.
  - Esc first closes an open visit, then goes back. It does nothing while a dialog (an image viewer) is open.
  - Focus returns to the History button.
- **Records card.** It loses its History tab and opens on Plans. Plans, Prescriptions, Images and Consent stay.
- **Old look.** The route renders the same history page whether or not "New look" is on.

## 2. Shared pieces (so the backlog styles slot in)
- `VisitDetailBody` (`visit-detail.tsx`) is the body of `VisitDetail`, rendered in place on a card.
  - It takes a `VisitHead`: a listed `Visit` or a history card.
  - The `VisitDetail` drawer still wraps it. It had one caller, the History tab, which is now gone.
  - Payments come from each bill's own `paid_paise` and `methods`, not the clinic-wide page of payments (m15).
- `HistoryFilters` and `history-model.ts` share one filter state for every style:
  - search;
  - the chips Treatments · X-rays · Notes and voice · Medicines · Bills;
  - the doctor.
- `ToothGlyph`: the tooth's own art from `@aarogyam/app-kit/mouth-art` (section view, with a finding overlay), loaded lazily and cached per tooth and finding.
- `countsText` from `visit-timeline.tsx` is reused. `ImageGrid`, `RecordingPlayer`, `VisitNotes`, `Empty`, `Tag` and `SkeletonRows` are reused inside the body.

## 3. Data: `GET /api/v1/patients/{id}/history`
- `Require<ClinicalRead>`, within reach. `Cache-Control: no-store`. A cross-clinic request gets 404.
- Each page writes one access record (`audit.access_log`, resource `chart`, action `view`). The resource check constraint has no `history` value; the timeline uses the same resource.
- **Paging.**
  - Up to 200 visits per page (`limit` 1 to 200, default 200), newest first. One response holds nearly every patient's whole history, so search, chips and the month rail see everything on the client (M6).
  - `next_cursor` is opaque: `<started_at µs>~<visit id>`. The next page is `(started_at, id) < cursor`, so ties are neither skipped nor repeated. A bad cursor or limit gets 400.
  - The page loads older pages for a deep link to a visit beyond page 1, and shows a "Load older visits" button.
- **Response.** `PatientHistory { visits: HistoryVisit[], loose_files: HistoryFile[], next_cursor? }`.
- **`HistoryVisit`** fields:
  - `id`, `number`, `status`, `started_at`, `ended_at?`, `clinician{id,name}`;
  - `chief_complaint?`: the typed reason, as the visit detail shows it;
  - `teeth[{tooth, finding?, procedure_key?, label?, work}]`, with `work` one of `found|planned|in_progress|done|elsewhere`;
  - `images[{id,kind,mime_type,label?,created_at}]` (at most 4) and `image_count`;
  - `note_first_line?`;
  - `medicines[]`;
  - `bills?[{id,number?,status,total_paise,paid_paise}]`;
  - `plans[{id,title,status}]`;
  - `counts{notes,recordings,files,procedures}`.
- **Rules.**
  - Teeth: current chart entries only (a correction replaces the entry it supersedes; a clear is dropped) plus procedures. A procedure replaces a chart mark of the same finished work on that tooth.
  - Note line: the first signed note that a live correction did not replace, not entered in error, within reach. It takes the first non-empty line, strips the `[HH:MM]` stamps and list markers, and is cut to 120 characters. Staff can already read the whole note, and the line never reaches a shared page.
  - Medicines: from prescription lines, not cancelled. A prescription belongs to the visit it names, or, naming none, to the visit running when it was written (the visit detail's rule).
  - Bills: issued bills only (a draft has no total yet), several per visit. Absent without `billing.read`, and always absent for Sakalya support.
  - Loose files: files with no visit, first page only, at most 50, excluding audio, consent and payment proofs. They show as "Outside visits".
- **No N+1.**
  - One DAL function per section, each `= any($1)` over the page's visit ids (`aarogyam-dal/src/history.rs`, `chart::of_encounters`).
  - Every section repeats `app.clinical_in_reach` on the visit, note, procedure, file or plan.
  - The statements per page are fixed (about a dozen) whatever the visit count. A test asserts one visit and a hundred visits cost the same.
- **Wire types.** Status fields are strings with documented values, parsed by zod as `z.string()`, so a new value never breaks an old client. The server uses the domain enums (`EncounterStatus`, `Finding`, `Tooth`, `InvoiceStatus`, `PlanStatus`, `Paise`) inside.

## 4. The full page
- Header: Back, "History", the patient's initials, name, age and allergy tag, and an Esc hint.
- A sticky tool bar: search, the chips with counts, and a doctor choice when there are two or more doctors.
- A side column:
  - the jump-to-month rail (months of the filtered visits);
  - Money: billed, paid and due, with `billing.read` only;
  - Plans: not declined, with items done.
- A vertical timeline of cards. Each card shows:
  - the date, a title (the first treatment, else "Check-up", else the complaint), the doctor, the number and the time;
  - plan tags and a bill tag ("₹X due" or "Paid ₹X");
  - "Came in for";
  - tooth chips with glyphs and the work;
  - up to 4 image thumbnails, loaded when near the screen;
  - the note line;
  - medicines and counts.
- "Open visit" expands `VisitDetailBody` in place (`aria-expanded`), and the URL gets `?visit=`.
- Empty states: "No visits yet", and "No visit has that" with "Clear the filters".
- Layout: at 1100 px and below, the side column goes above the timeline as a row. At 700 px and below, the timeline goes single-column, the rail is hidden and the chips wrap.
- Light and dark follow the portal's tokens.

## 5. Quality
- **Performance.** One request for the history. Thumbnails ask for a signed link only when near the screen. Tooth art loads per tooth type.
- **Accessibility.**
  - Cards are articles inside a labelled list.
  - Toggles have `aria-expanded` and `aria-controls`.
  - "Load older visits" is a button.
  - Every action works from the keyboard, and axe is clean in the tests.
- **Privacy.** Ids only in URLs. The document title carries the patient number. No patient data in logs or toasts.

## 6. Tests
- **Rust** (`crates/aarogyam-api/tests/history.rs`, plus unit tests):
  - shape, the access record and no-store;
  - an assistant without `billing.read` gets no bills;
  - draft notes excluded;
  - the visit-link rule for medicines;
  - 403 for the front desk, cross-clinic 404 and unknown-patient 404;
  - bad cursor or limit gets 400;
  - 100 visits paged by 7 with ties, every visit once, newest first;
  - an equal statement count for 1 and 100 visits;
  - Own reach (rows and loose files);
  - the first-line rules and the cursor round trip.
- **Web** (`history-page.test.tsx` and the updated `records-header`, `patient-360-v2`, `visit-flow-v2`, `visit-notes` and `vitals-v2` tests):
  - the page renders from the fake (axe clean);
  - chips and search, with the empty state and clear;
  - expand and close;
  - Esc closes, then goes back with focus restored;
  - Back;
  - the old look;
  - no money without `billing.read`;
  - the History button count;
  - H opens it, but not in a textarea or with Ctrl;
  - the Records card has no History tab;
  - the `?visit=` deep link;
  - the filter model.

## Review round 1 → changes

| Finding | Change |
|---|---|
| B1 bill without billing permission | `bills` only with `billing.read` and never for support. Tested with the assistant role. The support branch is the same one-line gate (`actor.support_grant.is_none()`) and has no separate integration test. |
| B2 no access record | One record per page, resource `chart` (the `access_log` constraint has no `history`; the timeline uses `chart`). Tested. |
| B3 items outside visits | `loose_files` on the first page, shown as "Outside visits". Notes and procedures always have a visit (`encounter_id` not null), so files are the only orphans. |
| M4 cursor | Opaque `(started_at, id)` cursor, `next_cursor`, 400 for a bad cursor, and a tie test. The limit is 1 to 200, not 1 to 50, because of M6. |
| M5 N+1 and reach | One `= any($1)` function per section with `clinical_in_reach` in each. A test shows the statement count is equal for 1 and 100 visits. Disagree on "at most 8": a page costs about 12 fixed statements (patient, access record, visits, loose files, 7 sections, clinic terms). Merging sections into one SQL statement would undo "one function per section". The bound is constant, which is what matters. |
| M6 search over the whole history | Chosen: up to 200 visits in one response, filtered on the client. Older pages load on demand and for deep links. |
| M7 count without eager `useVisits` | Disagree, with evidence: `PatientFacts` already loads `useVisits` on the patient page (`patient-facts.tsx:37`). The button reads the same query, so there is no extra request and no new endpoint. |
| M8 thumbnails | `images[{id,kind,mime_type,label,created_at}]`. Links are fetched only when the thumbnail nears the screen (IntersectionObserver). |
| M9 entry points | One canonical link: `/patients/:id/history?visit=`. The visit route is kept. `initial="plans"` in `layouts.tsx` (three places). |
| M10 scope | This document is release 1 only. The other styles are in appendix B and the backlog. |
| m11 telemetry routes | `/patients/:id/history` is in `telemetry-routes.json` and `PORTAL_ROUTES`. |
| m12 keyboard and focus | H rules as in §1. `aria-expanded`. A "Load older" button. Focus restored through router state. Back goes to `/patients/:id`. |
| m13 types and rules | Domain enums inside, documented strings on the wire (lenient zod). `today_state` became `work`, kept because the chip shows it. Current chart entries only. Note rules as in §3. Medicines follow the visit-link rule. `bills` is an array. `plan_item_ids` became `plans[{id,title,status}]`. The complaint is the typed `chief_complaint`, aligned with `VisitDetail`. |
| m14 naming | `GET /patients/{id}/history`, `PatientHistory`, `HistoryVisit` and friends, all added to the mobile `apiModels`. |
| m15 payments bug | `VisitDetailBody` no longer calls `usePayments({})`. It shows what each bill received (`paid_paise`, `methods`). |

## Appendix B: later styles (backlog)
- **Large pop-up** (`Dialog`, about 90% of the viewport, `?history=1&visit=` on the patient route): the visit list on the left in compact form, `VisitDetailBody` on the right, Up and Down plus Older and Newer to move, list then detail on phones.
- **Patient story** (a wide side sheet): a fixed "30-second read" block (allergies, conditions, active plan, last and next visit, money due), then folding Treatments, X-rays, Notes and voice, Medicines and Billing. Each row opens `VisitDetailBody`.
- **Per-member choice:**
  - a `member_ui_prefs` table (`org_id`, `membership_id`, `history_view in ('page','popup','story')`, RLS, a composite foreign key to memberships, a `no_support` select policy, and an erasure step, following 0742);
  - `GET/PUT /me/ui-prefs`, defaulting to the pop-up;
  - a Settings "History opens as" choice (optimistic, with rollback);
  - a session-only switcher in the history header.
