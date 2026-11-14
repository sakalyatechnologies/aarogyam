-- Lets the console see whether a clinic's owner invitation email went out. Read-only: the latest
-- owner-invitation email's outcome, without the recipient, the payload, the secret or any body.
set local lock_timeout = '5s';

-- Outcome of the latest `staff.invited` email for the clinic's owner invitation (the same
-- invitation `app.console_resend_owner_invitation` re-issues): `pending`, `sent` or `failed`,
-- how many attempts were made, the short failure reason (at most 200 characters, set by the
-- sender and never an email body) and when it was queued and sent. No row when nothing was queued.
create function app.console_owner_invite_delivery(p_org_id uuid)
  returns table (invitation_id uuid, status text, provider text, attempts int, last_error text,
                 queued_at timestamptz, sent_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
    select i.id, o.status, o.provider, o.attempts, left(o.last_error, 200), o.created_at,
           case when o.status = 'sent' then o.processed_at end
    from (select x.id from aarogyam.invitations x
            join aarogyam.roles r on r.org_id = x.org_id and r.id = x.role_id
            where x.org_id = p_org_id and r.key = 'owner' and x.email is not null
            order by x.created_at, x.id
            limit 1) i
    join aarogyam.outbox_events o
      on o.org_id = p_org_id and o.event_key = 'staff.invited' and o.channel = 'email'
         and o.payload ->> 'invitation_id' = i.id::text
    order by o.created_at desc, o.id desc
    limit 1
  $$;

grant execute on function app.console_owner_invite_delivery(uuid) to aarogyam_api;
