/** Pure shaping of the Analytics report for the charts: no React, so it is easy to test. */

import { EXPENSE_CATEGORIES, type Analytics, type AnalyticsBucket } from "@aarogyam/api-client";

export type Months = 3 | 6 | 12;

/** The first day of the month `months - 1` months before `today`: whole months, ending today. */
export function rangeStart(today: string, months: Months): string {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, (month ?? 1) - months, 1)).toISOString().slice(0, 10);
}

/** `Nov` (or `Nov '25` across a year boundary) for months; `6 Oct` for weeks. */
export function bucketLabel(start: string, bucket: AnalyticsBucket, withYear = false): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (bucket === "week") return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const month = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return withYear ? `${month} '${start.slice(2, 4)}` : month;
}

export const AGE_LABEL: Readonly<Record<string, string>> = {
  "0_12": "0–12",
  "13_17": "13–17",
  "18_34": "18–34",
  "35_49": "35–49",
  "50_64": "50–64",
  "65_plus": "65+",
  unknown: "Unknown",
};
export const VISIT_LABEL: Readonly<Record<string, string>> = { new: "New", follow_up: "Follow-up", procedure: "Procedure", emergency: "Emergency" };
export const REFERRAL_LABEL: Readonly<Record<string, string>> = {
  patient: "Patient",
  doctor: "Doctor",
  online: "Online",
  walk_in: "Walk-in",
  camp: "Camp",
  insurance: "Insurance",
  other: "Other",
  unknown: "Not recorded",
};

/** One row per period for the time charts; money in rupees, chair use in percent. */
export interface PeriodRow {
  label: string;
  /** The tooltip heading: the label, marked when the period is cut short by the range or today. */
  tip: string;
  income: number | null;
  expenses: number | null;
  newPatients: number;
  returning: number;
  [key: string]: string | number | null;
}

export const chairKey = (index: number) => `chair${String(index)}`;

const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The last day of the month or week starting `start`. */
export function periodEnd(start: string, bucket: AnalyticsBucket): string {
  const d = new Date(`${start}T00:00:00Z`);
  const end = bucket === "month" ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)) : new Date(d.getTime() + 6 * 86_400_000);
  return end.toISOString().slice(0, 10);
}

export function periodRows(report: Analytics): PeriodRow[] {
  const years = new Set(report.buckets.map((b) => b.start.slice(0, 4)));
  return report.buckets.map((b) => {
    const label = bucketLabel(b.start, report.bucket, years.size > 1);
    const row: PeriodRow = {
      label,
      tip: b.last_day < periodEnd(b.start, report.bucket) ? `${label} (so far)` : b.first_day > b.start ? `${label} (from ${shortDay(b.first_day)})` : label,
      income: b.income_paise == null ? null : b.income_paise / 100,
      expenses: b.expenses_paise == null ? null : b.expenses_paise / 100,
      newPatients: b.patients.new,
      returning: b.patients.returning,
    };
    for (const category of EXPENSE_CATEGORIES) {
      row[category] = (b.expenses?.find((e) => e.category === category)?.amount_paise ?? 0) / 100;
    }
    report.chairs.forEach((chair, index) => {
      const use = b.chair_utilization.find((u) => u.room_id === chair.id);
      row[chairKey(index)] = use === undefined ? 0 : Math.round(use.utilization_bps) / 100;
    });
    return row;
  });
}

export interface Totals {
  incomePaise: number;
  expensesPaise: number;
  netPaise: number;
  /** Booked over open minutes across every chair and period, 0..1+ (null without chairs). */
  chairUse: number | null;
  patients: number;
}

export function totals(report: Analytics): Totals {
  const income = report.buckets.reduce((s, b) => s + (b.income_paise ?? 0), 0);
  const expenses = report.buckets.reduce((s, b) => s + (b.expenses_paise ?? 0), 0);
  let booked = 0;
  let open = 0;
  for (const b of report.buckets) {
    for (const u of b.chair_utilization) {
      booked += u.booked_minutes;
      open += u.open_minutes;
    }
  }
  return {
    incomePaise: income,
    expensesPaise: expenses,
    netPaise: income - expenses,
    chairUse: open === 0 ? null : booked / open,
    patients: report.buckets.reduce((s, b) => s + b.patients.new + b.patients.returning, 0),
  };
}

/** Whether the report has anything to draw at all. */
export function isEmpty(report: Analytics): boolean {
  const t = totals(report);
  return t.patients === 0 && t.incomePaise === 0 && t.expensesPaise === 0 && report.busy_hours.length === 0;
}

/** Busy-hour grid: weekday rows (Mon..Sun) × the hours anything happened in, each 0..4 intensity. */
export function busyGrid(report: Analytics): { hours: number[]; rows: { weekday: number; cells: { hour: number; visits: number; level: number }[] }[] } {
  const visible = report.busy_hours.map((h) => h.hour);
  const first = visible.length === 0 ? 9 : Math.min(...visible);
  const last = visible.length === 0 ? 20 : Math.max(...visible);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const max = Math.max(1, ...report.busy_hours.map((h) => h.visits));
  const rows = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    cells: hours.map((hour) => {
      const visits = report.busy_hours.find((h) => h.weekday === weekday && h.hour === hour)?.visits ?? 0;
      return { hour, visits, level: visits === 0 ? 0 : Math.min(4, Math.ceil((visits / max) * 4)) };
    }),
  }));
  return { hours, rows };
}

export const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const hourLabel = (hour: number) => (hour === 0 ? "12a" : hour < 12 ? `${String(hour)}a` : hour === 12 ? "12p" : `${String(hour - 12)}p`);
