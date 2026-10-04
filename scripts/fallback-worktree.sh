#!/usr/bin/env bash
# Creates a worktree and branch for one fallback task (docs/fallback-agent.md):
#   scripts/fallback-worktree.sh FB-07   →  ../wt-fb-07 on branch fallback/fb-07, from main
# Installs web dependencies there. Never touches main's checkout.
set -euo pipefail

if [ $# -ne 1 ] || ! printf '%s' "$1" | grep -qiE '^FB-[0-9]+$'; then
  echo "Usage: $0 FB-<number>" >&2
  exit 1
fi
ID="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$(dirname "$REPO_ROOT")/wt-${ID}"
BRANCH="fallback/${ID}"

if [ -d "$DIR" ]; then
  echo "$DIR already exists; continue there (branch $BRANCH)."
  exit 0
fi
git -C "$REPO_ROOT" worktree add "$DIR" -b "$BRANCH" main
export PATH="/opt/homebrew/bin:$PATH"
(cd "$DIR" && pnpm install --frozen-lockfile >/dev/null)
echo "Ready: cd $DIR   (branch $BRANCH). Read docs/fallback-agent.md, then your task in docs/fallback-tasks.md."
