# Backlog

Requests from the founder and clinics that are not built yet. Read this before designing a change: a decision made now should not block an item here. Move an item to `delivery-plan.md` when it is scheduled, and delete it here when it ships.

## Dental chart

### Treatment details per tooth (6 Oct 2026)
- Selecting a tooth (or several) offers what was done or found per **surface** (mesial, distal, occlusal/incisal, buccal/labial, lingual/palatal) with the **material**: zirconia, PFM (porcelain fused to metal), metal (cast), composite, amalgam, glass ionomer, e.max (lithium disilicate), gold, ceramic, temporary.
- Lists are **dropdowns with type-ahead** (typing "Z" offers Zirconia) and **"add new"**; additions are saved for the clinic and offered next time.
- Lookups and matching happen **in the app**, not per keystroke on the API: the clinic's lists load once with the chart (or as reference data cached like the price list) and changes save with the finding.
- Patient 360 shows the details tooth by tooth (history per tooth, surface and material).
- **Design notes:** materials and procedures are specialty data (AGENTS.md rule 11): a seeded vocabulary in `specialties/dental`, plus clinic-defined additions in a clinic table with `org_id` and RLS. Findings reference vocabulary ids, not free text, so reports and future exports stay consistent.
- **Today:** the chart records conditions per surface (`/api/v1/patients/{id}/dental-chart`); there is no material field and no clinic-editable list.

### Realistic tooth shapes everywhere (6 Oct 2026)
- Wherever a compact chart shows two straight rows of boxes (Patient 360 summaries on web and mobile), use the same oval, tooth-shaped drawing as the full chart.

## Today dashboard visuals (6 Oct 2026)
- Chair utilisation over time (per chair, per day and week).
- Patient mix: by age band, new vs returning, and by doctor.
- **Design note:** computed by one report query per tile in the existing round-trip budget (see `crates/aarogyam-api/tests/round_trips.rs`); no per-chart request fan-out.

## Photos and files from the phone and laptop (6 Oct 2026)
- **Exists:** patient attachments (`/api/v1/patients/{id}/attachments`, stored in the private Supabase bucket, permission-checked downloads) and the web upload.
- **To build:** take a photo in the mobile apps (camera) and upload from the gallery; X-rays and other files from a laptop; name or label each file (e.g. "OPG", "Intraoral – upper"); show them on Patient 360 and per tooth.
- **Design notes:** uploads go through the API (never a public bucket URL); images are resized on the device before upload; no patient names in file keys (ids only, as today).

## Patient notes on Patient 360 (6 Oct 2026)
- Show the patient's notes on Patient 360 (web and mobile), and let the doctor edit them during an ongoing visit or at any time they're allowed to.
- **Formatted** text: headings, bullet lists, bold; stored as a safe, structured format (e.g. Markdown with a strict renderer, or a small JSON document model), never raw HTML.
- **Design notes:** signed notes are immutable and change through addenda (already the rule: `/notes/{id}/addenda`); "edit" applies to drafts and to a patient-level summary note that is versioned (row_version / If-Match).

## Bringing in a clinic's existing records (6 Oct 2026)
Very important for onboarding: many clinics keep **paper case sheets**; others have spreadsheets or another system's export.
- **Paper:** photograph or scan case sheets (phone or scanner), then extract the fields automatically (OCR plus a model that maps any template to our fields), whatever the clinic's layout.
- **Files:** CSV, Excel and other exports, with columns mapped automatically from their names and contents (a suggested mapping the clinic confirms), not a fixed template.
- **Missing required data:** import what is present; mark records "incomplete" with exactly what's missing; let the clinic finish them later (front desk sees a to-do list). Never invent values.
- **Review before it counts:** every automatic extraction is shown for confirmation (side by side with the scan) before it becomes a clinical record; the original scan is kept as an attachment.
- **Exists:** CSV/pasted patient import with per-row errors (`/api/v1/imports/patients`, web Patients → Import).
- **Design notes:** extraction runs as a background job (outbox-style), never in the request path; the AI provider must meet the health-data rules (no training on our data, India data residency where required; see `docs/guidelines/`); imported records keep their source (scan id, file and row) for traceability.

## Moving between clinics and sign-in polish (6 Oct 2026)
- **Clinic switcher in the portal (built, feat/central-signin):** people who belong to several clinics switch from the top bar or account menu, without going back to the website (lists `/me` clinics; switching uses the same one-time handoff to the other clinic's host).
- **Console shows address progress live:** "Address pending" updates to "ready" without a manual refresh (the outbox job provisions it within ~2 minutes, before the invitation email goes out).
- **Handoff lands on Today directly (built):** instead of passing through the clinic's `/sign-in` route.
- **Clinic addresses are an implementation detail:** people sign in on the website and never need to type a clinic's address; keep it out of emails and screens except where a clinic shares a booking link.

## Support access for Sakalya staff (6 Oct 2026)
- `support_grants` exists only in the docs model, not as a migration. Build it: a clinic owner (or an approved request) grants a named staff member time-limited access to their clinic, visible to the clinic, audited, and ending automatically. Platform staff can't hold clinic memberships (migration 0172), so this is the only way for staff to help inside a clinic.
