# be-int handoff - BLOCKED at step 1 (disk full)

Branch feat/v9-backend. Only the `v9-be-queue` merge (no-ff) is done; nothing is compiled or tested.

## Why stopped
The data volume hit 100% (123 MiB free of 460 GiB). `cargo build` failed with
"No space left on device" and the migration run failed at migration 5 on database
`aarogyam_v9be` (partially migrated: 4 of N applied; drop and recreate it before retrying).
`~/project/.targets/` holds v9-be-close/family/queue/share (4.7 GiB) from earlier workers; I did not
delete them because other sessions may use them.

## State per BE item
- BE2 queue states/call/filter (v9-be-queue): merged, not compiled, no tests.
- BE4 notifications: merged, feed does not show queue kinds yet.
- BE5 close (v9-be-close), BE1 family (v9-be-family), BE8 share (v9-be-share): not merged.

## To resume
1. Free disk (>= 15 GiB), `dropdb aarogyam_v9be; DB=aarogyam_v9be scripts/dev-db.sh`.
2. Migrate (the server binary needs a compile, so bootstrap with sqlx CLI):
   `psql <owner url> -c 'create schema if not exists private'`, then
   `sqlx migrate run --source db/migrations --database-url "postgres://aarogyam_owner@localhost:5432/aarogyam_v9be?options=-c%20search_path%3Dprivate"`.
3. Continue steps 1-7 of the task, starting from the "Left" list in be-queue.md.

## Endpoints, tests, gaps
None verified yet. See docs/plans/v9/be-queue.md for the call endpoint and filter.
