-- Settings helpers. A clinic transaction sets these with set_config(…, true), so they
-- vanish at commit or rollback and never leak to the next user of a pooled connection.
-- An unset or empty value reads as null.
set local lock_timeout = '5s';

create function app.tenant_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create function app.user_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app.request_id() returns text
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.request_id', true), '') $$;

-- staff, patient, support or system (no user in the transaction).
create function app.actor_kind() returns text
  language sql stable parallel safe
  as $$ select coalesce(nullif(current_setting('app.actor_kind', true), ''), 'system') $$;

-- UUIDv7 (time-ordered) for column defaults. The API normally sends its own IDs;
-- PostgreSQL 18 has a built-in uuidv7() that can replace this.
create function app.uuid_v7() returns uuid
  language sql volatile parallel safe
  as $$
    select encode(
      set_bit(
        set_bit(
          overlay(uuid_send(gen_random_uuid())
                  placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                  from 1 for 6),
          52, 1),
        53, 1),
      'hex')::uuid
  $$;

grant execute on function app.tenant_id(), app.user_id(), app.request_id(), app.actor_kind(), app.uuid_v7()
  to app_user;
