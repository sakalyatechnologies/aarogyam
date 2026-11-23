# Mobile handoff (22 Nov 2026)

Start a new mobile session with: "Read docs/plans/v10/HANDOFF-mobile.md and continue."
Work in `~/project/wt-v10` (branch feat/v10), and push to main. Frugal token mode is on (see memory `feedback-agent-token-budget`).

## Where things stand
- iOS 1.0 builds 1–4 are on TestFlight. Build 4 (`10933cea`) has the dark-mode rework, search while typing (2 letters or 4 digits), and the History cards from `GET /patients/{id}/history`.
- The internal group GoGetters gets every build automatically.
- App Review rejected 1.0 (1). The reason isn't in the API, so ask the founder to paste it from App Store Connect → App Review. Fix it, then resubmit with the latest build; the founder has authorized submission.

## Next, in order
1. Fix the App Review rejection (needs the founder's text).
2. Verify partial-phone search on the phone once the backend deploys it. The phone already calls `/patients/search`.
3. Story bundle: when it lands, add the iOS WKURLSchemeHandler (serve .js as text/javascript), the iOS Present screen, the gradle N7 hash check and a native add_depth picker. The contract is in memory `project-visit-story`.
4. Play Console for com.aarogyam.android. Needs google-play.json from the founder.
5. Fresh store screenshots and preview videos (fastlane).

## Commands
- **Gate:** `~/project/.targets/build-lock.sh sh ~/.aarogyam-release/gate.sh`, then read all three lines (`gradle= ios= patient=`), not just the tail. Release scripts (gate.sh, release-ios.sh, export.plist, tf.rb) are kept in `~/.aarogyam-release/`; edit the `L=`/`S=` log paths inside them to a current scratchpad.
- **Quick test:** `./gradlew --max-workers=2 --no-watch-fs -q spotlessApply :shared:jvmTest --tests '*X*'`, run through build-lock. Common tests also compile for iOS: use no JVM-only APIs, such as `String(ByteArray)`.
- **Release iOS:**
  1. Bump `CURRENT_PROJECT_VERSION` in `mobile/iosApp/project.yml`.
  2. Push.
  3. Archive from a clean worktree at that commit: `git worktree add --detach ~/project/wt-rel <sha>`, symlink `mobile/.deps`, copy `local.secrets.properties`.
  4. Run `R=~/project/wt-rel B=<n> sh ~/.aarogyam-release/release-ios.sh`. It archives, exports with Xcode's signed-in account, and uploads with altool using the API key in `mobile/fastlane/credentials`. Details are in memory `project-store-release`.
- **Build state:** run `bundle exec ruby ~/.aarogyam-release/tf.rb` from `mobile/` (spaceship `App.find("com.aarogyam.ios").get_builds`).

## Traps
- `mobile/.deps/sakalya-mobile` links to `~/project/wt-sakalya-pin2`, the pinned v0.2.0-dev.4 at `1e3f53f5`. If disk cleanup deletes it, recreate it with `git -C ~/project/sakalya-mobile worktree add --detach ~/project/wt-sakalya-pin2 1e3f53f5`.
- Disk cleanup belongs to the backend session. Mobile deletes only its own scratch files.
- `mobile/iosApp/AarogyamStaffE2E/GlassPreviewTests.swift` is untracked on purpose (screenshot helper). Never commit it.
