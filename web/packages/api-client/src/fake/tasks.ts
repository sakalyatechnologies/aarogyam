/**
 * Recurring staff tasks for the fake backend: the clinic's tasks, the occurrences made from them
 * (a small stand-in for the server's generator), and the rules of finishing one. Roles are
 * identified by their key here, as everywhere in the fake.
 */

import type * as C from "../contract.js";
import { atLocalTime, localClock } from "./zoned-time.js";

export type FakeTaskAction = "none" | "record_usage" | "confirm_photos";

export interface FakeTaskSchedule {
  kind: "once" | "daily" | "every_n_days" | "weekdays";
  once_at: string | null;
  interval_days: number | null;
  /** 1 (Monday) to 7 (Sunday). */
  weekdays: number[] | null;
  due_time: string | null;
  starts_on: string | null;
  ends_on: string | null;
}

export interface FakeTaskTemplate {
  id: string;
  clinic_id: string;
  title: string;
  description: string | null;
  assignee_membership_id: string | null;
  assignee_role_id: string | null;
  schedule: FakeTaskSchedule;
  remind_every_minutes: number | null;
  escalate_after: number;
  action: FakeTaskAction;
  active: boolean;
  /** When it last started to count: nothing is made for a time before it. */
  activated_at: string;
  is_default: boolean;
  default_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface FakeTaskOccurrence {
  id: string;
  clinic_id: string;
  template_id: string;
  title: string;
  action: FakeTaskAction;
  assignee_membership_id: string | null;
  assignee_role_id: string | null;
  local_date: string;
  due_at: string;
  status: "open" | "done" | "skipped" | "missed";
  completed_at: string | null;
  completed_by: string | null;
  note: string | null;
}

export interface FakeTasks {
  templates: FakeTaskTemplate[];
  occurrences: FakeTaskOccurrence[];
}

export const emptyTasks = (): FakeTasks => ({ templates: [], occurrences: [] });

export const NOTE_MAX = 300;
export const USAGE_REASON = "end-of-day usage";

const DEFAULTS: readonly { key: string; title: string; time: string; role: string; action: FakeTaskAction }[] = [
  { key: "sterilise_instruments", title: "Sterilise instruments", time: "08:30", role: "assistant", action: "none" },
  { key: "eod_check_photos", title: "Check today's patients have their photos", time: "19:30", role: "front_desk", action: "confirm_photos" },
  { key: "eod_record_materials", title: "Record materials used today", time: "19:45", role: "front_desk", action: "record_usage" },
];

/** Adds the standard tasks a clinic is missing; one switched off stays as it is. */
export function seedDefaults(tasks: FakeTasks, clinicId: string, now: Date, newId: () => string): void {
  for (const d of DEFAULTS) {
    if (tasks.templates.some((t) => t.clinic_id === clinicId && t.default_key === d.key)) continue;
    const at = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    tasks.templates.push({
      id: newId(),
      clinic_id: clinicId,
      title: d.title,
      description: null,
      assignee_membership_id: null,
      assignee_role_id: d.role,
      schedule: { kind: "daily", once_at: null, interval_days: null, weekdays: null, due_time: d.time, starts_on: at.slice(0, 10), ends_on: null },
      remind_every_minutes: null,
      escalate_after: 3,
      action: d.action,
      active: true,
      activated_at: at,
      is_default: true,
      default_key: d.key,
      created_at: at,
      updated_at: at,
    });
  }
}

const dayNumber = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/** Whether the schedule falls on this clinic day (the time of day aside). */
function fallsOn(schedule: FakeTaskSchedule, date: string): boolean {
  if (schedule.kind === "once") return false;
  if (schedule.starts_on !== null && date < schedule.starts_on) return false;
  if (schedule.ends_on !== null && date > schedule.ends_on) return false;
  if (schedule.kind === "daily") return true;
  if (schedule.kind === "every_n_days") {
    const gap = dayNumber(date) - dayNumber(schedule.starts_on ?? date);
    return gap % (schedule.interval_days ?? 1) === 0;
  }
  const isoDay = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return (schedule.weekdays ?? []).includes(isoDay);
}

const minutesOf = (time: string | null): number => {
  const [h = 0, m = 0] = (time ?? "00:00").split(":").map((p) => Number.parseInt(p, 10));
  return h * 60 + m;
};

/** The times the task falls due after `after` and up to `to`, as the server's `app.task_due_dates` gives them. */
export function dueDates(template: FakeTaskTemplate, timeZone: string, after: Date, to: Date): { local_date: string; due_at: string }[] {
  const s = template.schedule;
  if (s.kind === "once") {
    const at = s.once_at === null ? null : new Date(s.once_at);
    return at !== null && at > after && at <= to ? [{ local_date: localClock(at, timeZone).date, due_at: at.toISOString() }] : [];
  }
  const found: { local_date: string; due_at: string }[] = [];
  const first = dayNumber(localClock(after, timeZone).date) - 1;
  const last = dayNumber(localClock(to, timeZone).date) + 1;
  for (let day = first; day <= last; day += 1) {
    const date = new Date(day * 86_400_000).toISOString().slice(0, 10);
    if (!fallsOn(s, date)) continue;
    const due = atLocalTime(date, minutesOf(s.due_time), timeZone);
    if (due > after && due <= to) found.push({ local_date: date, due_at: due.toISOString() });
  }
  return found;
}

/** The generator: makes the occurrences that fell due in the last 24 hours, once each. */
export function materialize(tasks: FakeTasks, clinicId: string, timeZone: string, now: Date, newId: () => string): void {
  const since = new Date(now.getTime() - 86_400_000);
  for (const t of tasks.templates) {
    if (t.clinic_id !== clinicId || !t.active) continue;
    for (const slot of dueDates(t, timeZone, since, now)) {
      if (new Date(slot.due_at) < new Date(t.activated_at)) continue;
      if (tasks.occurrences.some((o) => o.template_id === t.id && o.local_date === slot.local_date)) continue;
      tasks.occurrences.push({
        id: newId(),
        clinic_id: clinicId,
        template_id: t.id,
        title: t.title,
        action: t.action,
        assignee_membership_id: t.assignee_membership_id,
        assignee_role_id: t.assignee_role_id,
        local_date: slot.local_date,
        due_at: slot.due_at,
        status: "open",
        completed_at: null,
        completed_by: null,
        note: null,
      });
      if (t.schedule.kind === "once") t.active = false;
    }
  }
}

/** Whether an occurrence is for this member: given to them, or to the role they hold. */
export const isForMember = (o: { assignee_membership_id: string | null; assignee_role_id: string | null }, membershipId: string, roleKey: string): boolean =>
  o.assignee_membership_id === membershipId || (o.assignee_role_id !== null && o.assignee_role_id === roleKey);

export function wireOccurrence(o: FakeTaskOccurrence, nameOf: (membershipId: string) => string | null, withoutPhotos?: number): C.TaskOccurrence {
  return {
    id: o.id,
    template_id: o.template_id,
    title: o.title,
    action: o.action,
    assignee_membership_id: o.assignee_membership_id,
    assignee_role_id: o.assignee_role_id,
    local_date: o.local_date,
    due_at: o.due_at,
    status: o.status,
    completed_at: o.completed_at,
    completed_by: o.completed_by,
    completed_by_name: o.completed_by === null ? null : nameOf(o.completed_by),
    note: o.note,
    ...(withoutPhotos === undefined ? {} : { patients_without_photos_today: withoutPhotos }),
  };
}

export function wireTemplate(t: FakeTaskTemplate, memberName: (membershipId: string) => string | null, roleName: (key: string) => string | null): C.Task {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    assignee_membership_id: t.assignee_membership_id,
    assignee_name: t.assignee_membership_id === null ? null : memberName(t.assignee_membership_id),
    assignee_role_id: t.assignee_role_id,
    assignee_role_name: t.assignee_role_id === null ? null : roleName(t.assignee_role_id),
    schedule: { ...t.schedule },
    remind_every_minutes: t.remind_every_minutes,
    escalate_after: t.escalate_after,
    action: t.action,
    active: t.active,
    is_default: t.is_default,
    default_key: t.default_key,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}
