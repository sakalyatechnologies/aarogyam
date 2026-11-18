/**
 * The fake's recurring expenses: rules that record an expense every month or week, checked
 * like the server (migration 0727). The server records them in its background job; the fake
 * records what fell due whenever expenses or rules are listed.
 */

import type * as C from "../contract.js";
import { EXPENSE_NAMES, type FakeExpense } from "./analytics.js";

export interface FakeRecurring {
  id: string;
  clinic_id: string;
  category: C.ExpenseCategory;
  amount_paise: number;
  method: string | null;
  note: string | null;
  cadence: C.RecurringCadence;
  day_of_month: number | null;
  weekday: number | null;
  starts_on: string;
  ends_on: string | null;
  next_due_on: string;
  paused_at: string | null;
  stopped_at: string | null;
  recorded_by: string;
  created_at: string;
}

const METHODS = ["cash", "upi", "card", "bank"];
/** Checked at run time too: a caller outside TypeScript can send anything. */
const CADENCES: readonly string[] = ["monthly", "weekly"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** At most this many due days a rule records in one go, as on the server. */
const CATCH_UP = 12;

const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => toDay(new Date(parseDay(s).getTime() + n * DAY_MS));

/** The first due day after `after`: a short month uses its last day; weekday 1 is Monday. */
export function dueAfter(cadence: C.RecurringCadence, dayOfMonth: number | null, weekday: number | null, after: string): string {
  const d = parseDay(after);
  if (cadence === "weekly") {
    const isoDow = ((d.getUTCDay() + 6) % 7) + 1;
    return addDays(after, (((weekday ?? 1) - isoDow + 6) % 7) + 1);
  }
  const inMonth = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return toDay(new Date(Date.UTC(year, month, Math.min(dayOfMonth ?? 1, last))));
  };
  const thisMonth = inMonth(d.getUTCFullYear(), d.getUTCMonth());
  return thisMonth > after ? thisMonth : inMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

export function statusOf(r: FakeRecurring): C.RecurringExpenseStatus {
  if (r.stopped_at !== null) {
    return "stopped";
  }
  if (r.paused_at !== null) {
    return "paused";
  }
  return r.ends_on !== null && r.next_due_on > r.ends_on ? "ended" : "active";
}

export const wireRecurring = (r: FakeRecurring): C.RecurringExpense => ({
  id: r.id,
  category: r.category,
  category_name: EXPENSE_NAMES[r.category],
  amount_paise: r.amount_paise,
  ...(r.method === null ? {} : { method: r.method }),
  note: r.note,
  cadence: r.cadence,
  ...(r.day_of_month === null ? {} : { day_of_month: r.day_of_month }),
  ...(r.weekday === null ? {} : { weekday: r.weekday }),
  starts_on: r.starts_on,
  ends_on: r.ends_on,
  next_due_on: r.next_due_on,
  status: statusOf(r),
  recorded_by: r.recorded_by,
  created_at: r.created_at,
});

/** A refused field: `[field, message]`. */
export type Refusal = readonly [string, string];

const checkAmount = (amount: number): Refusal | null =>
  Number.isInteger(amount) && amount > 0 && amount <= 1_000_000_000 ? null : ["amount_paise", "must be more than zero and at most 1,00,00,000 rupees"];

function checkNote(note: string | null | undefined): Refusal | string | null {
  const text = note?.trim() ?? "";
  if (text.length > 300) {
    return ["note", "must be at most 300 characters"];
  }
  return text === "" ? null : text;
}

const checkMethod = (method: string | null | undefined): Refusal | null =>
  method == null || METHODS.includes(method) ? null : ["method", "must be cash, upi, card or bank"];

function checkDay(cadence: C.RecurringCadence, dayOfMonth: number | null | undefined, weekday: number | null | undefined): Refusal | null {
  if (cadence === "monthly") {
    const ok = Number.isInteger(dayOfMonth) && (dayOfMonth ?? 0) >= 1 && (dayOfMonth ?? 0) <= 31 && weekday == null;
    return ok ? null : ["day_of_month", "a monthly expense needs a day of the month from 1 to 31"];
  }
  const ok = Number.isInteger(weekday) && (weekday ?? 0) >= 1 && (weekday ?? 0) <= 7 && dayOfMonth == null;
  return ok ? null : ["weekday", "a weekly expense needs a weekday from 1 (Monday) to 7 (Sunday)"];
}

export const isRefusal = (value: unknown): value is Refusal => Array.isArray(value);

/** A new rule from the request, or why it was refused; the start may be 90 days back or a year ahead. */
export function newRecurring(
  input: C.NewRecurringExpense,
  ctx: { id: string; clinicId: string; recordedBy: string; now: string; today: string },
): FakeRecurring | Refusal {
  if (!(input.category in EXPENSE_NAMES)) {
    return ["category", "unknown category"];
  }
  if (!CADENCES.includes(input.cadence)) {
    return ["cadence", "must be monthly or weekly"];
  }
  const note = checkNote(input.note);
  const refused = checkAmount(input.amount_paise) ?? checkMethod(input.method) ?? (isRefusal(note) ? note : null) ?? checkDay(input.cadence, input.day_of_month, input.weekday);
  if (refused !== null) {
    return refused;
  }
  if (!DAY_RE.test(input.starts_on) || input.starts_on < addDays(ctx.today, -90) || input.starts_on > addDays(ctx.today, 366)) {
    return ["starts_on", "must be within 90 days before today and a year after"];
  }
  const dayOfMonth = input.cadence === "monthly" ? (input.day_of_month ?? null) : null;
  const weekday = input.cadence === "weekly" ? (input.weekday ?? null) : null;
  return {
    id: ctx.id,
    clinic_id: ctx.clinicId,
    category: input.category,
    amount_paise: input.amount_paise,
    method: input.method ?? null,
    note: isRefusal(note) ? null : note,
    cadence: input.cadence,
    day_of_month: dayOfMonth,
    weekday,
    starts_on: input.starts_on,
    ends_on: null,
    next_due_on: dueAfter(input.cadence, dayOfMonth, weekday, addDays(input.starts_on, -1)),
    paused_at: null,
    stopped_at: null,
    recorded_by: ctx.recordedBy,
    created_at: ctx.now,
  };
}

/** Applies a change to a rule in place, or returns why it was refused; a new day moves the next due day. */
export function changeRecurring(rule: FakeRecurring, changes: C.RecurringExpenseChange, today: string): Refusal | null {
  const note = changes.note === undefined ? undefined : checkNote(changes.note);
  const refused =
    (changes.amount_paise == null ? null : checkAmount(changes.amount_paise)) ??
    (changes.method === undefined ? null : checkMethod(changes.method)) ??
    (isRefusal(note) ? note : null);
  if (refused !== null) {
    return refused;
  }
  const dayChanged = changes.day_of_month != null || changes.weekday != null;
  const dayOfMonth = changes.day_of_month ?? rule.day_of_month;
  const weekday = changes.weekday ?? rule.weekday;
  if (dayChanged) {
    const bad = checkDay(rule.cadence, dayOfMonth, weekday);
    if (bad !== null) {
      return bad;
    }
  }
  if (changes.ends_on != null && (!DAY_RE.test(changes.ends_on) || changes.ends_on < rule.starts_on)) {
    return ["ends_on", "must not be before starts_on"];
  }
  if (changes.amount_paise != null) {
    rule.amount_paise = changes.amount_paise;
  }
  if (changes.method !== undefined) {
    rule.method = changes.method;
  }
  if (note !== undefined && !isRefusal(note)) {
    rule.note = note;
  }
  if (changes.ends_on !== undefined) {
    rule.ends_on = changes.ends_on;
  }
  if (dayChanged) {
    rule.day_of_month = dayOfMonth;
    rule.weekday = weekday;
    const from = today > rule.starts_on ? today : rule.starts_on;
    rule.next_due_on = dueAfter(rule.cadence, dayOfMonth, weekday, addDays(from, -1));
  }
  return null;
}

/** Resumes a paused rule from its next due day on or after today; paused days are skipped. */
export function resumeRecurring(rule: FakeRecurring, today: string): void {
  rule.paused_at = null;
  const from = today > rule.next_due_on ? today : rule.next_due_on;
  rule.next_due_on = dueAfter(rule.cadence, rule.day_of_month, rule.weekday, addDays(from, -1));
}

/** Records the clinic's due expenses up to today, each day once, at most twelve per rule. */
export function recordDue(rules: readonly FakeRecurring[], expenses: FakeExpense[], today: string, makeId: () => string, now: string): number {
  let recorded = 0;
  for (const rule of rules) {
    if (statusOf(rule) !== "active") {
      continue;
    }
    for (let step = 0; step < CATCH_UP && rule.next_due_on <= today && (rule.ends_on === null || rule.next_due_on <= rule.ends_on); step += 1) {
      const day = rule.next_due_on;
      if (!expenses.some((e) => e.recurring_expense_id === rule.id && e.spent_on === day)) {
        expenses.push({
          id: makeId(),
          clinic_id: rule.clinic_id,
          category: rule.category,
          spent_on: day,
          amount_paise: rule.amount_paise,
          note: rule.note,
          ...(rule.method === null ? {} : { method: rule.method }),
          recorded_by: rule.recorded_by,
          created_at: now,
          recurring_expense_id: rule.id,
        });
        recorded += 1;
      }
      rule.next_due_on = dueAfter(rule.cadence, rule.day_of_month, rule.weekday, day);
    }
  }
  return recorded;
}
