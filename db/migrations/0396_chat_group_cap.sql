-- A group holds at most 100 active members (docs/decisions.md, "Staff chat"). The API checks one
-- request; this trigger checks the total, so no route can go past it. It locks the conversation
-- first, so two requests adding members at once count one after the other. Direct conversations
-- have two members by construction.
set local lock_timeout = '5s';

create function app.guard_chat_group_size() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.left_at is not null then
      return new;
    end if;
    perform 1 from aarogyam.conversations c
      where c.org_id = new.org_id and c.id = new.conversation_id for update;
    if (select count(*) from aarogyam.conversation_members m
        where m.org_id = new.org_id and m.conversation_id = new.conversation_id
          and m.left_at is null and m.membership_id <> new.membership_id) >= 100 then
      raise exception 'a group holds at most 100 members' using errcode = '23514';
    end if;
    return new;
  end
  $$;
revoke execute on function app.guard_chat_group_size() from public;

create trigger group_size before insert or update of left_at on aarogyam.conversation_members
  for each row execute function app.guard_chat_group_size();
