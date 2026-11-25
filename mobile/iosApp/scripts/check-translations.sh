#!/bin/sh
# Fails the build when a staff-app String Catalog key has no Hindi (hi) or Marathi (mr) value.
# Keys with "shouldTranslate": false are skipped. Run from the Xcode project (SRCROOT) or by hand.
set -eu
cd "${SRCROOT:-$(dirname "$0")/..}"
python3 - AarogyamStaff <<'PY'
import glob
import json
import sys

missing = []
for path in sorted(glob.glob(sys.argv[1] + "/**/*.xcstrings", recursive=True)):
    with open(path, encoding="utf-8") as f:
        catalog = json.load(f)
    for key, entry in catalog.get("strings", {}).items():
        if entry.get("shouldTranslate") is False or not key:
            continue
        locs = entry.get("localizations", {})
        for lang in ("hi", "mr"):
            loc = locs.get(lang, {})
            if not loc.get("stringUnit", {}).get("value", "").strip() and not loc.get("variations"):
                missing.append(f"{path}: {key!r} has no {lang} value")
for line in missing:
    print("error: " + line)
if missing:
    print(f"error: {len(missing)} missing hi/mr values; add a translation or set shouldTranslate to false")
    sys.exit(1)
PY
