# v9 SSE client (mobile live updates)

Branch `v9-sse`. Screens refresh when the server announces a change; the 20 s poll is the fallback.

## What was built
- `SseParser`: pure-Kotlin line parser for `text/event-stream` (event, data, id, comments, multi-line data, blank-line dispatch, BOM and CR tolerated). A bare `event:` with no data (such as `event: reset`) still dispatches.
- `SseLiveUpdates` (implements `LiveUpdates`): `run(client, branchId)` holds one streaming `GET api/v1/events` over the clinic's own Ktor client (same bearer and refresh as every call). `changes()` = stream signals merged with the poll.
  - Backoff 1 s to 30 s, doubling, jitter keeps a random half to all of each wait.
  - 60 s without any line (heartbeat comments count) means dead, reconnect.
  - `Last-Event-ID` sent on reconnect when the server has sent an `id:`; cleared on a new run (clinic switch). Works unchanged when the server never sends ids.
  - Refresh on every event except `ready` (connect already refreshed), on `reset` and `resync`, and after every (re)connect.
  - 401, 403 and other 4xx (not 408/429) stop for good: `stopped` = `Refused(status)`, polling carries on. 5xx, 408, 429 and network errors retry.
  - Logs only event kind (from a fixed list, else `other`), status codes, counts. Payloads, ids and branch id are never logged.
- `PollingUpdates` (the hook): poll is 20 s, 120 s while the stream is `connected`. Done once here, holders unchanged.
- `AppGraph`: `liveStream` flag (default on), `val live: SseLiveUpdates`; one collector runs it while signed in with a clinic open (`collectLatest`, so sign-out and a clinic switch cancel it).
- `OutboxFiles.clear()` added (memory, Android already had it, iOS `ProtectedOutboxFiles` new); `endOutbox()` calls it at sign-out.

## Contract notes
- The server doc (`be-flow.md`) names the query `branch_id` and the signals `ready`, `resync`; the brief said `branch` and `reset`. The client sends `branch_id` and treats `ready` as a no-op, `reset` and `resync` as refetch-all. No `Last-Event-ID` is honoured by the server today; the client is ready for it.
- The app does not pass a branch yet (clinic-wide stream); `run(client, branchId)` supports it.

## Files
`shared/src/commonMain/.../LiveUpdates.kt`, `live/SseParser.kt`, `live/SseLiveUpdates.kt`, `AppGraph.kt`, `outbox/OutboxFiles.kt`, `iosMain/.../ProtectedOutboxFiles.kt`, `androidMain/.../AndroidOutboxFiles.kt` (override only).
Tests: `commonTest/.../live/SseParserTest.kt` (18), `SseLiveUpdatesTest.kt` (13).

## Tests
Parser unit tests. Stream tests use MockEngine with a `ByteChannel` body the test writes to: event to refresh, `ready` and heartbeat make none, `reset`/`resync`, reconnect sends `Last-Event-ID` and refreshes, heartbeat timeout vs comments keeping alive, 401/403/404 stop, 5xx retried, cancel (sign-out) stops, clinic switch drops the old id, backoff range, poll 20 s vs 120 s, log contains no payload. Stream tests run in real time with short intervals: MockEngine delivers on its own threads, so a virtual clock races it.

Results: `cd mobile && ./gradlew --max-workers=2 check` passes (exit 0), including the 31 new tests. `ios-check.sh` (iPhone 17) passes (exit 0) after keeping a Swift-visible `PollingUpdates(intervalMillis:)` constructor. Existing graph tests build with `liveStream = false` in `testGraph` so the stream's request does not disturb their request counts. Lint rejects a literal BOM in source, so the parser builds it with `Char(0xFEFF)`. Logs: `~/project/.targets/v9-sse-logs/`.

## Next step
Server upgrade (`id:`, `Last-Event-ID`, `reset`) lands on its branch; then run both against a dev server. Screens other than the desk board still need `observe(app.live)` (only `DeskBoardStateHolder.observe` exists today); queue, today and notifications holders are the first.
