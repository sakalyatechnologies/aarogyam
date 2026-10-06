#!/bin/sh
# The iOS part of the mobile gate: generates the Xcode project, builds the app for the iOS
# simulator (which builds the shared framework through Gradle) and runs its XCTests there.
set -eu
cd "$(dirname "$0")/.."
simulator="${AAROGYAM_IOS_SIMULATOR:-iPhone 18 Pro}"
xcodegen generate --quiet
xcodebuild test \
  -project AarogyamStaff.xcodeproj \
  -scheme AarogyamStaff \
  -destination "platform=iOS Simulator,name=$simulator" \
  -derivedDataPath build/derived-data \
  -quiet
