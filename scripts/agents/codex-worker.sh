#!/usr/bin/env bash
# Codex worker for the agent queue (docs/agent-workflow.md). Claims ready tasks labelled `codex`,
# runs Codex in a worktree per task, then runs the task's check and the pre-commit hook. A task
# that passes is committed on agent/<id> and set to `review`; one that fails twice on its tier
# moves up a tier, and after the top tier it is set to `failed` for Claude. Never pushes or merges.
#   zsh -ic 'scripts/agents/codex-worker.sh 1'          # slot 1, loops until stopped
#   zsh -ic 'scripts/agents/codex-worker.sh 2 --once'   # slot 2, one task then exit
# Task fields: description = the brief; metadata {"repo": path, "check": command, "setup": command,
# "base": branch to start from (default main)}.
set -uo pipefail

SLOT=${1:-1}
ONCE=${2:-}
Q=${AGENT_QUEUE:-$HOME/project/agent-queue}
WT_ROOT=${AGENT_WORKTREES:-$HOME/project}  # siblings of the repos: web links to ../sakalya-web
LOGS=${AGENT_LOGS:-$Q/logs}
ACTOR=codex-$SLOT
TIMEOUT=${AGENT_TIMEOUT:-1500}
POLL=${AGENT_POLL:-60}
MODEL_1=${AGENT_MODEL_1:-deepseek/deepseek-chat}
MODEL_2=${AGENT_MODEL_2:-google/gemini-3.8-flash}
MODEL_3=${AGENT_MODEL_3:-google/gemini-3.8-flash}
export CARGO_TARGET_DIR=${AGENT_TARGETS:-$HOME/.cache/agent-targets}/slot-$SLOT
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"
# Web tests time out under load when several workers and gates run at once.
export VITEST_MAX_WORKERS=${VITEST_MAX_WORKERS:-2}
mkdir -p "$WT_ROOT" "$LOGS" "$CARGO_TARGET_DIR"

bdq() { bd -C "$Q" --actor "$ACTOR" "$@"; }
log() { printf '%s [%s] %s\n' "$(date +%H:%M:%S)" "$ACTOR" "$*"; }
# macOS has no `timeout`; perl's alarm kills the command after $1 seconds.
with_timeout() { perl -e 'alarm shift; exec @ARGV' "$@"; }
model_for() { eval "echo \$MODEL_$1"; }

RULES='You are one worker on a team. Do exactly the task below and nothing else.
- Read only the files the task names, plus what you must open to make the change compile.
- Do not read docs/, mockups or lockfiles unless the task names them.
- Follow AGENTS.md. Match the surrounding code style. Keep the change small.
- Do not commit, push, change git config, add dependencies, or edit files outside the task.
- Database tests cannot run inside your sandbox; the worker runs them after you.
- When finished, reply in at most 5 lines: what changed and anything left undone.'

run_task() {
  local json=$1 id title brief repo check setup base tier wt branch dir attempt model prompt fail_tail tokens
  id=$(jq -r '.id' <<<"$json")
  title=$(jq -r '.title' <<<"$json")
  brief=$(jq -r '.description // ""' <<<"$json")
  repo=$(jq -r '.metadata.repo // empty' <<<"$json")
  check=$(jq -r '.metadata.check // "true"' <<<"$json")
  setup=$(jq -r '.metadata.setup // empty' <<<"$json")
  base=$(jq -r '.metadata.base // "main"' <<<"$json")
  tier=$(jq -r '[.labels[]? | select(startswith("tier-")) | ltrimstr("tier-") | tonumber] | first // 2' <<<"$json")
  [ -n "$repo" ] || { bdq update "$id" -s failed --append-notes "worker: no metadata.repo"; return; }
  wt=$WT_ROOT/agent-$id
  branch=agent/$id
  dir=$LOGS/$id
  mkdir -p "$dir"
  if [ ! -d "$wt" ]; then
    git -C "$repo" worktree add -q "$wt" -b "$branch" "$base" 2>/dev/null ||
      git -C "$repo" worktree add -q "$wt" "$branch" ||
      { bdq update "$id" -s failed --append-notes "worker: could not create worktree"; return; }
  fi
  if [ -n "$setup" ]; then
    (cd "$wt" && bash -c "$setup") >"$dir/setup.log" 2>&1 ||
      { bdq update "$id" -s failed --append-notes "worker: setup failed, see $dir/setup.log"; return; }
  fi

  fail_tail=""
  attempt=0
  while [ "$tier" -le 3 ]; do
    model=$(model_for "$tier")
    for try in 1 2; do
      attempt=$((attempt + 1))
      log "$id attempt $attempt on tier $tier ($model)"
      prompt="$RULES

TASK $id: $title

$brief

The worker will verify your change with:
  $check"
      [ -n "$fail_tail" ] && prompt="$prompt

The previous attempt failed this check. Output (last lines):
$fail_tail"
      # Gemini on OpenRouter refuses requests with reasoning off, which Codex sends for models it
      # has no metadata for, so turn it on.
      model_flags=()
      case "$model" in google/*) model_flags=(-c model_reasoning_effort=low -c model_supports_reasoning_summaries=true) ;; esac
      with_timeout "$TIMEOUT" codex exec -m "$model" "${model_flags[@]}" -C "$wt" -s workspace-write \
        --add-dir "$CARGO_TARGET_DIR" --skip-git-repo-check --ephemeral \
        -o "$dir/reply-$attempt.txt" "$prompt" >"$dir/codex-$attempt.log" 2>&1
      tokens=$(grep -A1 '^tokens used' "$dir/codex-$attempt.log" | tail -1 | tr -dc '0-9')
      bdq update "$id" --append-notes "attempt $attempt: tier $tier, $model, ${tokens:-?} tokens" >/dev/null

      if git -C "$wt" diff --quiet && [ -z "$(git -C "$wt" status --porcelain)" ]; then
        fail_tail="No files were changed."
      elif (cd "$wt" && bash -c "$check") >"$dir/check-$attempt.log" 2>&1; then
        git -C "$wt" add -A
        # The hook runs the whole suite; under load a test can time out, so it gets one retry
        # before the attempt counts against the model.
        if git -C "$wt" commit -q -m "$title" -m "Task $id, by Codex ($model, tier $tier)." \
          >"$dir/hook-$attempt.log" 2>&1 ||
          git -C "$wt" commit -q -m "$title" -m "Task $id, by Codex ($model, tier $tier)." \
            >"$dir/hook-$attempt-retry.log" 2>&1; then
          bdq update "$id" -s review --append-notes "passed: branch $branch, $(git -C "$wt" log -1 --format=%h)" >/dev/null
          log "$id passed, set to review"
          return
        fi
        git -C "$wt" reset -q
        fail_tail=$(tail -40 "$dir/hook-$attempt.log")
      else
        fail_tail=$(tail -40 "$dir/check-$attempt.log")
      fi
      log "$id attempt $attempt failed"
    done
    tier=$((tier + 1))
  done
  bdq update "$id" -s failed --append-notes "failed after $attempt attempts; logs in $dir" >/dev/null
  log "$id failed, left for Claude"
}

log "started; queue $Q"
while :; do
  json=$(bdq ready --label codex --claim --json --limit 1 2>/dev/null | jq -c 'if type == "array" then .[0] else . end // empty')
  if [ -n "$json" ] && [ "$json" != "null" ]; then
    run_task "$json"
  elif [ -n "$ONCE" ]; then
    break
  else
    sleep "$POLL"
  fi
  [ -n "$ONCE" ] && break
done
log "stopped"
