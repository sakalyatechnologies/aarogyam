/** Pure helpers that turn metrics into what the health page shows. */

import type { ApiMetrics, MetricsRange } from "@aarogyam/api-client";
import type { Tone } from "@sakalya/ui";

export const RANGE_MINUTES: Readonly<Record<MetricsRange, number>> = { "1h": 60, "6h": 360, "24h": 1440, "7d": 10_080 };

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
    ...(range === "7d" ? { weekday: "short", day: "numeric", hour: "2-digit", hourCycle: "h23" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  });
  return (time) => clock.format(new Date(time));
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
