/**
 * The test inbox: messages the stack queued in its outbox. Locally nothing sends email (no
 * Resend key), so a message stays queued with its link secret (staff mail in `outbox_events`,
 * patient mail in `messages`); the inbox rebuilds the
 * links the email templates would carry (`crates/aarogyam-notify/src/templates.rs`).
 */
import type { Inbox, InboxMessage } from "@sakalya/e2e";

import { ownerQuery } from "./db.ts";
import { portalUrl } from "./stack.ts";
import type { Clinic } from "./tenant.ts";

const READ = String.raw`
select coalesce(json_agg(m order by m.at), '[]'::json) from (
  select id, event_key as kind, recipient as "to", payload, secret, created_at as at
  from aarogyam.outbox_events
  where recipient = lower(:'to')
    and (:'org' = '' or org_id::text = :'org')
    and (:'kind' = '' or event_key = :'kind')
    and created_at >= coalesce(nullif(:'since', '')::timestamptz, '-infinity')
  union all
  select m.id, m.kind, lower(p.email) as "to", m.variables as payload, m.secret, m.created_at as at
  from aarogyam.messages m
  join aarogyam.patients p on p.org_id = m.org_id and p.id = m.patient_id
  where lower(p.email) = lower(:'to')
    and (:'org' = '' or m.org_id::text = :'org')
    and (:'kind' = '' or m.kind = :'kind')
    and m.created_at >= coalesce(nullif(:'since', '')::timestamptz, '-infinity')
) m;
`;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function links(kind: string, payload: unknown, secret: unknown): string[] {
  const host = field(payload, "portal_host");
  if (typeof host !== "string") {
    return [];
  }
  const origin = portalUrl(host);
  if (kind === "staff.invited" && typeof secret === "string") {
    return [`${origin}/invite#${secret}`];
  }
  if (kind === "prescription.shared" && typeof secret === "string") {
    return [`${origin}/shared/${secret}`];
  }
  if (kind === "booking.declined") {
    return [`${origin}/book`];
  }
  return [];
}

export const outboxInbox: Inbox<Clinic> = {
  async messages(query, clinic) {
    const rows = await ownerQuery(READ, {
      to: query.to,
      org: clinic?.id ?? "",
      kind: query.kind ?? "",
      since: query.since?.toISOString() ?? "",
    });
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows.flatMap((row: unknown): InboxMessage[] => {
      const id = field(row, "id");
      const kind = field(row, "kind");
      const to = field(row, "to");
      const at = field(row, "at");
      if (typeof id !== "string" || typeof kind !== "string" || typeof to !== "string" || typeof at !== "string") {
        return [];
      }
      const payload = field(row, "payload");
      return [{ id, kind, to, links: links(kind, payload, field(row, "secret")), sentAt: new Date(at), text: JSON.stringify(payload) }];
    });
  },
};
