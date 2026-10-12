# v9 Android outbox files (worker and)

Branch `v9-and`. Queued photo bytes now persist on Android instead of the in-memory default.

## Built
- `AndroidOutboxFiles(directory: File)` (+ `constructor(Context)` = `noBackupFilesDir/outbox`), `shared/src/androidMain/.../outbox/AndroidOutboxFiles.kt`.
  - `write` = temp file (`<name>.tmp`) then rename; no half files, no leftover temp.
  - `read` null when missing, `delete` is idempotent, `totalBytes` ignores temp files.
  - Extra (not in the interface): `list()` oldest write first, ties by name; `clear()` removes everything incl. temp files.
  - Names validated (no `/`, `..`, `.tmp` suffix).
- Security: no NSFileProtectionComplete on Android. App-private internal storage, no-backup dir, file-based encryption at rest (minSdk 26). `EncryptedFile` not used (security-crypto deprecated); documented in KDoc. No new dependencies.
- Wiring: `AarogyamApp.kt` passes `outboxFiles = AndroidOutboxFiles(this@AarogyamApp)` to `AppGraph.create`.

## Sign-out
`OutboxRunner.clear()` deletes each entry's file, as on iOS. `AndroidOutboxFiles.clear()` exists for orphan files but is not called from commonMain (the interface has no `clear`, and commonMain was out of scope).

## Tests
`shared/src/androidHostTest/.../AndroidOutboxFilesTest.kt` (8, plain JVM temp dir): write/read, atomic overwrite, delete, list order, temp ignored, clear, new instance (restart), empty file. `./gradlew check` exit 0 (log: `~/project/.targets/v9-and-logs/check.log`).

## Next
- Add `clear()` to the `OutboxFiles` interface (or call it from `AppGraph.signOut`) to sweep orphans after a crash.
- On-device check: queue a photo in airplane mode, kill the app, relaunch, confirm it sends.
