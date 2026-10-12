/**
 * Staff time off in the fake backend, and the clinic's staff-operations settings: the rules the
 * API applies (who sees what, how a window is read, who is free to take an appointment), so the
 * apps can be built and tested against it. Notifications are not modelled here.
 */

import type * as C from "../contract.js";
import type { FakeClinic, FakeLeave, Fixtures } from "./fixtures.js";
import { atLocalTime, localClock } from "./zoned-time.js";

/** The generic reason on the leave block an approval makes: the request's own reason never goes there. */
export const LEAVE_BLOCK_REASON = "Time off";

export interface FakeTimeOff {
  id: string;
  clinic_id: string;
  membership_id: string;
  kind: C.TimeOffKind;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  status: "pending" | "approved" | "declined" | "cancelled";
  reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  leave_block_id: string | null;
}

export interface FakeStaffOps {
  clinic_id: string;
  requires_approval: boolean;
  remind_every_minutes: number;
}

export const TIME_OFF_KINDS: readonly C.TimeOffKind[] = ["vacation", "sick", "personal", "other"];

export const timeOffOf = (state: Fixtures): FakeTimeOff[] => (state.timeOff ??= []);

/** The clinic's settings, with the API's defaults for what was never set. */
export function staffOpsOf(state: Fixtures, clinic: FakeClinic): FakeStaffOps {
  const all = (state.staffOps ??= []);
  let found = all.find((s) => s.clinic_id === clinic.id);
  if (found === undefined) {
    found = { clinic_id: clinic.id, requires_approval: true, remind_every_minutes: 60 };
    all.push(found);
  }
  return found;
}

export const wireStaffOps = (s: FakeStaffOps): C.StaffOpsSettingsBody => ({
  time_off: { requires_approval: s.requires_approval },
  tasks: { remind_every_minutes: s.remind_every_minutes },
});

const DAYS_MS = 86_400_000;
const MAX_DAYS = 366;
const MAX_ALL_DAY_DAYS = 365;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The window a request covers, as instants; a string names the field and the problem. */
export function windowOf(
  clinic: FakeClinic,
  input: C.NewTimeOff,
): { starts_at: string; ends_at: string; all_day: boolean } | { field: string; problem: string } {
  const timed = input.starts_at != null || input.ends_at != null;
  const whole = input.first_day != null || input.last_day != null;
  if (timed === whole || (timed && (input.starts_at == null || input.ends_at == null)) || (whole && (input.first_day == null || input.last_day == null))) {
    return { field: "starts_at", problem: "give starts_at and ends_at, or first_day and last_day" };
  }
  if (timed) {
    const start = Date.parse(input.starts_at ?? "");
    const end = Date.parse(input.ends_at ?? "");
    if (Number.isNaN(start)) return { field: "starts_at", problem: "must be an RFC 3339 time such as 2026-10-05T10:00:00+05:30" };
    if (Number.isNaN(end)) return { field: "ends_at", problem: "must be an RFC 3339 time such as 2026-10-05T10:00:00+05:30" };
    if (start >= end) return { field: "starts_at", problem: "must be before the end" };
    if (end - start > MAX_DAYS * DAYS_MS) return { field: "starts_at", problem: "can be at most 366 days (365 for whole days)" };
    return { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), all_day: false };
  }
  const first = input.first_day ?? "";
  const last = input.last_day ?? "";
  if (!DAY.test(first) || Number.isNaN(Date.parse(first))) return { field: "first_day", problem: "must be YYYY-MM-DD" };
  if (!DAY.test(last) || Number.isNaN(Date.parse(last))) return { field: "last_day", problem: "must be YYYY-MM-DD" };
  if (first > last) return { field: "starts_at", problem: "must be before the end" };
  if ((Date.parse(last) - Date.parse(first)) / DAYS_MS + 1 > MAX_ALL_DAY_DAYS) {
    return { field: "starts_at", problem: "can be at most 366 days (365 for whole days)" };
  }
  return {
    starts_at: atLocalTime(first, 0, clinic.timezone).toISOString(),
    ends_at: atLocalTime(last, 1440, clinic.timezone).toISOString(),
    all_day: true,
  };
}

/** The reason or note, trimmed; `null` when blank; a string when it is too long. */
export function cleanText(text: string | null | undefined): string | null | { tooLong: true } {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return null;
  return Array.from(trimmed).length > 200 ? { tooLong: true } : trimmed;
}

/** Whether the viewer sees the private parts: the person away, and holders of `time_off.manage`. */
export const seesPrivate = (row: FakeTimeOff, viewer: { membershipId: string; manages: boolean }): boolean =>
  viewer.manages || row.membership_id === viewer.membershipId;

/** A request as the API sends it to this viewer. */
export function wireTimeOff(row: FakeTimeOff, state: Fixtures, viewer: { membershipId: string; manages: boolean }): C.TimeOff {
  const member = state.memberships.find((m) => m.id === row.membership_id);
  const user = state.users.find((u) => u.id === member?.user_id);
  const open = seesPrivate(row, viewer);
  return {
    id: row.id,
    membership_id: row.membership_id,
    member_name: user?.display_name ?? null,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    all_day: row.all_day,
    status: row.status,
    kind: open ? row.kind : null,
    reason: open ? row.reason : null,
    decided_by: open ? row.decided_by : null,
    decided_at: open ? row.decided_at : null,
    decision_note: open ? row.decision_note : null,
  };
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);

/** Requests overlapping `[from, to)` that the viewer may see, by start: approved ones for everyone, open ones only for the person and the owner. */
export function visibleTimeOff(state: Fixtures, clinic: FakeClinic, viewer: { membershipId: string; manages: boolean }, from: string, to: string): FakeTimeOff[] {
  return timeOffOf(state)
    .filter((r) => r.clinic_id === clinic.id && overlaps(r.starts_at, r.ends_at, from, to))
    .filter((r) => r.status === "approved" || (r.status !== "cancelled" && seesPrivate(r, viewer)))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
}

/** Approves a pending request: for someone with a doctor row it also makes the leave block. */
export function approveRow(state: Fixtures, row: FakeTimeOff, by: string, note: string | null, now: Date, newId: () => string): void {
  row.status = "approved";
  row.decided_by = by;
  row.decided_at = now.toISOString();
  row.decision_note = note;
  const doctor = state.practitioners.find((p) => p.clinic_id === row.clinic_id && p.membership_id === row.membership_id && p.active);
  if (doctor !== undefined) {
    const block: FakeLeave = {
      id: newId(),
      clinic_id: row.clinic_id,
      practitioner_id: doctor.id,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      reason: LEAVE_BLOCK_REASON,
    };
    state.leave.push(block);
    row.leave_block_id = block.id;
  }
}

/** Cancels a pending or approved request and removes its leave block. */
export function cancelRow(state: Fixtures, row: FakeTimeOff): void {
  row.status = "cancelled";
  if (row.leave_block_id !== null) {
    const gone = row.leave_block_id;
    state.leave = state.leave.filter((l) => l.id !== gone);
    row.leave_block_id = null;
  }
}

/** Whether the doctor has approved leave (any leave block) overlapping the window. */
export const onLeave = (state: Fixtures, clinicId: string, practitionerId: string, startsAt: string, endsAt: string): boolean =>
  state.leave.some((l) => l.clinic_id === clinicId && l.practitioner_id === practitionerId && overlaps(l.starts_at, l.ends_at, startsAt, endsAt));

const FINISHED = new Set(["completed", "cancelled", "no_show"]);
const MAX_AFFECTED = 200;
const MAX_SUGGESTIONS = 5;

const toMinutes = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(":").map((part) => Number.parseInt(part, 10));
  return h * 60 + m;
};

const isoWeekday = (date: string): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

/** The unfinished appointments of the person away in the window, each with the doctors free then. */
export function affectedAppointments(state: Fixtures, clinic: FakeClinic, row: FakeTimeOff): C.AffectedAppointment[] {
  const mine = new Set(state.practitioners.filter((p) => p.clinic_id === clinic.id && p.membership_id === row.membership_id).map((p) => p.id));
  const others = state.practitioners.filter((p) => p.clinic_id === clinic.id && p.active && p.membership_id !== row.membership_id).sort((a, b) => a.display_name.localeCompare(b.display_name));
  return state.appointments
    .filter((a) => a.clinic_id === clinic.id && mine.has(a.practitioner_id) && !FINISHED.has(a.status) && overlaps(a.starts_at, a.ends_at, row.starts_at, row.ends_at))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
    .slice(0, MAX_AFFECTED)
    .map((a) => {
      const start = localClock(new Date(a.starts_at), clinic.timezone);
      const end = localClock(new Date(a.ends_at), clinic.timezone);
      const suggestions: C.FreeDoctorSuggestion[] = [];
      for (const doctor of others) {
        const shifts = state.workingShifts.filter((s) => s.clinic_id === clinic.id && s.practitioner_id === doctor.id);
        const sameDay = start.date === end.date;
        const covered = shifts.some((s) => s.weekday === isoWeekday(start.date) && toMinutes(s.starts) <= start.minutes && end.minutes <= toMinutes(s.ends));
        if (shifts.length > 0 && !(sameDay && covered)) continue;
        if (onLeave(state, clinic.id, doctor.id, a.starts_at, a.ends_at)) continue;
        const busy = state.appointments.some(
          (b) => b.id !== a.id && b.clinic_id === clinic.id && b.practitioner_id === doctor.id && b.status !== "cancelled" && b.status !== "no_show" && overlaps(b.starts_at, b.ends_at, a.starts_at, a.ends_at),
        );
        if (busy) continue;
        suggestions.push({ practitioner_id: doctor.id, display_name: doctor.display_name, calendar_color: doctor.calendar_color, in_hours: shifts.length > 0 });
      }
      suggestions.sort((x, y) => Number(y.in_hours) - Number(x.in_hours));
      const patient = state.patients.find((p) => p.id === a.patient_id);
      return {
        id: a.id,
        practitioner_id: a.practitioner_id,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
        status: a.status,
        patient_name: patient?.full_name ?? "",
        row_version: 1,
        suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
      };
    });
}
