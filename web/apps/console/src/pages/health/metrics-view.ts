/** Pure helpers that turn metrics into what the Insights page shows. */

import type { ApiMetrics, CloudPoint, MetricsRange } from "@aarogyam/api-client";
import type { Tone } from "@sakalya/ui";

export const RANGE_MINUTES: Readonly<Record<MetricsRange, number>> = { "1h": 60, "6h": 360, "24h": 1440, "7d": 10_080, "30d": 43_200 };

/** The p95 latency the API aims to stay under. */
export const P95_BUDGET_MS = 300;

export interface Timeline {
  /** Epoch milliseconds of each interval's start, oldest first. */
  times: number[];
  /** Requests per minute (an interval's count divided by its length in minutes). */
  requests: number[];
  /** Failures per minute: 5xx and 429, the ones that count against the success rate. */
  errors: number[];
  /** Failures as a percentage of requests (0 to 100); 0 when there were no requests. */
  errorRate: number[];
  errors4xx: number[];
  errors429: number[];
  errors5xx: number[];
  p50: number[];
  p95: number[];
  p99: number[];
  /** Requests over the whole range. */
  total: number;
  /** Minutes covered by each point. */
  minutes: number;
}

/** Turns the API's timeline into the per-minute series the charts draw. */
export function timelineView(api: ApiMetrics): Timeline {
  const points = api.timeline;
  const minutes = Math.max(1, api.timeline_interval_seconds / 60);
  const perMinute = (count: number) => count / minutes;
  return {
    times: points.map((p) => Date.parse(p.at)),
    requests: points.map((p) => perMinute(p.requests)),
    errors: points.map((p) => perMinute(p.errors_5xx + p.errors_429)),
    errorRate: points.map((p) => (p.requests === 0 ? 0 : ((p.errors_5xx + p.errors_429) / p.requests) * 100)),
    errors4xx: points.map((p) => perMinute(p.errors_4xx)),
    errors429: points.map((p) => perMinute(p.errors_429)),
    errors5xx: points.map((p) => perMinute(p.errors_5xx)),
    p50: points.map((p) => p.p50_ms),
    p95: points.map((p) => p.p95_ms),
    p99: points.map((p) => p.p99_ms),
    total: points.reduce((sum, p) => sum + p.requests, 0),
    minutes,
  };
}

/** A formatter for the x axis: clock time, with the day when the range spans more than one. */
export function timeFormatter(range: MetricsRange, timeZone: string): (time: number) => string {
  const clock = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    ...(range === "30d"
      ? { day: "numeric", month: "short" }
      : range === "7d"
        ? { weekday: "short", day: "numeric", hour: "2-digit", hourCycle: "h23" }
        : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  });
  return (time) => clock.format(new Date(time));
}

/** Formats a calendar day (`YYYY-MM-DD`, read as UTC midnight) as `18 Nov`. */
export function dayFormatter(): (time: number) => string {
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
  return (time) => day.format(new Date(time));
}

/** Epoch milliseconds of a calendar day (`YYYY-MM-DD`) at UTC midnight. */
export const dayTime = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Series whose points may start and stop at different times, on one shared time axis. */
export interface Aligned {
  times: number[];
  /** One value per time per series, `null` where the series has no point. */
  values: (number | null)[][];
}

/** Puts several point series on one sorted time axis, leaving gaps where a series has no point. */
export function alignPoints(series: readonly (readonly CloudPoint[])[]): Aligned {
  const times = [...new Set(series.flatMap((points) => points.map((point) => Date.parse(point.at))))].sort((a, b) => a - b);
  const values = series.map((points) => {
    const byTime = new Map(points.map((point) => [Date.parse(point.at), point.value]));
    return times.map((time) => byTime.get(time) ?? null);
  });
  return { times, values };
}

/** A per-interval count as a rate per minute. */
export const perMinuteOf = (intervalSeconds: number) => (value: number | null) => (value === null ? null : value / Math.max(1, intervalSeconds / 60));

/** Of the clinics given, how many reached each onboarding step. */
export function funnelCounts(
  rows: readonly {
    owner_joined_at?: string | null | undefined;
    setup_completed_at?: string | null | undefined;
    first_patient_at?: string | null | undefined;
    first_visit_at?: string | null | undefined;
    first_bill_at?: string | null | undefined;
    first_busy_week?: string | null | undefined;
  }[],
): { label: string; count: number }[] {
  const reached = (value: string | null | undefined) => value !== null && value !== undefined;
  const count = (pick: (row: (typeof rows)[number]) => string | null | undefined) => rows.filter((row) => reached(pick(row))).length;
  return [
    { label: "Created", count: rows.length },
    { label: "Owner joined", count: count((row) => row.owner_joined_at) },
    { label: "Setup completed", count: count((row) => row.setup_completed_at) },
    { label: "First patient", count: count((row) => row.first_patient_at) },
    { label: "First visit", count: count((row) => row.first_visit_at) },
    { label: "First bill", count: count((row) => row.first_bill_at) },
    { label: "A week with 5+ visits", count: count((row) => row.first_busy_week) },
  ];
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
