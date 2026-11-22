# Releasing Aarogyam to the App Store and Google Play

There is one app for everyone: `AarogyamStaff` on iOS (bundle id `com.aarogyam.ios`, store name "Aarogyam") and `androidApp` on Android (`com.aarogyam.android`). Each person sees what their role allows. Patients will come into the same app later; `patientIos` and `patientApp` are not shipped.

It is published from Sakalya Technologies' existing Apple and Google developer accounts, the same ones MyDwarpal uses. Everything runs through fastlane, from `mobile/`.

## 1. Install (once per machine)

```sh
cd mobile
bundle config set --local path vendor/bundle
bundle install
bundle exec fastlane lanes
```

You also need Xcode, `xcodegen`, JDK 17 and the Android SDK (the same as `./gradlew check`).

## 2. Credentials (once per machine)

The files are listed in `fastlane/credentials/README.md`. The originals live outside git in `~/.aarogyam-release/` (chmod 600); `AAROGYAM_RELEASE_DIR` points elsewhere.

**App Store Connect:**
- The team API key "Aarogyam Fastlane" (App Manager) is `~/.aarogyam-release/AuthKey_<KEYID>.p8`. Copy it to `fastlane/credentials/`.
- Its key id and issuer id are in `~/.aarogyam-release/asc.env` (`APP_STORE_CONNECT_API_KEY_ID=…`, `APP_STORE_CONNECT_ISSUER_ID=…`). The Fastfile reads `fastlane/credentials/asc.env` or that file for any variable not already set.
- The team id defaults to Sakalya's (`WQCU2WYFHG`). `APPLE_TEAM_ID` overrides it.

**Google Play:**
- Google Cloud: create a service account and download its JSON key as `fastlane/credentials/google-play.json`.
- Play Console, Users and permissions: invite the service account's email and give it release rights for Aarogyam.

**Firebase (Crashlytics and Analytics):** project `aarogyam-3fe30`.
- `~/.aarogyam-release/firebase/GoogleService-Info.plist` (registered for `com.aarogyam.ios`): the Release build phase `iosApp/scripts/copy-firebase-config.sh` copies it into the app; `AAROGYAM_FIREBASE_PLIST` overrides the path. The Debug (demo) build never gets it.
- `~/.aarogyam-release/firebase/google-services.json` (for `com.aarogyam.android`): `fastlane android build` copies it to the git-ignored `androidApp/src/prod/google-services.json`. Local and demo builds have none.
- No advertising ID on either platform; the Android ad-service permissions are removed in the manifest. Never put patient data in an event, a custom key or a log Crashlytics might collect.
- The build lanes refuse to run without the config.

**Android upload key:** `~/.aarogyam-release/aarogyam-upload.jks`, with its passwords in `~/.aarogyam-release/keystore.properties`.
- Copy that properties file to `mobile/androidApp/keystore.properties` (git-ignored), or set `AAROGYAM_UPLOAD_STORE_FILE`, `_STORE_PASSWORD`, `_KEY_ALIAS` and `_KEY_PASSWORD`.
- Enrol the app in Play App Signing. Google then holds the app signing key, and this file is only the upload key; if it is lost, Play support can reset it.
- **Back up both files into the founder's password manager.**

**Production settings:**
- Release builds embed `supabase.url`, `supabase.key` and `prod.app_host` from the git-ignored `mobile/local.secrets.properties`, or the matching `AAROGYAM_*` variables.
- The build lanes refuse to run without them.
- `prod.app_host` is `aarogyam-portal.spring-snow-130f.workers.dev`, and 1.0 ships with it (21 Nov 2026). The backend keeps that Worker deployed and proxying the API permanently, also after the domain move (`docs/decisions.md`), so installed copies keep working. Builds made after the stable domain exists switch to it.

## 3. Commands

| Command | What it does |
|---|---|
| `bundle exec fastlane ios build` | Release `.ipa` (Prod), signed automatically through the API key, in `build/release/` |
| `bundle exec fastlane ios beta` | Build and upload to TestFlight (internal testers) |
| `bundle exec fastlane ios production` | Build and upload to App Store Connect; submit for review there |
| `bundle exec fastlane ios metadata` | Upload the listing text and screenshots only |
| `bundle exec fastlane android build` | Signed prod release `.aab` |
| `bundle exec fastlane android beta` | Upload to the Play internal track |
| `bundle exec fastlane android closed_testing` | Upload to the Play closed (alpha) track |
| `bundle exec fastlane android production [rollout:0.1]` | Upload to production: a draft, or a staged rollout |
| `bundle exec fastlane android metadata` | Upload the listing text, icon, feature graphic and screenshots |

Push notifications: `iosApp/AarogyamStaff/AarogyamStaff.entitlements` says `aps-environment` = `development`. App Store and TestFlight builds get `production` automatically when exported (signing rewrites it), so do not edit the file for a release. The server needs the APNs key (`.p8`, key ID, team ID) for the same environment before alerts arrive.

Uploads never submit for review. That stays a person's click.

## 4. Versions

The repository holds the versions; a build never changes them.

| | Where | Bumped by |
|---|---|---|
| iOS build number | `CURRENT_PROJECT_VERSION` in `iosApp/project.yml` | `fastlane ios bump_build_number` |
| iOS version | `MARKETING_VERSION` in `iosApp/project.yml` | by hand |
| Android version code | `versionCode` in `androidApp/build.gradle.kts` | `fastlane android bump_version_code` |
| Android version name | `versionName` in `androidApp/build.gradle.kts` | by hand |

Commit the bump before uploading. Keep the two marketing versions equal.

## 5. Listing, artwork and review

- **Text:** `fastlane/metadata/ios/` (deliver layout) and `fastlane/metadata/android/` (supply layout), in en-US.
  - The store name is "Aarogyam" (App Store Connect record, 21 Nov 2026); the subtitle is "Front desk to chair, one app".
  - The privacy, support and marketing links point at `https://aarogyam-website.pages.dev/privacy/`, `/support/` and `/` until `aarogyam.sakalyatechnologies.com` resolves; switch them back then.
- **Icon:** the interim icon is the launcher's white cross on `#136650`:
  - `iosApp/AarogyamStaff/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
  - `metadata/android/en-US/images/icon.png` (512) and `featureGraphic.png` (1024×500).
  - Replace them with the approved artwork before the public release.
- **App Review sign-in:**
  - `review_information/notes.txt` tells the reviewer to use "Use a password" with the demo account. That is the owner of a synthetic demo clinic on prod, created by the backend's script.
  - The account is `review-aarogyam@gmail.com` (`review_information/demo_user.txt`). Its password is in the macOS Keychain as "Aarogyam store reviewer" (Keychain Access, or `security find-generic-password -s "Aarogyam store reviewer" -w`); never in git or chat.
  - `demo_password.txt` is git-ignored and filled from the Keychain, so `fastlane ios metadata` sends it; type it into the Play Console's App access page.
  - The backend's `aarogyam admin review-account` reads the same Keychain entry into `AAROGYAM_REVIEW_PASSWORD` (not `ARO_*`: the strict config loader refuses unknown `ARO_` variables).
  - The contact phone number is in the git-ignored `phone_number.txt`.
- **Privacy:**
  - `iosApp/AarogyamStaff/PrivacyInfo.xcprivacy` declares the collected data (email, name, user id, health, photos, other content; all linked, for app functionality, no tracking) and the required-reason APIs.
  - Firebase adds crash data, performance data, other diagnostic data, product interaction and a device id: not linked to the user, no tracking, for analytics (crash data also for app functionality).
  - The App Store privacy labels and Play's Data safety form must say the same.
  - Play also asks for the Health apps declaration. Aarogyam is a clinic records app for healthcare providers.
- **Account deletion:** in the app (More, Delete account: `DELETE /me/account`). The web page is `/account-deletion`.
