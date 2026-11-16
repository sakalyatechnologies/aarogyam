set -u
cd ~/project/wt-v11-shots/mobile/iosApp
sh scripts/store-seed.sh > /dev/null || { echo seed-failed; exit 1; }
. ./build/store-seed.env
sim="iPhone Air"; out=build/store-shots; rm -rf $out; mkdir -p $out
export SAKALYA_MOBILE_PATH=$HOME/project/wt-v11-shots/mobile/.deps/sakalya-mobile
xcodegen generate --quiet; xcrun simctl boot "$sim" 2>/dev/null; xcrun simctl ui "$sim" appearance light; xcrun simctl status_bar "$sim" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4
xcodebuild build-for-testing -project AarogyamStaff.xcodeproj -scheme AarogyamStaffE2E -destination "platform=iOS Simulator,name=$sim" -derivedDataPath build/derived-data-e2e AAROGYAM_ENVIRONMENT=Local -quiet > $out/build.log 2>&1 || { echo build-failed; tail -20 $out/build.log; exit 1; }
TEST_RUNNER_STORE_PATIENT=$STORE_PATIENT TEST_RUNNER_STORE_TOKEN=$STORE_TOKEN xcodebuild test-without-building -project AarogyamStaff.xcodeproj -scheme AarogyamStaffE2E -destination "platform=iOS Simulator,name=$sim" -derivedDataPath build/derived-data-e2e -resultBundlePath $out/shots.xcresult -only-testing:AarogyamStaffE2E/StoreScreensTests > $out/test.log 2>&1; echo test=$?
grep -E "Test Case .* (passed|failed)|error:" $out/test.log | head
xcrun xcresulttool export attachments --path $out/shots.xcresult --output-path $out/png > /dev/null 2>&1
python3 -c "
import json;m=json.load(open('$out/png/manifest.json'))
for t in m:
  for a in t.get('attachments',[]): print('$out/png/'+a['exportedFileName'], a.get('suggestedHumanReadableName'))"
xcrun simctl shutdown "$sim" 2>/dev/null || true
