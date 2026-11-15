import type { StaffSupportGrant } from "@aarogyam/api-client";

const MINUTE = 60_000;
const STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 24 * 60 * MINUTE],
  ["hour", 60 * MINUTE],
  ["minute", MINUTE],
];

/** A grant still lets the staff member in: the server says active and its end hasn't passed. */
export function isActiveGrant(grant: StaffSupportGrant, now: Date): boolean {
  return grant.status === "active" && Date.parse(grant.ends_at) > now.getTime();
}

/** Active grants first (soonest end first), then past ones (latest end first). */
export function splitGrants(items: readonly StaffSupportGrant[], now: Date): { active: StaffSupportGrant[]; past: StaffSupportGrant[] } {
  const active = items.filter((g) => isActiveGrant(g, now)).sort((a, b) => a.ends_at.localeCompare(b.ends_at));
  const past = items.filter((g) => !isActiveGrant(g, now)).sort((a, b) => b.ends_at.localeCompare(a.ends_at));
  return { active, past };
}

/** "in 3 hours", "in 12 minutes" or "in under a minute"; rounds down so it never promises more time. */
export function endsIn(endsAt: string, now: Date): string {
  const left = Date.parse(endsAt) - now.getTime();
  const format = new Intl.RelativeTimeFormat("en-IN", { numeric: "always", style: "long" });
  for (const [unit, size] of STEPS) {
    if (left >= size) {
      return format.format(Math.floor(left / size), unit);
    }
  }
  return "in under a minute";
}

/** Why a past grant is no longer open. */
export function pastLabel(grant: StaffSupportGrant): string {
  return grant.status === "revoked" ? "Revoked" : grant.status === "active" ? "Expired" : "Ended";
}

/** The absolute time in the viewer's own locale and time zone. */
export function localDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
