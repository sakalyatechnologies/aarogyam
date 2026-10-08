#!/bin/sh
# The patient app's iOS gate: generates the Xcode project, builds the app for the iOS
# simulator (which builds the shared framework through Gradle) and runs its XCTests there.
set -eu
cd "$(dirname "$0")/.."
simulator="${AAROGYAM_IOS_SIMULATOR:-iPhone 18 Pro}"
xcodegen generate --quiet
xcodebuild test \
  -project AarogyamPatient.xcodeproj \
  -scheme AarogyamPatient \
  -destination "platform=iOS Simulator,name=$simulator" \
  -derivedDataPath build/derived-data \
  -quiet

# The development sign-in (it calls the local API's dev-token route) must be in debug builds of
# the Local environment only: the build above is Demo, so it must not contain it, and a Local
# build, as the control, must (or this check proves nothing).
marker="api/v1/dev/token"
demo_app="build/derived-data/Build/Products/Debug-iphonesimulator/AarogyamPatient.app"
if grep -raq "$marker" "$demo_app"; then
  echo "ios-check: the Demo build contains the development sign-in" >&2
  exit 1
fi
xcodebuild build \
  -project AarogyamPatient.xcodeproj \
  -scheme AarogyamPatient \
  -destination "platform=iOS Simulator,name=$simulator" \
  -derivedDataPath build/derived-data-local \
  AAROGYAM_ENVIRONMENT=Local \
  -quiet
if ! grep -raq "$marker" build/derived-data-local/Build/Products/Debug-iphonesimulator/AarogyamPatient.app; then
  echo "ios-check: the Local build does not contain the development sign-in; the check cannot see it" >&2
  exit 1
fi
echo "ios-check: the development sign-in is in the Local debug build only"
