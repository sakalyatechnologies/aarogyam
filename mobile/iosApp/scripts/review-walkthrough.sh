#!/bin/sh
# App Review screen recording: drives the installed store app on a connected iPhone (ReviewWalkthroughTests).
# Start the phone's screen recording first. The demo login is read from the git-ignored review files.
# Usage: scripts/review-walkthrough.sh [device-udid]
set -eu
cd "$(dirname "$0")/.."
R=../fastlane/metadata/ios/review_information
DEVICE=${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /available/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i}' | head -1)}
[ -n "$DEVICE" ] || { echo "no iPhone connected" >&2; exit 1; }
TEST_RUNNER_REVIEW_EMAIL=$(cat "$R/demo_user.txt") \
TEST_RUNNER_REVIEW_PASSWORD=$(cat "$R/demo_password.txt") \
xcodebuild test -scheme AarogyamStaffE2E -destination "id=$DEVICE" \
  -only-testing:AarogyamStaffE2E/ReviewWalkthroughTests -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="${APPLE_TEAM_ID:-WQCU2WYFHG}" CODE_SIGN_STYLE=Automatic -quiet
