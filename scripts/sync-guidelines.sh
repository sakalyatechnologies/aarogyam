#!/bin/sh
# Copies the shared guidelines, vendored references and hooks from a sakalya-backend checkout.
# Usage: scripts/sync-guidelines.sh [path-to-sakalya-backend]   (default ../sakalya-backend)
set -e
src="${1:-../sakalya-backend}"
for f in "$src"/docs/guidelines/*.md; do
  { echo "<!-- Copied from sakalya-backend. Edit it there, then run scripts/sync-guidelines.sh. -->"; echo; cat "$f"; } > "docs/guidelines/$(basename "$f")"
done
cp "$src"/docs/vendor/* docs/vendor/
# .githooks/pre-commit is not copied: the product's hook extends the shared one (schema docs,
# database tests). Merge changes from "$src"/.githooks/pre-commit by hand.
cp "$src"/.claude/hooks/format-rust.sh .claude/hooks/format-rust.sh
cp "$src"/.claude/settings.json .claude/settings.json
cp "$src"/scripts/install-hooks.sh scripts/install-hooks.sh
echo "synced from $src"
