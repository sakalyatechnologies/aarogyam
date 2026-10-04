# Instructions for fallback coding agents

You are a coding agent working on Aarogyam while the main agent (Claude) is offline. Claude reviews every branch you produce and merges what is good. Your job is **one small task from `docs/fallback-tasks.md`, done carefully, on its own branch**. Speed matters less than not breaking anything.

## Read first (in this order, nothing else unless the task says so)

1. This file.
2. Your task's entry in `docs/fallback-tasks.md`.
3. The files your task lists under **Read**.

Don't read the whole repository or `docs/` folder. Don't resume an old chat transcript; this file and the task are your context.

## Start a task

```sh
scripts/fallback-worktree.sh FB-07        # creates ../wt-fb-07 on branch fallback/fb-07 from main
cd ../wt-fb-07
```

Work only inside that folder. One task per folder and branch. Several agents can run at once, each on a different task, as long as their tasks don't list the same files (see **Conflicts** in the task queue).

## Hard rules

1. **Touch only the paths your task allows.** If the task seems to need anything else, stop and write it in your report instead.
2. **Never touch**: `db/migrations/` (append-only, Claude only), row-level security, auth or permission code (`crates/aarogyam-api/src/extract*`, `access`, `sakalya_auth`), `AGENTS.md`, `docs/decisions.md`, `docs/guidelines/`, `.githooks/`, `.claude/`, `Cargo.toml` dependency lists, `deploy/`, `scripts/deploy-*`, `scripts/demo-api.sh`.
3. **Never read, print, copy or edit `.env*` files** or anything containing keys, tokens or passwords.
4. **Never** `git push`, merge into `main`, rebase `main`, `git commit --no-verify`, `git stash`, delete branches, deploy, or run anything against Supabase, Cloudflare or Resend.
5. **No patient-like data** anywhere: no real names, phone numbers or diagnoses in code, tests, logs or URLs. Use the synthetic names already in fixtures.
6. **Don't change behaviour you weren't asked to change**: no drive-by refactors, renames, reformatting of untouched files, or dependency upgrades.
7. **Match the surrounding code**: same naming, comment style, file layout and test style as the nearest similar file. The task names a pattern file; copy its shape.

## Verify before every commit

| You changed | Run (from the worktree root) | Must |
|---|---|---|
| Anything under `web/` | `pnpm check` | pass |
| Rust (`crates/`) | `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace` | pass |
| An API route or its types | also `UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi`, then commit `docs/api/openapi.json` | regenerated |

The pre-commit hook runs these too. If it fails, fix the cause; never bypass it. If you can't make a check pass after two honest attempts, stop and report; don't weaken or delete the test.

Tests: every behaviour change gets a test next to the nearest existing test of the same kind (`*.test.tsx` with Vitest and Testing Library for web; `crates/aarogyam-api/tests/*.rs` for the API).

## Commit

- Small Conventional Commits: `feat(portal): …`, `fix(api): …`, `test(portal): …`. One logical change each.
- End each message with a line naming your model, e.g. `Co-Authored-By: Gemini 2.5 Pro (fallback)`.
- Stage files by path (`git add web/apps/portal/src/pages/patients/allergies.tsx`), never `git add -A`.

## Finish

Append a report to the end of your task entry in `docs/fallback-tasks.md` **on your branch** (not on main):

```
Report (model, date): done | partial | blocked
- Commits: <hashes and subjects>
- Checks: pnpm check ✅ / cargo test ✅ (paste the summary lines)
- Not done / questions for Claude: …
```

Then stop. Claude reviews `fallback/*` branches, merges or redoes them, and updates the queue.

## Running several agents at once

Each agent gets its own terminal, task and worktree. Pick tasks whose **Conflicts** fields don't overlap. Rust tasks are heavy to build; run at most one Rust task at a time on a laptop, and any number of web-only tasks.

## Tooling (for the founder)

- **Claude Code Router (CCR)** is the one to use. Start it once (`ccr start`), then run `ccr code` in a worktree to get Claude Code driven by whichever model the router config maps. Different terminals can pick different models with `/model <provider>,<model>`. Claude Code still applies this repository's `.claude/settings.json`, including the deny rules for `.env*`.
- **CC Switch** switches the provider for every Claude Code session at once. It's handy for flipping your main terminal, but you don't need it alongside CCR. Use plain `claude` when Claude's limits are back.
- Prefer the strongest model you have for Rust tasks, and lighter ones for web, tests and docs.
