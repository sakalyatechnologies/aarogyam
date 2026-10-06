#!/usr/bin/env bash
# Brings a Lovable export of the public website into web/apps/website, keeping our plumbing.
# See web/apps/website/IMPORT.md.
#
#   scripts/import-website.sh <export.zip>                 import a new export
#   scripts/import-website.sh --make-patch <export.zip>    rebuild lovable-edits.patch from the
#                                                          export our current edits started from
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="$REPO_ROOT/web/apps/website"
PATCH="$SITE/lovable-edits.patch"
# The only Lovable files we edit (paths inside web/apps/website, after the netlify -> landing rename).
EDITED="src/routes/__root.tsx src/routes/index.tsx src/routes/register.tsx src/landing/Shell.jsx src/landing/views/RegisterView.jsx"

MODE=import
if [ "${1:-}" = "--make-patch" ]; then MODE=patch; shift; fi
[ $# -eq 1 ] && [ -f "$1" ] || { echo "Usage: $0 [--make-patch] <export.zip>" >&2; exit 1; }
ZIP="$1"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$ZIP" -d "$WORK/raw"
# Some zips wrap everything in one folder.
SRC="$WORK/raw"
if [ "$(ls -A "$SRC" | wc -l)" -eq 1 ] && [ -d "$SRC/$(ls -A "$SRC")" ] && [ ! -f "$SRC/package.json" ]; then
  SRC="$SRC/$(ls -A "$SRC")"
fi

# Reduce the export to the parts we keep: src/ and public/, minus what we replaced or dropped.
CLEAN="$WORK/clean"
mkdir -p "$CLEAN"
cp -R "$SRC/src" "$CLEAN/src"
[ -d "$SRC/public" ] && cp -R "$SRC/public" "$CLEAN/public"
(
  cd "$CLEAN"
  # Lovable telemetry, the SSR server and its error pages, unused shadcn components, and the
  # mock sign-in / application tracker (replaced by src/aarogyam and the real API).
  rm -rf src/components/ui src/hooks src/server.ts src/start.ts src/routeTree.gen.ts \
    src/lib/lovable-error-reporting.ts src/lib/error-capture.ts src/lib/error-page.ts \
    src/routes/login.tsx src/routes/track.tsx src/routes/README.md \
    src/netlify/views/LoginView.jsx src/netlify/views/StatusView.jsx
  if [ -d src/netlify ]; then
    mv src/netlify src/landing
    grep -rlE "netlify" src | xargs sed -i.bak -E 's#netlify/#landing/#g; s#\.\./netlify#../landing#g'
    find src -name '*.bak' -delete
  fi
)

if [ "$MODE" = patch ]; then
  : >"$PATCH"
  for f in $EDITED; do
    # diff exits 1 when the files differ, which is the point.
    (cd "$WORK" && diff -u --label "a/$f" --label "b/$f" "clean/$f" "$SITE/$f" || true) >>"$PATCH"
  done
  echo "Wrote $PATCH ($(grep -c '^@@' "$PATCH") hunks)."
  exit 0
fi

# Replace the Lovable-owned folders, keeping everything of ours.
rsync -a --delete \
  --exclude 'aarogyam/' --exclude 'routes/sign-in.tsx' --exclude 'routeTree.gen.ts' \
  --exclude 'vite-env.d.ts' --exclude 'test/aarogyam*' \
  "$CLEAN/src/" "$SITE/src/"
[ -d "$CLEAN/public" ] && rsync -a --delete "$CLEAN/public/" "$SITE/public/"

echo "Re-applying our edits to Lovable's files..."
cd "$SITE"
if ! patch -p1 --forward --no-backup-if-mismatch <"$PATCH"; then
  echo "Some hunks did not apply (see .rej files). Port them by hand, then run" >&2
  echo "  scripts/import-website.sh --make-patch <this export.zip>   to refresh the patch." >&2
  exit 1
fi
echo "Done. Next: pnpm --filter @aarogyam/website build (regenerates src/routeTree.gen.ts), then typecheck and test."
