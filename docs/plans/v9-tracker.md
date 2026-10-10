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
| 1 | rxdose | Rx dosing model | — | paused 12:50 · see handoff |
| 1 | history | Visit history and detail holders | — | paused 12:50 · see handoff |
| 1 | overview | Patient overview holder and money summary | — | paused 12:50 · see handoff |
| 1 | consent | Consents holder and client | — | paused 12:50 · see handoff |
| 1 | outbox | Offline outbox | — | paused 12:50 · see handoff |
| 1 | desk | PatientState mapper and desk lookup | — | paused 12:50 · see handoff |
| 1 | be-queue | BE2 queue states and call; BE4 staff notifications | 0420, 0421 | paused 12:50 · see handoff |
| 1 | be-close | BE5 close with follow-up and fee; BE6 payment proof | 0422, 0423 | paused 12:50 · see handoff |
| 1 | be-family | BE1 patient relations | 0424 | paused 12:50 · see handoff |
| 1 | be-share | BE8 visit share page and patient visits | 0425 | paused 12:50 · see handoff |
| 2 | be-events | BE3 SSE events | — | waits for be-queue |
| 2 | be-msg | BE7 WhatsApp/SMS adapter and templates | 0426 | waits for be-share |
| 2 | sh-wire | Mobile models and client calls for BE1–BE8; polling | — | waits for wave 1 |
| 3 | ios-patient | Patient page with 3 tabs and visit detail | — | waits for sh-wire |
| 3 | ios-visit | Start treatment with inline Rx; close with follow-up and fee | — | waits for sh-wire |
| 3 | ios-desk | Desk lookup, family, waiting board, collect with proof | — | waits for sh-wire |
| — | coordinator | Merge into feat/v9-backend, then main into feat/v9; end-to-end run | — | — |

## Pause handoff (10 Oct 2026, 12:50)

All work stopped at 12:50, at the founder's request. Each worker was told to commit what compiles (WIP commits are allowed) and to commit its handoff file `docs/plans/v9/<name>.md` in its own worktree.

**To resume, for each worker in the table:**
1. `cd ~/project/wt-v9-<name>`.
2. Read `docs/plans/v9/<name>.md` and `git log -3`. If `git status` still shows uncommitted files, the worker didn't finish committing: review the diff, then commit it as a `wip:` commit.
3. Continue from the handoff's "next step". Each worker's original brief is in plan rev 10, `~/.claude/plans/https-sunrise-aarogyam-spring-snow-130f-snazzy-kitten.md`.
4. When the branch is green, merge it:

| Branch type | Merge into | In worktree |
|---|---|---|
| Shared mobile | `feat/v9` | `~/project/wt-v9` |
| Backend `be-*` | `feat/v9-backend` | `~/project/wt-v9-be` |

   After each backend merge, regenerate `docs/api/openapi.json`, then tick the task here.
5. Then start wave 2 (be-events, be-msg, sh-wire), then wave 3 (iOS).

**Rules still in force:**
- Never touch `web/`; the dashboard agent owns it in the `wt-v2-*` worktrees.
- Migrations use 0420–0429.
- No push, merge to main, or deploy without the founder.

**Still running and safe to leave:** caffeinate, the local API on :8080, the portal on :5173, and two booted simulators.
