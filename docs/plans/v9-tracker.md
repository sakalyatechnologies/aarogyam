# v9 tracker: the clinic visit flow, end to end

Plan: rev 10 of the mobile v7 plan. Flow: `docs/flows/clinic-visit-flow.md`. Only the coordinating session edits this file. Each worker writes its own handoff file, `docs/plans/v9/<name>.md`.

## Branches

| Branch | Base | Use |
|---|---|---|
| `feat/v9` | 0769804 | Mobile integration; the shared and iOS branches merge here |
| `feat/v9-backend` | main 60047b9 | Backend integration; the be-* branches merge here |

## Ownership notes

- **Web (`web/`)** belongs to the dashboard agent's `feat/v2-*` branches. v9 workers never touch it.
- **Migrations:** main stops at 0397. v9 workers use 0420 to 0429.

## Tasks

| Wave | Worker | Task | Migration | Status |
|---|---|---|---|---|
| 1 | rxdose | Rx dosing model | — | running |
| 1 | history | Visit history and detail holders | — | running |
| 1 | overview | Patient overview holder and money summary | — | running |
| 1 | consent | Consents holder and client | — | running |
| 1 | outbox | Offline outbox | — | running |
| 1 | desk | PatientState mapper and desk lookup | — | running |
| 1 | be-queue | BE2 queue states and call; BE4 staff notifications | 0420, 0421 | running |
| 1 | be-close | BE5 close with follow-up and fee; BE6 payment proof | 0422, 0423 | running |
| 1 | be-family | BE1 patient relations | 0424 | running |
| 1 | be-share | BE8 visit share page and patient visits | 0425 | running |
| 2 | be-events | BE3 SSE events | — | waits for be-queue |
| 2 | be-msg | BE7 WhatsApp/SMS adapter and templates | 0426 | waits for be-share |
| 2 | sh-wire | Mobile models and client calls for BE1–BE8; polling | — | waits for wave 1 |
| 3 | ios-patient | Patient page with 3 tabs and visit detail | — | waits for sh-wire |
| 3 | ios-visit | Start treatment with inline Rx; close with follow-up and fee | — | waits for sh-wire |
| 3 | ios-desk | Desk lookup, family, waiting board, collect with proof | — | waits for sh-wire |
| — | coordinator | Merge into feat/v9-backend, then main into feat/v9; end-to-end run | — | — |
