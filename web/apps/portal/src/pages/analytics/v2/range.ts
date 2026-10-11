import type { AnalyticsBucket } from "@aarogyam/api-client";

import type { Months } from "../analytics-data.js";

/** The range switch. It lives in the URL as `?range=3m|6m|12m`, so a reload or a shared link keeps it. */
export const RANGES = [
  { value: "3m", label: "3 months", months: 3 },
  { value: "6m", label: "6 months", months: 6 },
  { value: "12m", label: "12 months", months: 12 },
] as const satisfies readonly { value: string; label: string; months: Months }[];

export type RangeKey = (typeof RANGES)[number]["value"];

export const DEFAULT_RANGE: RangeKey = "6m";

/** The range asked for in the URL; anything unknown is the default. */
export function parseRange(raw: string | null): RangeKey {
  return RANGES.find((r) => r.value === raw)?.value ?? DEFAULT_RANGE;
}

export const monthsOf = (range: RangeKey): Months => RANGES.find((r) => r.value === range)?.months ?? 6;

/** Three months read best by week; longer ranges by month. */
export const bucketOf = (range: RangeKey): AnalyticsBucket => (range === "3m" ? "week" : "month");

/** Whole weeks for the collections report (1 to 52): 13, 26 or 52. */
export const weeksOf = (range: RangeKey): number => Math.min(52, Math.round(monthsOf(range) * 4.35));

export type TabKey = "practice" | "money";

/** The tab in the URL (`?tab=money`); Money only when this member may see it. */
export function parseTab(raw: string | null, moneyAllowed: boolean): TabKey {
  return raw === "money" && moneyAllowed ? "money" : "practice";
}

/** At most 42 days ending today: the longest span the expense list accepts. */
export function expenseWindow(today: string): { from: string; to: string } {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 41);
  return { from: start.toISOString().slice(0, 10), to: today };
}
