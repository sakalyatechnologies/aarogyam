#!/bin/sh
# Claude Code PostToolUse hook: formats a Rust file right after an agent edits it.
file=$(jq -r '.tool_input.file_path // empty')
case "$file" in
  *.rs) "${HOME}/.cargo/bin/rustfmt" --edition 2024 --quiet "$file" 2>/dev/null || true ;;
esac
exit 0
