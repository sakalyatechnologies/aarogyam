# v9 outbox2: persistent outbox in the app (handoff)

Branch `v9-outbox2` (from 047c6dc). Closes the gap in `outbox.md` and `ios-desk.md`: unsent writes now survive the app being killed.

## What was built
- `outbox/JsonOutboxPersistence.kt`: JSON file through an `OutboxFile` (read, `writeAtomically` = temp file then rename, `moveAside`). A corrupt file is moved aside (`outbox.json.corrupt-<time>`) and the queue starts empty, never thrown. A file that exists but cannot be read (locked phone) is left alone and nothing is saved over it that run.
- `PersistentOutboxStore`: cap 500 (`OUTBOX_MAX_ENTRIES`). A new entry at the cap evicts the oldest Failed one, else throws `OutboxFullException` (a holder should tell the person; no write is dropped silently). A failed save is logged as a code and the entry stays in memory.
- Patient data is allowed in the file only because it is protected app storage (KDoc says so). Payload never logged; `toString` omits it.
- iOS `ProtectedOutboxFile`: Application Support/aarogyam, `NSFileProtectionComplete`. Android `FilesDirOutboxFile` (androidApp, `context.filesDir`), passed in `AarogyamApp` like Preferences. No Android UI.
- `AppGraph.outbox` (one `OutboxRunner`): started at graph creation and on every SignedIn; on SignedOut (sign-out or a session that ended by itself) it is stopped and `clear()`ed, so queued writes of the previous person never send under another. Exposes `pending` and `failed`. `registerSender(kind, sender)`; a kind with no sender waits (`no_sender`), it is not rejected. A clinic opening calls `retryNow()`.
- iOS desk payments use `graph.outbox`; iosMain in-memory `DeskOutbox` deleted (file now `DeskPaymentDelivery.kt`, `AppGraph.registerDeskPayments()`). `PaymentJob` carries `clinicSlug`.
- `Support/OutboxBadge.swift`: `OutboxBadge(graph:)`, "Saved, will send · N" (key `outbox.badge`, en/hi), empty when nothing waits.

## Tests (`commonTest/outbox/OutboxPersistenceTest.kt`, 6, plus the 8 earlier)
Round trip; corrupt file and bad kind moved aside; unreadable file never overwritten; cap and eviction; restart resumes once with the same key; sign-out empties queue and file.

## Gaps
- Restart then payment: the clinic is not open until the person opens it, so the entry waits (`clinic_not_open`), then sends at once.
- Sign-out drops unsent writes by design, including after a session that expired.
- Only Payment has a sender; Note/Photo/VisitClose holders and Android senders are not built.
- No 48 h expiry, no background task. Android file store has no instrumented test.
- `DeskPaymentSheet` keeps its own badge; `OutboxBadge` is not placed on other screens yet.
