import { TriangleAlert } from "lucide-react";

import type { Appointment, PatientOverlap } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";

const HOLDS_NOTHING: readonly Appointment["status"][] = ["cancelled", "no_show", "completed"];

/** One other appointment of the patient at the time asked for, from the day's list or from the server's answer. */
export interface Clash {
  id: string;
  starts_at: string;
  ends_at: string;
  practitioner_name: string;
  room_name?: string | null | undefined;
}

/** The server's `patient_overlaps` as clashes. */
export function clashesFromServer(overlaps: readonly PatientOverlap[] | null | undefined): Clash[] {
  return (overlaps ?? []).map((o) => ({ id: o.appointment_id, starts_at: o.starts_at, ends_at: o.ends_at, practitioner_name: o.practitioner_name, room_name: o.room_name }));
}

/** The patient's other active appointments overlapping `[startsAt, endsAt)`, with any doctor or chair. */
export function patientOverlaps(items: readonly Appointment[], patientId: string, startsAt: string | undefined, endsAt: string | undefined, exceptId?: string): Clash[] {
  if (startsAt === undefined || endsAt === undefined) return [];
  const [from, to] = [Date.parse(startsAt), Date.parse(endsAt)];
  return items
    .filter((a) => a.id !== exceptId && a.patient.id === patientId && !HOLDS_NOTHING.includes(a.status) && Date.parse(a.starts_at) < to && from < Date.parse(a.ends_at))
    .map((a) => ({ id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, practitioner_name: a.practitioner.display_name, room_name: a.room }));
}

/** "Elon already has an appointment 10:00 am–10:30 am with Dr Dev (Chair 2)." */
export function clashSentence(c: Clash, patientName: string, timeZone: string): string {
  const first = patientName.trim().split(/\s+/)[0] ?? patientName;
  return `${first} already has an appointment ${formatTime(c.starts_at, timeZone)}–${formatTime(c.ends_at, timeZone)} with ${c.practitioner_name}${c.room_name == null ? "" : ` (${c.room_name})`}.`;
}

/**
 * A warning the user can override: the patient is already booked then. The caller's primary button
 * says what proceeding means ("Book anyway", "Move anyway").
 */
export function PatientOverlapNotice({ overlaps, patientName, timeZone, action }: { overlaps: readonly Clash[]; patientName: string; timeZone: string; action: string }) {
  if (overlaps.length === 0) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>
        {overlaps.map((c) => (
          <p key={c.id}>{clashSentence(c, patientName, timeZone)}</p>
        ))}
        <p>{action}?</p>
      </div>
    </div>
  );
}
