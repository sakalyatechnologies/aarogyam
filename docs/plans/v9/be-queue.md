# be-queue handoff (BE2, BE4) - WIP, paused at the coordinator's stop

Status: wip. Code written but NOT compiled or tested yet (cargo check was still running at pause).
No clippy, no tests, no OpenAPI regen, no sqlx-prepare, no gen_schema_docs run.

## Done (uncommitted-before-this-commit, now in wip commit)
- 0420: queue_tokens.status check adds `called`, `ready_to_bill` (expand).
- 0421: staff_notifications gains `queue_token_id`, `audience` (doctor|front_desk|billing), kinds
  patient_waiting/send_in/collect_payment, one-subject check now 3-way.
- Domain: QueueStatus Called/ReadyToBill + transitions (waiting>called>in_chair, called>waiting,
  in_chair>ready_to_bill>done, left from any open; old waiting>in_chair/done kept); NotificationKind
  + QueueAudience; unit test queue_visit_flow_moves.
- DAL: queue list takes practitioner_id; set_status clears called_at on waiting; notifications
  insert_queue / handle_queue.
- App: queue::call (ClinicalWrite, reach via lock_for_visit); issue_token writes patient_waiting when a
  doctor is set; move_token writes send_in (to called) and collect_payment (to ready_to_bill) and
  marks answered ones handled.
- API: POST /api/v1/queue/{id}/call (200 QueueToken; 409 MoveRefused); GET /queue?practitioner_id=.
- docs/schema/model.py updated (database.md not regenerated).

## Left (next step in order)
1. `DATABASE_URL=postgres://aarogyam_owner@localhost:5432/aarogyam_dev_queue SQLX_OFFLINE=false cargo check -p aarogyam-api`
   (DB aarogyam_dev_queue already migrated to 0421 via sqlx migrate, search_path=private); fix errors.
2. scripts/sqlx-prepare.sh with that DATABASE_URL; UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi;
   python3 scripts/gen_schema_docs.py.
3. Tests: API call + filter, 403 (front desk lacks clinical.write), cross-clinic 404, notification rows;
   fix existing tests listing QueueStatus/ALL or callers of queue::list.
4. Gap: notification FEED does not show queue kinds yet (feed/count/mark_read/badges in dal
   notifications.rs and chat.rs badges filter by appointment/lab only). Add a third branch: doctor =
   token's practitioner membership; front_desk = appointments.write; billing = billing.write or finance.view.
5. Appointment cancel from in_chair may refuse `left`; check.

## Mobile needs
Statuses called/ready_to_bill in QueueToken.status; call endpoint; practitioner_id filter.
