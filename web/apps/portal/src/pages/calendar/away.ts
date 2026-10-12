import type { Practitioner, TimeOff } from "@aarogyam/api-client";

import { addDays, localInstant } from "../../lib/time.js";

/** A person's approved time off on one clinic day, in minutes after local midnight. Never carries the kind or reason. */
export interface AwayBand {
  id: string;
  /** `Away · Dr Shah`: the only words other people see. */
  label: string;
  /** The person's name, empty when unknown. */
  name: string;
  /** The practitioner row of the person, when they are a doctor. */
  practitionerId?: string;
  membershipId: string;
  startMin: number;
  endMin: number;
}

const MIN = 60_000;

/** Approved time off that touches the clinic day `date`, clipped to it. */
export function awayOn(timeOff: readonly TimeOff[], practitioners: readonly Pick<Practitioner, "id" | "display_name" | "membership_id">[], date: string, timeZone: string): AwayBand[] {
  const dayStart = Date.parse(localInstant(date, "00:00", timeZone));
  const dayEnd = Date.parse(localInstant(addDays(date, 1), "00:00", timeZone));
  const bands: AwayBand[] = [];
  for (const t of timeOff) {
    if (t.status !== "approved") continue;
    const start = Math.max(Date.parse(t.starts_at), dayStart);
    const end = Math.min(Date.parse(t.ends_at), dayEnd);
    if (!(start < end)) continue;
    const doctor = practitioners.find((p) => p.membership_id === t.membership_id);
    const name = t.member_name ?? doctor?.display_name ?? "";
    bands.push({
      id: `${t.id}:${date}`,
      label: name === "" ? "Away" : `Away · ${name}`,
      name,
      ...(doctor === undefined ? {} : { practitionerId: doctor.id }),
      membershipId: t.membership_id,
      startMin: Math.round((start - dayStart) / MIN),
      endMin: Math.round((end - dayStart) / MIN),
    });
  }
  return bands;
}

/** Whether the doctor has approved time off overlapping `[startsAt, endsAt)`. */
export function isAway(timeOff: readonly TimeOff[], doctor: Pick<Practitioner, "membership_id"> | undefined, startsAt: string, endsAt: string): boolean {
  const membership = doctor?.membership_id;
  if (membership == null) return false;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return timeOff.some((t) => t.status === "approved" && t.membership_id === membership && Date.parse(t.starts_at) < end && start < Date.parse(t.ends_at));
}
