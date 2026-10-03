#!/bin/sh
# Copies the shared guidelines, vendored references and hooks from a sakalya-platform checkout.
# Usage: scripts/sync-guidelines.sh [path-to-sakalya-platform]   (default ../sakalya-platform)
set -e
src="${1:-../sakalya-platform}"
for f in "$src"/docs/guidelines/*.md; do
  { echo "<!-- Copied from sakalya-platform. Edit it there, then run scripts/sync-guidelines.sh. -->"; echo; cat "$f"; } > "docs/guidelines/$(basename "$f")"
done
cp "$src"/docs/vendor/* docs/vendor/
cp "$src"/.githooks/pre-commit .githooks/pre-commit
cp "$src"/.claude/hooks/format-rust.sh .claude/hooks/format-rust.sh
cp "$src"/.claude/settings.json .claude/settings.json
cp "$src"/scripts/install-hooks.sh scripts/install-hooks.sh
echo "synced from $src"
