#!/bin/sh
# Xcode build phase: uploads the Release build's dSYMs to Crashlytics so crash reports have
# symbols. Only for Release builds that carry the Firebase config (copy-firebase-config.sh).
set -eu
[ "$CONFIGURATION" = "Release" ] || exit 0
plist="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/GoogleService-Info.plist"
[ -f "$plist" ] || exit 0
run="${BUILD_DIR%/Build/*}/SourcePackages/checkouts/firebase-ios-sdk/Crashlytics/run"
if [ ! -x "$run" ]; then
  echo "warning: Crashlytics upload tool not found; crash reports will lack symbols"
  exit 0
fi
"$run" -gsp "$plist"
