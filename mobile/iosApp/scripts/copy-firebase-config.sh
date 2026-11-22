#!/bin/sh
# Xcode build phase: puts the Firebase config (GoogleService-Info.plist, registered for
# com.aarogyam.ios) into the Release app only, so the demo and test builds never report to
# Firebase. The file is kept out of git: AAROGYAM_FIREBASE_PLIST wins, else
# ~/.aarogyam-release/firebase/GoogleService-Info.plist (docs/release.md). Without it the app
# builds and simply runs without Crashlytics and Analytics.
set -eu
out="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/GoogleService-Info.plist"
rm -f "$out"
[ "$CONFIGURATION" = "Release" ] || exit 0
src="${AAROGYAM_FIREBASE_PLIST:-$HOME/.aarogyam-release/firebase/GoogleService-Info.plist}"
if [ ! -f "$src" ]; then
  echo "warning: no Firebase config at $src; this build has no Crashlytics or Analytics"
  exit 0
fi
bundle=$(/usr/libexec/PlistBuddy -c "Print :BUNDLE_ID" "$src")
if [ "$bundle" != "$PRODUCT_BUNDLE_IDENTIFIER" ]; then
  echo "error: the Firebase config is for $bundle, this build is $PRODUCT_BUNDLE_IDENTIFIER"
  exit 1
fi
mkdir -p "$(dirname "$out")"
cp "$src" "$out"
