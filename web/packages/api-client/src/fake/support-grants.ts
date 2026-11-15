/** The fake API's support grants: read access a clinic owner gives one Sakalya staff member, and what they did under it. */

import type * as C from "../contract.js";

export interface FakeSupportGrant {
  id: string;
  clinic_id: string;
  staff_user_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  granted_by: string;
  revoked_at?: string;
  revoked_by?: string;
}

/** One request under a grant; tests seed these, since the fake has no staff-side routes. */
export interface FakeSupportAction {
  grant_id: string;
  at: string;
  method: string;
  route: string;
}

/** 15 minutes to 7 days, as the API allows. */
export const MIN_GRANT_MS = 15 * 60_000;
export const MAX_GRANT_MS = 7 * 86_400_000;

export const grantStatus = (g: FakeSupportGrant, now: Date): C.SupportGrantStatus =>
  g.revoked_at !== undefined ? "revoked" : new Date(g.ends_at) <= now ? "ended" : "active";

export function wireGrant(g: FakeSupportGrant, now: Date, who: { email: string; name: string } | undefined, actions: readonly FakeSupportAction[], grantedBy: string | null, revokedBy: string | null): C.SupportGrantView {
  const mine = actions.filter((a) => a.grant_id === g.id).sort((a, b) => b.at.localeCompare(a.at));
  return {
    id: g.id,
    access: "read",
    reason: g.reason,
    starts_at: g.starts_at,
    ends_at: g.ends_at,
    status: grantStatus(g, now),
    actions: mine.length,
    granted_by: grantedBy,
    last_action_at: mine[0]?.at ?? null,
    revoked_at: g.revoked_at ?? null,
    revoked_by: revokedBy,
    staff_email: who?.email ?? null,
    staff_name: who?.name ?? null,
  };
}
