# v9 outbox: offline write queue (handoff)

Branch `v9-outbox` (from 0769804). Shared module only; no holder uses it yet.

## What was built
Writes (notes, photos, payments, visit close) are saved on the phone and sent when the network is back, never twice. Aarogyam-local code; sakalya-mobile's SQLDelight `outbox` module was not adopted (no in-memory store, no per-kind FIFO, not a dependency of `shared`). A later swap is possible: `SendResult` mirrors its `DeliveryResult`.

## Files (mobile/shared/src/commonMain/.../staff/outbox/)
- `OutboxEntry.kt`: entry, `OutboxKind`, `OutboxStatus`; `toString` omits payload.
- `OutboxStore.kt`: `OutboxStore`, `MemoryOutboxStore`, `OutboxPersistence` hook, `PersistentOutboxStore`.
- `Connectivity.kt`: `Connectivity`, `NetworkMonitor.asConnectivity()`, `ManualConnectivity`.
- `OutboxSending.kt`: `OutboxSender`, `SendResult`, `Outcome.toSendResult()`.
- `OutboxRunner.kt`: the runner. `AppGraph` gains `connectivity` and `outboxStore` (create() default: network monitor, memory store).

## Public API
`OutboxRunner(store, sender, connectivity, now)`: `enqueue(kind, payloadJson, id?) -> id`, `drain()`, `start(scope)`, `retry(id)`, `discard(id)`, `pending: StateFlow<Int>`, `failed: StateFlow<List<OutboxEntry>>`.
Rules: FIFO per kind (a backing-off head holds its kind); kinds independent; network/5xx/401/408/426/429 retry with the same id, backoff 2 s doubling, cap 5 min; other 4xx marks the entry Failed and keeps it; an entry is removed only after the server accepted it. `lastError` is a code only.

## How a holder enqueues
`val id = runner.enqueue(OutboxKind.Note, json)`; show "Saved, will send" while `pending > 0`; list `failed` with Try again / Discard. The sender (one place) decodes the payload, calls the API with `entry.id` as the client id or `Idempotency-Key`, and returns `outcome.toSendResult()`.

## Tests (commonTest/.../outbox/OutboxRunnerTest.kt, `:shared:jvmTest --tests 'com.aarogyam.staff.outbox.*'`: 8 pass)
Offline enqueue then online sends once; 5xx keeps the same id with backoff; backoff cap; 4xx stops and keeps the entry; FIFO per kind; restart after delivery does not resend; restart after a crash mid-send resends with the same id; persistence round trip and redacted `toString`.

## Gaps
- Android and iOS `OutboxPersistence` (atomic file, encrypted) are TODO; until then unsent writes are lost when the app is killed.
- Not wired: no holder enqueues; no real `OutboxSender`; no runner started in the app; no "Saved, will send" UI.
- No 48 h expiry; no Android WorkManager or iOS background task.
- Payments are online-only in 1A per architecture; the Payment kind exists for later.
- iOS simulator tests not run.
