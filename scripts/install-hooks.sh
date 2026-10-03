#!/bin/sh
# Points git at the repository's hooks. Run once per clone.
set -e
git config core.hooksPath .githooks
chmod +x .githooks/* .claude/hooks/* 2>/dev/null || true
echo "git hooks installed from .githooks"
