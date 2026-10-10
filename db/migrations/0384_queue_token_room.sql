-- The chair a queue token's patient was seated in, chosen when the token moves to in_chair
-- (POST /queue/{id}/status with room_id). The app checks the room is in the token's branch;
-- a token with an appointment moves the appointment to the same chair. Additive.
set local lock_timeout = '5s';

alter table aarogyam.queue_tokens
  add column room_id uuid,
  add constraint queue_tokens_room_fk foreign key (org_id, room_id) references aarogyam.rooms (org_id, id);
create index queue_tokens_room on aarogyam.queue_tokens (org_id, room_id) where room_id is not null;
