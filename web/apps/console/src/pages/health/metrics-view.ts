/** Pure helpers that turn metrics into what the health page shows. */

import type { ApiMetrics, MetricsRange } from "@aarogyam/api-client";
import type { Tone } from "@sakalya/ui";

export const RANGE_MINUTES: Readonly<Record<MetricsRange, number>> = { "1h": 60, "24h": 1440, "7d": 10_080 };

/** The p95 latency the API aims to stay under. */
export const P95_BUDGET_MS = 300;

export interface Bucket {
  label: string;
  requests: number;
  errors: number;
  /** The highest p95 among the points merged into this bucket. */
  p95: number;
}

/** Merges points so a chart has at most 12 readable columns: 5 min, 2 h or 1 day each. */
export function bucketSeries(series: ApiMetrics["series"], range: MetricsRange, timeZone: string): Bucket[] {
  const size = range === "1h" ? 1 : range === "24h" ? 2 : 4;
  const label = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    ...(range === "7d" ? { weekday: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  });
  const buckets: Bucket[] = [];
  for (let start = 0; start < series.length; start += size) {
    const group = series.slice(start, start + size);
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    buckets.push({
      label: label.format(new Date(first.at)),
      requests: group.reduce((sum, point) => sum + point.requests, 0),
      errors: group.reduce((sum, point) => sum + point.errors, 0),
      p95: Math.max(...group.map((point) => point.p95_ms)),
    });
  }
  return buckets;
}

export type Health = "good" | "watch" | "bad";

export const HEALTH_TONE: Readonly<Record<Health, Tone>> = { good: "success", watch: "warning", bad: "danger" };

const grade = (value: number, good: number, watch: number): Health => (value <= good ? "good" : value <= watch ? "watch" : "bad");

export const successHealth = (rate: number): Health => (rate >= 0.995 ? "good" : rate >= 0.98 ? "watch" : "bad");
export const serverErrorHealth = (rate: number): Health => grade(rate, 0.001, 0.01);
export const latencyHealth = (ms: number): Health => grade(ms, P95_BUDGET_MS, 800);
export const lcpHealth = (ms: number): Health => grade(ms, 2500, 4000);
export const inpHealth = (ms: number): Health => grade(ms, 200, 500);
export const clsHealth = (score: number): Health => grade(score, 0.1, 0.25);
