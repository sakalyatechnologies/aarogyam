-- Sakalya support never reads what a clinic sent its patients or what the patients asked for
-- (docs/decisions.md, "Support grants"). Support holds patients.read, which opens the message
-- list route; this policy closes the rows themselves, as chat's membership policy does for chat.
-- Writes by support are already refused by app.set_row_meta.
set local lock_timeout = '5s';

create policy no_support on aarogyam.messages as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
create policy no_support on aarogyam.message_events as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
create policy no_support on aarogyam.contact_preferences as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
