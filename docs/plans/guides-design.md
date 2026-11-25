# Guides: narrated how-to videos inside the app

Status: v1 design (24 Nov 2026). Owner: backend/web session.

## 1. Goal
Doctors, assistants and front-desk staff learn each flow in the app itself, from short narrated guides
(1–3 minutes), without a trainer. Guides cover every main flow, not only Show patient.

## 2. What it looks like
- **Left panel: "Guides"** (a book icon, last item above Settings), visible to every role. The same page is also
  under **Settings → Guides & videos**.
- **Guides page**: cards grouped by role (Getting started · Front desk · Doctor · Billing · Clinic owner). Each card
  shows the title, length, a still, and "Watched" once played to the end (a per-user tick in browser storage).
  A "Start here" card leads.
- **Player**: plays like a video, with narration in a calm Indian-English voice, the real app screens, a highlight
  ring and cursor moving to each tap, and captions. Controls: play/pause, previous/next step, a chapter list, speed
  (1×, 1.25×, 1.5×), and captions on/off. "Slides" mode lets the viewer step through at their own pace, with the
  text, no audio.
- **Help where you are**: a small "?" in the page header of the main screens (Today, Queue, Patient, Show patient,
  Billing, Settings) opens the matching guide in a side sheet.

## 3. How guides are made (and kept up to date)
Hand-made screen recordings go stale with every UI change. Guides are **generated from scripts** instead:
- `web/apps/portal/guides/<id>.guide.ts`: title, role, and steps. Each step = route, Playwright actions (click,
  type), the element to highlight, a caption, and the narration text.
- `pnpm guides:render` runs the portal on the **fake API** (synthetic data only). Playwright plays each step at
  1366×768 and saves a WebP screenshot of each state plus the highlight box. Narration is synthesised **locally**
  (Kokoro, an open-weight Apache-2.0 TTS model; fallback macOS `say -v Aman`) into Opus/MP3 per step, with captions
  (WebVTT) from the narration text.
- Output per guide: `guide.json` (steps, timings, boxes) + stills + audio, about 1–2 MB for a 2-minute guide. The
  player animates the cursor and ring between steps with CSS, so it reads as a video at a fraction of the size, stays
  sharp on any screen, and keeps the text searchable.
- When a flow changes, re-run `guides:render` for that guide. A test fails if a guide's selectors no longer
  match the app (run in the render script), so stale guides are caught.
- Optional `--mp4` export (Playwright video + ffmpeg mux) for sharing a guide on WhatsApp or YouTube. Not needed
  in the app.

## 4. Why not brag
brag (latent-spaces/brag, MIT) makes a ~20-second launch video by reading a codebase, with music and motion. It's
good for a **marketing teaser** on the public website, which we can do later. But it does not follow a real flow
step by step on real screens, so it can't make tutorials. We borrow its idea of local rendering with an open TTS
voice (it also uses Kokoro).

## 5. Hosting
- The assets live in `web/apps/portal/public/guides/<id>/` and are served by the portal Worker as static assets
  (cached, no API, no cost). Budget: ≤ 2 MB per guide and ≤ 25 MB in total. Past that, they move to an R2 bucket
  (free tier); guides hold no patient data, so region doesn't matter.
- The guide list is a static `index.json`. The player is its own lazy route chunk, so it doesn't add to the main bundle.
- The phones can open the same guide URL in a web view (mobile session decides).

## 6. v1 guide list (stable flows first)
1. Start here: a tour of the app (left panel, Today, search, Settings).
2. Front desk: book an appointment.
3. Front desk: walk-in, the queue and calling the patient in.
4. Doctor: open a visit, chart a tooth and record what you found.
5. Doctor: Show patient (explaining treatment).
6. Doctor: prescriptions and finishing the visit.
7. Billing: make a bill and collect a payment.
8. Clinic owner: prices, staff and roles.

Guides 4–5 are rendered after the "treatment chips" and in-place Edit work lands (the flow is changing now). The QR
check-in guide comes when that ships.

## 7. Rules
- Synthetic data only (fake API). No real patient, phone or name appears in any frame or narration.
- English only (UI is English-only); narration text is plain, short sentences.
- Accessible: captions always available; keyboard controls; no autoplay with sound until the user presses play.
