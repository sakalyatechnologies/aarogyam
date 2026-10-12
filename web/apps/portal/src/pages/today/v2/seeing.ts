import type { Today } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";

export type Appointment = Today["appointments"][number];

/** The day's people in the order they will be seen: in the chair, waiting by arrival, then booked by time. */
export function seeingOrder(today: Today): Appointment[] {
  const live = today.appointments.filter((a) => a.status !== "cancelled");
  const inChair = live.filter((a) => a.status === "in_chair");
  const waiting = live.filter((a) => a.status === "arrived").sort((a, b) => (a.arrived_at ?? "").localeCompare(b.arrived_at ?? ""));
  const upcoming = live.filter((a) => a.status === "requested" || a.status === "booked" || a.status === "confirmed").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return [...inChair, ...waiting, ...upcoming];
}

export const KIND_LABEL: Readonly<Record<Appointment["kind"], string>> = { new: "New", follow_up: "Follow-up", procedure: "Procedure", emergency: "Emergency" };

/** The clinic's time zone, which every time on the board is shown in. */
export function useZone(): string {
  return useClinic().session.clinic.timezone;
}

/** The first word of a name, for tight places: `Kavya Reddy` is `Kavya`. */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
