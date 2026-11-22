# Release credentials

Everything in this folder except this file is git-ignored. Never commit, paste or log these files. If one leaks, revoke it.

| File | What it is | Used by |
|---|---|---|
| `AuthKey_<KEYID>.p8` | App Store Connect API key (role App Manager), plus `APP_STORE_CONNECT_API_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID` in the environment | `fastlane ios beta`, `production`, `metadata`; signing |
| `asc.env` | `APP_STORE_CONNECT_API_KEY_ID=` and `APP_STORE_CONNECT_ISSUER_ID=` lines, read by the Fastfile (also from `~/.aarogyam-release/asc.env`) | every App Store lane |
| `google-play.json` | Google Play service-account key with release access to the app | `fastlane android beta`, `closed_testing`, `production`, `metadata` |

Instead of these files you can set environment variables, which win:
- `APP_STORE_CONNECT_API_KEY_PATH`, or `APP_STORE_CONNECT_API_KEY_CONTENT` (the .p8 in base64, for CI);
- `GOOGLE_PLAY_JSON_KEY` (a path), or `GOOGLE_PLAY_JSON_KEY_DATA` (the JSON itself).

The Android upload key is not kept here. It lives in `~/.aarogyam-release/` (see `docs/release.md`).
