# Agent workflow

How Claude and cheaper Codex agents share the work. Claude plans, writes the architecture-sensitive code, reviews and merges. Codex workers on OpenRouter models do routine, well-specified tasks.

## Pieces

- **Queue:** Beads (`bd`) in `~/project/agent-queue`, outside every repository. Each task holds its brief, state, dependencies, and the model and tokens of every attempt. `bd list`, `bd show <id>`.
- **Worker:** `scripts/agents/codex-worker.sh <slot> [--once]`, started through `zsh -ic` so `OPENROUTER_API_KEY` from `~/.zshrc` reaches Codex. It claims a ready task labelled `codex`, creates a worktree on `agent/<id>` from the task's base (default `main`), runs `codex exec`, then the task's check and the pre-commit hook.
- **Statuses:** `open` → `in_progress` → `review` (check and hook passed, committed on `agent/<id>`) or `failed` (left for Claude). Claude merges a reviewed task and closes it.

## Writing a task

- Title: a Conventional Commit subject; it becomes the commit message.
- Description: half a page at most. The goal, the exact files to read and change (with line hints), the design decisions already made, and the tests to add. Paste the relevant extract of a mock-up rather than pointing at the whole file.
- Labels: `codex`, a tier, and an area (`web`, `rust`, `mobile`).
- Metadata: `repo` (path), `check` (a scoped command that proves it works), optional `setup` and `base`.

## Tiers

The worker starts at the task's tier and moves up one after two failed attempts.

| Tier | Work | Default model (`AGENT_MODEL_<n>` overrides) |
|---|---|---|
| 1 | Docs, lint, renames, simple tests | `deepseek/deepseek-chat` |
| 2 | Bug fixes, endpoints and screens that follow an existing pattern | `qwen/qwen3-coder-next` |
| 3 | Multi-file features | `deepseek/deepseek-v4-pro` |
| Claude | Architecture, security, scaffolding, review, failed tasks | Claude Code |

## Rules

- Workers never push, merge or touch `main`. The check decides "done", not the model's reply.
- At most two workers at once on Rust tasks (each slot keeps its own `CARGO_TARGET_DIR` under `~/.cache/agent-targets`).
- No real patient data or secrets in a brief: OpenRouter models may log prompts.
- Claude's sessions stay short: one piece of work per session, with `docs/handoff.md` updated at the end.
- After a merge, remove the worktree: `git worktree remove ~/project/agent-<id>`.
