-- Chat channels (docs/decisions.md, "Chat channels, notices and attachments"). A conversation
-- may now be a `channel`: a clinic-wide conversation made by the system, not by a member. Every
-- clinic gets one, "Everyone" (`channel_key = 'everyone'`), whose members are the clinic's active
-- staff: a trigger on memberships puts staff in when they become active and takes them out when
-- they stop being (suspended, left), so nobody manages it by hand. Members can't be added to or
-- removed from a channel through the API, and can't leave it; they can mute it. A person who
-- joins starts with the channel's history read, so a new member isn't greeted by 99+ unread.
-- Membership still decides who sees a channel (0391's policies): a suspended member gets 404.
set local lock_timeout = '5s';

alter table aarogyam.conversations drop constraint conversations_kind_check;
-- Only a direct conversation has no title; a group or channel is named.
alter table aarogyam.conversations drop constraint conversations_check1;
alter table aarogyam.conversations
  add column channel_key text check (channel_key ~ '^[a-z_]{2,40}$');
alter table aarogyam.conversations
  add constraint conversations_kind_check check (kind in ('direct', 'group', 'channel')),
  add constraint conversations_title_by_kind check (kind <> 'direct' or title is null),
  add constraint conversations_channel_key check ((kind = 'channel') = (channel_key is not null)),
  add constraint conversations_channel_title check (kind <> 'channel' or title is not null);
-- One channel of each key per clinic.
create unique index conversations_channel on aarogyam.conversations (org_id, channel_key)
  where kind = 'channel';
comment on column aarogyam.conversations.channel_key is 'everyone: the clinic-wide channel the system keeps';

-- The group-size trigger (0396) is for groups; a channel holds everyone.
create or replace function app.guard_chat_group_size() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_kind text;
  begin
    if new.left_at is not null then
      return new;
    end if;
    select c.kind into v_kind from aarogyam.conversations c
      where c.org_id = new.org_id and c.id = new.conversation_id;
    if v_kind is distinct from 'group' then
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

-- Puts a member in a clinic's "Everyone" channel, or back in it, reading its history as read.
create function app.join_everyone_channel(p_org_id uuid, p_membership_id uuid)
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_conversation uuid;
  begin
    select c.id into v_conversation from aarogyam.conversations c
      where c.org_id = p_org_id and c.channel_key = 'everyone';
    if v_conversation is null then
      return;
    end if;
    insert into aarogyam.conversation_members as cm
      (org_id, conversation_id, membership_id, last_read_message_id)
    values (p_org_id, v_conversation, p_membership_id,
            (select m.id from aarogyam.chat_messages m
             where m.org_id = p_org_id and m.conversation_id = v_conversation
             order by m.id desc limit 1))
    on conflict (org_id, conversation_id, membership_id) do update
      set left_at = null, joined_at = now(), role = 'member',
          last_read_message_id = excluded.last_read_message_id
      where cm.left_at is not null;
  end
  $$;

create function app.leave_everyone_channel(p_org_id uuid, p_membership_id uuid)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    update aarogyam.conversation_members cm set left_at = now()
    from aarogyam.conversations c
    where c.org_id = p_org_id and c.channel_key = 'everyone'
      and cm.org_id = c.org_id and cm.conversation_id = c.id
      and cm.membership_id = p_membership_id and cm.left_at is null
  $$;

-- Makes a clinic's "Everyone" channel if it has none, and puts its active staff in it. Safe to
-- repeat. Returns the channel.
create function app.seed_everyone_channel(p_org_id uuid)
  returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_conversation uuid;
    v_member uuid;
  begin
    insert into aarogyam.conversations (org_id, kind, title, channel_key)
    values (p_org_id, 'channel', 'Everyone', 'everyone')
    on conflict (org_id, channel_key) where kind = 'channel' do nothing
    returning id into v_conversation;
    if v_conversation is null then
      select c.id into v_conversation from aarogyam.conversations c
        where c.org_id = p_org_id and c.channel_key = 'everyone';
    end if;
    for v_member in
      select m.id from aarogyam.memberships m where m.org_id = p_org_id and m.status = 'active'
    loop
      perform app.join_everyone_channel(p_org_id, v_member);
    end loop;
    return v_conversation;
  end
  $$;

create function app.seed_everyone_channel_for_new_clinic()
  returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    perform app.seed_everyone_channel(new.id);
    return null;
  end
  $$;

-- Staff join the channel when they become active and leave it when they stop being.
create function app.sync_everyone_channel()
  returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.status = 'active' then
      perform app.join_everyone_channel(new.org_id, new.id);
    elsif tg_op = 'UPDATE' then
      perform app.leave_everyone_channel(new.org_id, new.id);
    end if;
    return null;
  end
  $$;

revoke execute on function app.join_everyone_channel(uuid, uuid), app.leave_everyone_channel(uuid, uuid),
  app.seed_everyone_channel(uuid), app.seed_everyone_channel_for_new_clinic(),
  app.sync_everyone_channel() from public;
grant execute on function app.seed_everyone_channel(uuid) to aarogyam_api;

create trigger seed_everyone_channel after insert on aarogyam.organizations
  for each row execute function app.seed_everyone_channel_for_new_clinic();
create trigger sync_everyone_channel after insert or update of status on aarogyam.memberships
  for each row execute function app.sync_everyone_channel();

-- Clinics that exist already.
select app.seed_everyone_channel(o.id) from aarogyam.organizations o;
