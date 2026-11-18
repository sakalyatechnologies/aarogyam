import type { AnalyticsBucket } from "@aarogyam/api-client";

/**
 * The range switch. It lives in the URL as `?range=1d|3d|7d|1m|3m|6m|12m`, or `?range=custom&from=…&to=…`, so a
 * reload or a shared link keeps it. Every range ends today except a custom one; "3 days" is today and the two before.
 */
export const RANGES = [
  { value: "1d", label: "1 day", days: 1 },
  { value: "3d", label: "3 days", days: 3 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "1m", label: "1 month", months: 1 },
  { value: "3m", label: "3 months", months: 3 },
  { value: "6m", label: "6 months", months: 6 },
  { value: "12m", label: "12 months", months: 12 },
  { value: "custom", label: "Custom" },
] as const satisfies readonly { value: string; label: string; days?: number; months?: number }[];

export type RangeKey = (typeof RANGES)[number]["value"];

export const DEFAULT_RANGE: RangeKey = "6m";

/** The longest custom range, in days: what the collections report accepts. */
export const MAX_CUSTOM_DAYS = 366;

/** The range asked for in the URL; anything unknown is the default. */
export function parseRange(raw: string | null): RangeKey {
  return RANGES.find((r) => r.value === raw)?.value ?? DEFAULT_RANGE;
}

/** The days a range covers and how its charts group them. */
export interface RangeWindow {
  /** First day, `YYYY-MM-DD`. */
  from: string;
  /** Last day, included. */
  to: string;
  /** Days covered, both ends included. */
  days: number;
  /** Up to a month by day, up to three months by week, longer by month. */
  bucket: AnalyticsBucket;
}

const DAY_MS = 86_400_000;
const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  return toDay(new Date(toDate(day).getTime() + days * DAY_MS));
}

/** Days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS) + 1;
}

/** The day after the same date `months` months before `today` (the 17th becomes the 18th), clamped to short months. */
function monthsBack(today: string, months: number): string {
  const d = toDate(today);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return addDays(toDay(target), 1);
}

export function bucketFor(days: number): AnalyticsBucket {
  return days <= 31 ? "day" : days <= 92 ? "week" : "month";
}

function window(from: string, to: string): RangeWindow {
  const days = daysBetween(from, to);
  return { from, to, days, bucket: bucketFor(days) };
}

/** What is wrong with a custom range, or nothing. */
export function customProblem(from: string, to: string, today: string): string | undefined {
  if (from === "" || to === "") return "Choose a start and an end date.";
  if (from > to) return "The start date must be on or before the end date.";
  if (to > today) return "The end date can't be after today.";
  if (daysBetween(from, to) > MAX_CUSTOM_DAYS) return "Choose a range of at most a year.";
  return undefined;
}

/** The window a range covers. A custom range that is incomplete or invalid falls back to the default. */
export function windowOf(range: RangeKey, today: string, custom: { from: string; to: string } = { from: "", to: "" }): RangeWindow {
  if (range === "custom") {
    return customProblem(custom.from, custom.to, today) === undefined ? window(custom.from, custom.to) : windowOf(DEFAULT_RANGE, today);
  }
  const preset = RANGES.find((r) => r.value === range) ?? RANGES[5];
  if ("days" in preset) return window(addDays(today, 1 - preset.days), today);
  if ("months" in preset) return window(monthsBack(today, preset.months), today);
  return windowOf(DEFAULT_RANGE, today);
}

/** "the last 7 days", "18 Oct – 17 Nov 2026": what the cards' subtitles say the range is. */
export function windowLabel(win: RangeWindow): string {
  const fmt = (day: string, year: boolean) =>
    toDate(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
  return win.from === win.to ? fmt(win.from, true) : `${fmt(win.from, win.from.slice(0, 4) !== win.to.slice(0, 4))} – ${fmt(win.to, true)}`;
}

export type TabKey = "practice" | "money";

/** The tab in the URL (`?tab=money`); Money only when this member may see it. */
export function parseTab(raw: string | null, moneyAllowed: boolean): TabKey {
  return raw === "money" && moneyAllowed ? "money" : "practice";
}

/** The range's days, cut to at most the last 42 (the longest span the expense list accepts). */
export function expenseWindow(win: RangeWindow): { from: string; to: string } {
  const earliest = addDays(win.to, -41);
  return { from: win.from > earliest ? win.from : earliest, to: win.to };
}
