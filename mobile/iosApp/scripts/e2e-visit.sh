#!/bin/sh
# T12: one clinic visit across two simulators against the local API (synthetic seed only). Builds the Local
# app once, then runs the three phases of AarogyamStaffE2E/VisitE2ETests in order: the desk on one simulator,
# the doctor on the other, then the desk again. Prints each step's time and taps, and shuts both simulators down
# at the end. Needs the local API and the portal proxy (app.localtest.me:5173) running.
#   AAROGYAM_E2E_DESK / AAROGYAM_E2E_DOCTOR: simulator names (default iPhone Air / iPhone 17).
set -eu
cd "$(dirname "$0")/.."
desk="${AAROGYAM_E2E_DESK:-iPhone Air}"
doctor="${AAROGYAM_E2E_DOCTOR:-iPhone 17}"
logs="${AAROGYAM_E2E_LOGS:-build/e2e}"
mkdir -p "$logs"
derived=build/derived-data-e2e
# A fresh number each run, so the lookup always finds no one and the intake path runs (not a real person's).
phone="9$(date +%s | tail -c 10)"

xcodegen generate --quiet
xcodebuild build-for-testing -project AarogyamStaff.xcodeproj -scheme AarogyamStaffE2E \
  -destination "platform=iOS Simulator,name=$desk" -derivedDataPath "$derived" \
  AAROGYAM_ENVIRONMENT=Local -quiet > "$logs/build.log" 2>&1

phase() { # simulator, test, log name, extra env...
  sim="$1"; test="$2"; name="$3"; shift 3
  env "$@" xcodebuild test-without-building -project AarogyamStaff.xcodeproj -scheme AarogyamStaffE2E \
    -destination "platform=iOS Simulator,name=$sim" -derivedDataPath "$derived" \
    -resultBundlePath "$logs/$name.xcresult" -only-testing:"AarogyamStaffE2E/VisitE2ETests/$test" \
    > "$logs/$name.log" 2>&1 || { echo "e2e: $name failed (see $logs/$name.log and $name.xcresult)" >&2; return 1; }
  grep -E "^E2E step" "$logs/$name.log" | sed "s/^/$name: /" || true
}

rm -rf "$logs"/*.xcresult
status=0
phase "$desk" test1_deskRegistersAndQueues desk-queue TEST_RUNNER_E2E_PHONE="$phone" || status=1
token=$(grep -oE "E2E-TOKEN=[0-9]+" "$logs/desk-queue.log" | head -1 | cut -d= -f2 || true)
if [ "$status" -eq 0 ] && [ -n "$token" ]; then
  echo "e2e: token $token"
  phase "$doctor" test2_doctorSeesAndFinishes doctor TEST_RUNNER_E2E_TOKEN="$token" || status=1
  [ "$status" -eq 0 ] && { phase "$desk" test3_deskCollects desk-collect TEST_RUNNER_E2E_TOKEN="$token" || status=1; }
fi
xcrun simctl shutdown "$desk" 2>/dev/null || true
xcrun simctl shutdown "$doctor" 2>/dev/null || true
exit "$status"
