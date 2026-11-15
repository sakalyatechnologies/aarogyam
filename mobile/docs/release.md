# Releasing Aarogyam to the App Store and Google Play

There is one app for everyone: `AarogyamStaff` on iOS and `androidApp` on Android. Each person sees what their role allows. Patients will come into the same app later; `patientIos` and `patientApp` are not shipped.

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

The files are listed in `fastlane/credentials/README.md`.

**App Store Connect:**
- App Store Connect, Users and Access, Integrations: create a team API key with the App Manager role.
- Save it as `fastlane/credentials/AuthKey_<KEYID>.p8`.
- Export `APP_STORE_CONNECT_API_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`.
- The team id defaults to Sakalya's (`WQCU2WYFHG`). `APPLE_TEAM_ID` overrides it.

**Google Play:**
- Google Cloud: create a service account and download its JSON key as `fastlane/credentials/google-play.json`.
- Play Console, Users and permissions: invite the service account's email and give it release rights for Aarogyam Clinic.

**Android upload key:** `~/.aarogyam-release/aarogyam-upload.jks`, with its passwords in `~/.aarogyam-release/keystore.properties`.
- Copy that properties file to `mobile/androidApp/keystore.properties` (git-ignored), or set `AAROGYAM_UPLOAD_STORE_FILE`, `_STORE_PASSWORD`, `_KEY_ALIAS` and `_KEY_PASSWORD`.
- Enrol the app in Play App Signing. Google then holds the app signing key, and this file is only the upload key; if it is lost, Play support can reset it.
- **Back up both files into the founder's password manager.**

**Production settings:**
- Release builds embed `supabase.url`, `supabase.key` and `prod.app_host` from the git-ignored `mobile/local.secrets.properties`, or the matching `AAROGYAM_*` variables.
- The build lanes refuse to run without them.
- `prod.app_host` is the interim `aarogyam-portal.spring-snow-130f.workers.dev`. **Move it to the stable domain before the first public release** (`docs/deploy.md`, "Moving the domain"). A store build that bakes in the workers.dev host breaks the day the domain moves.

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
  - The name "Aarogyam Clinic" is a placeholder until the founder confirms it; store names must be unique.
  - The privacy and support links point at `https://aarogyam.sakalyatechnologies.com/privacy` and `/support`.
- **Icon:** the interim icon is the launcher's white cross on `#136650`:
  - `iosApp/AarogyamStaff/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`
  - `metadata/android/en-US/images/icon.png` (512) and `featureGraphic.png` (1024×500).
  - Replace them with the approved artwork before the public release.
- **App Review sign-in:**
  - `review_information/notes.txt` tells the reviewer to use "Use a password" with the demo account. That is the owner of a synthetic demo clinic on prod, created by the backend's script.
  - Write the account's email into `review_information/demo_user.txt` and its password into `demo_password.txt`. Both are git-ignored, so set them locally, or type them straight into App Store Connect and the Play Console.
  - Add a contact phone number in `phone_number.txt`.
- **Privacy:**
  - `iosApp/AarogyamStaff/PrivacyInfo.xcprivacy` declares the collected data (email, name, user id, health, photos, other content; all linked, for app functionality, no tracking) and the required-reason APIs.
  - The App Store privacy labels and Play's Data safety form must say the same.
  - Play also asks for the Health apps declaration. Aarogyam is a clinic records app for healthcare providers.
- **Account deletion:** in the app (More, Delete account: `DELETE /me/account`). The web page is `/account-deletion`.
