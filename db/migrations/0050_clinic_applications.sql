-- Clinic registration: a clinic asks to join from the public landing page, and Sakalya staff
-- approve (which creates the clinic and invites its owner) or reject it in the console.
--
-- A platform table: no org_id (an application belongs to no clinic yet), row-level security on
-- with no policies and no grants, so the API reaches it only through the definer functions
-- below. It holds the contact's details, never patient data.
set local lock_timeout = '5s';

create table aarogyam.clinic_applications (
  id uuid primary key default app.uuid_v7(),
  clinic_name text not null check (char_length(clinic_name) between 1 and 200),
  city text not null check (char_length(city) between 1 and 100),
  specialty text not null check (specialty in ('dental', 'general')),
  contact_name text not null check (char_length(contact_name) between 1 and 200),
  email text not null check (email = lower(email) and email like '_%@_%' and char_length(email) <= 320),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  message text check (char_length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- How many times the same address applied while this one was pending.
  submissions int not null default 1 check (submissions >= 1),
  decision_reason text check (char_length(decision_reason) <= 500),
  decided_by uuid references aarogyam.users (id),
  decided_at timestamptz,
  created_org_id uuid references aarogyam.organizations (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'approved') = (created_org_id is not null))
);
-- One pending application per address: a second submission updates the first.
create unique index clinic_applications_pending_email on aarogyam.clinic_applications (email)
  where status = 'pending';
create index clinic_applications_status on aarogyam.clinic_applications (status, created_at desc);
create index clinic_applications_decided_by on aarogyam.clinic_applications (decided_by);
create index clinic_applications_created_org on aarogyam.clinic_applications (created_org_id);
comment on table aarogyam.clinic_applications is 'sensitivity=personal offline=server_only lifecycle=mutable';
alter table aarogyam.clinic_applications enable row level security;
create trigger set_row_times before insert or update on aarogyam.clinic_applications
  for each row execute function app.set_row_times();
create trigger audit after insert or update or delete on aarogyam.clinic_applications
  for each row execute function app.audit_row();
insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.clinic_applications', '{submissions}', '{contact_name,email,phone_e164,message}');

-- Records an application from the public form. Returns nothing, so the caller can't learn
-- whether the address applied before or already uses Aarogyam.
create function app.submit_clinic_application(
  p_clinic_name text, p_city text, p_specialty text, p_contact_name text, p_email text,
  p_phone_e164 text, p_message text)
  returns void
  language sql volatile security definer set search_path = ''
  as $$
    insert into aarogyam.clinic_applications as a
      (clinic_name, city, specialty, contact_name, email, phone_e164, message)
    values (p_clinic_name, p_city, p_specialty, p_contact_name, lower(p_email), p_phone_e164, p_message)
    on conflict (email) where status = 'pending' do update
      set clinic_name = excluded.clinic_name, city = excluded.city, specialty = excluded.specialty,
          contact_name = excluded.contact_name, phone_e164 = excluded.phone_e164,
          message = excluded.message, submissions = a.submissions + 1
  $$;

-- Applications for the console, newest first; all of them when p_status is null.
create function app.console_clinic_applications(p_status text)
  returns table (id uuid, clinic_name text, city text, specialty text, contact_name text,
                 email text, phone_e164 text, message text, status text, submissions int,
                 decision_reason text, decided_by_name text, decided_at timestamptz,
                 created_org_id uuid, created_at timestamptz, updated_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select a.id, a.clinic_name, a.city, a.specialty, a.contact_name, a.email, a.phone_e164,
           a.message, a.status, a.submissions, a.decision_reason, u.display_name, a.decided_at,
           a.created_org_id, a.created_at, a.updated_at
    from aarogyam.clinic_applications a
    left join aarogyam.users u on u.id = a.decided_by
    where p_status is null or a.status = p_status
    order by a.created_at desc
    limit 500
  $$;

-- Approves a pending application in one transaction: creates the clinic with its owner's
-- invitation (app.console_create_clinic), queues the invitation email in the new clinic's
-- outbox, and records the decision. Outcome `not_pending` when it was already decided or
-- doesn't exist. A taken subdomain raises a unique violation and changes nothing.
create function app.console_approve_application(
  p_id uuid, p_slug text, p_number_prefix text, p_portal_host text, p_invite_token_hash text,
  p_invite_expires_at timestamptz, p_decided_by uuid, p_message_id uuid, p_message_event text,
  p_message_payload jsonb, p_message_secret text)
  returns table (org_id uuid, invitation_id uuid, outcome text)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_app aarogyam.clinic_applications%rowtype;
    v_org uuid;
    v_invitation uuid;
  begin
    select * into v_app from aarogyam.clinic_applications a where a.id = p_id for update;
    if not found or v_app.status <> 'pending' then
      return query select null::uuid, null::uuid, 'not_pending'::text;
      return;
    end if;
    select c.org_id, c.invitation_id into v_org, v_invitation
      from app.console_create_clinic(p_slug, v_app.clinic_name, p_number_prefix, v_app.specialty,
                                     p_portal_host, v_app.email, p_invite_token_hash,
                                     p_invite_expires_at, p_decided_by) c;
    insert into aarogyam.outbox_events (org_id, id, event_key, channel, recipient, payload, secret)
    values (v_org, p_message_id, p_message_event, 'email', v_app.email,
            p_message_payload || jsonb_build_object('invitation_id', v_invitation), p_message_secret);
    update aarogyam.clinic_applications a
      set status = 'approved', decided_by = p_decided_by, decided_at = now(), created_org_id = v_org
      where a.id = p_id;
    return query select v_org, v_invitation, 'approved'::text;
  end
  $$;

-- Rejects a pending application; false when it was already decided or doesn't exist.
create function app.console_reject_application(p_id uuid, p_reason text, p_decided_by uuid)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  begin
    update aarogyam.clinic_applications a
      set status = 'rejected', decision_reason = p_reason, decided_by = p_decided_by, decided_at = now()
      where a.id = p_id and a.status = 'pending';
    return found;
  end
  $$;

-- One clinic for the console: counts and hosts, never patient records.
create function app.console_clinic(p_org_id uuid)
  returns table (id uuid, slug text, name text, specialty text, status text, timezone text,
                 created_at timestamptz, hosts text[], active_members bigint, patients bigint,
                 pending_invitations bigint)
  language sql stable security definer set search_path = ''
  as $$
    select o.id, o.slug, o.name, o.specialty, o.status, o.timezone, o.created_at,
           array(select d.hostname from aarogyam.org_domains d where d.org_id = o.id
                 order by d.is_primary desc, d.hostname),
           (select count(*) from aarogyam.memberships m where m.org_id = o.id and m.status = 'active'),
           (select count(*) from aarogyam.patients p where p.org_id = o.id and p.deleted_at is null),
           (select count(*) from aarogyam.invitations i
             where i.org_id = o.id and i.accepted_at is null and i.expires_at > now())
    from aarogyam.organizations o
    where o.id = p_org_id
  $$;

-- A clinic's staff for the console: names, roles and status.
create function app.console_clinic_members(p_org_id uuid)
  returns table (membership_id uuid, display_name text, email text, role_key text, role_name text,
                 status text, joined_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select m.id, u.display_name, u.email, r.key, r.name, m.status, m.joined_at
    from aarogyam.memberships m
    join aarogyam.users u on u.id = m.user_id
    join aarogyam.roles r on r.org_id = m.org_id and r.id = m.role_id
    where m.org_id = p_org_id
    order by m.status, u.display_name
  $$;

-- A clinic's invitations not yet accepted or expired, for the console.
create function app.console_clinic_invitations(p_org_id uuid)
  returns table (id uuid, email text, role_key text, role_name text, expires_at timestamptz,
                 created_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select i.id, i.email, r.key, r.name, i.expires_at, i.created_at
    from aarogyam.invitations i
    join aarogyam.roles r on r.org_id = i.org_id and r.id = i.role_id
    where i.org_id = p_org_id and i.accepted_at is null and i.expires_at > now()
    order by i.created_at desc
  $$;

grant execute on function app.submit_clinic_application(text, text, text, text, text, text, text)
  to aarogyam_api;
grant execute on function app.console_clinic_applications(text) to aarogyam_api;
grant execute on function app.console_approve_application(uuid, text, text, text, text, timestamptz, uuid, uuid, text, jsonb, text)
  to aarogyam_api;
grant execute on function app.console_reject_application(uuid, text, uuid) to aarogyam_api;
grant execute on function app.console_clinic(uuid) to aarogyam_api;
grant execute on function app.console_clinic_members(uuid) to aarogyam_api;
grant execute on function app.console_clinic_invitations(uuid) to aarogyam_api;
