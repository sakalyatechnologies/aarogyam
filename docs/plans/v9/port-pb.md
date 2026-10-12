# pb (backend port from mobile): state at pause, 12 Oct 2026

**Stopped by the coordinator on the founder's pause.** Under the single-backend rule, this goes to the **backend agent**. Nothing here is on main.

| Commit | State | What |
|---|---|---|
| `e8f360c2` | committed | SSE `GET /api/v1/events?branch_id=` over Postgres LISTEN/NOTIFY, with an `id:` per event and Last-Event-ID replay; migration **0702** |
| the WIP commit on top | uncommitted when stopped; **gates not run** | auto messages (welcome with wait time, visit_summary, follow_up_booking, PIN sent separately), migration **0703**; follow-up link plus `POST /recalls/{id}/dismiss` and payment → token done (0704) partly started |

**Branched from:** main deb08ed8. Main has since taken 0700 (G6) and claimed 0701 (G1), so merge main before using this.

**The mobile client already speaks this SSE contract:** `branch_id` query, a `ready` signal, `resync` meaning refetch all, `id:` lines, the `Last-Event-ID` header.

**Next, for the backend agent:**
1. Merge main and re-check the migration numbers.
2. Run fmt, clippy, the crate tests with `--include-ignored`, sqlx-prepare and openapi.
3. Decide whether the auto-message work fits your notification switches and templates, or redo it there.
