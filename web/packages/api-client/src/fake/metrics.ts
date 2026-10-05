/**
 * Synthetic service health for the console: API traffic shaped by clinic hours, database health
 * and edge analytics. Route templates and query IDs only, never URLs or query text.
 */

import type * as C from "../contract.js";
import { createRandom } from "./random.js";

const MINUTE = 60_000;

const BUCKETS: Readonly<Record<C.MetricsRange, { points: number; minutes: number }>> = {
  "1h": { points: 12, minutes: 5 },
  "6h": { points: 12, minutes: 30 },
  "24h": { points: 24, minutes: 60 },
  "7d": { points: 28, minutes: 360 },
};

/** The timeline's resolution per range, matching the API: minutes per point and point count. */
const TIMELINE: Readonly<Record<C.MetricsRange, { points: number; minutes: number }>> = {
  "1h": { points: 60, minutes: 1 },
  "6h": { points: 360, minutes: 1 },
  "24h": { points: 288, minutes: 5 },
  "7d": { points: 168, minutes: 60 },
};

const ROUTES: readonly { method: string; route: string; share: number; p95: number; errors: number }[] = [
  { method: "GET", route: "/api/v1/today", share: 0.22, p95: 140, errors: 0.002 },
  { method: "GET", route: "/api/v1/patients", share: 0.18, p95: 120, errors: 0.003 },
  { method: "GET", route: "/api/v1/patients/{id}", share: 0.15, p95: 95, errors: 0.006 },
  { method: "GET", route: "/api/v1/session", share: 0.12, p95: 35, errors: 0.001 },
  { method: "GET", route: "/api/v1/appointments", share: 0.1, p95: 150, errors: 0.002 },
  { method: "POST", route: "/api/v1/appointments", share: 0.06, p95: 210, errors: 0.012 },
  { method: "POST", route: "/api/v1/patients", share: 0.05, p95: 180, errors: 0.025 },
  { method: "GET", route: "/api/v1/me", share: 0.05, p95: 30, errors: 0.001 },
  { method: "POST", route: "/api/v1/invoices", share: 0.04, p95: 260, errors: 0.008 },
  { method: "POST", route: "/api/v1/payments", share: 0.03, p95: 320, errors: 0.01 },
];

/** Requests per minute at a given instant: busy in clinic hours (IST), quiet at night. */
function requestsPerMinute(at: Date): number {
  const istHour = (at.getUTCHours() + at.getUTCMinutes() / 60 + 5.5) % 24;
  const busy = istHour >= 9 && istHour < 21 ? 1 : istHour >= 7 && istHour < 23 ? 0.35 : 0.06;
  return 90 * busy;
}

export function createMetrics(range: C.MetricsRange, now: Date): C.ServiceMetrics {
  // Stable within an hour, so refetching doesn't make the charts jump.
  const random = createRandom(Math.floor(now.getTime() / (60 * MINUTE)) * 31 + range.length * 7);
  const { points, minutes } = BUCKETS[range];
  const errorRate = 0.004;
  const incident = range === "1h" ? -1 : points - Math.ceil(points / 3);

  const series = Array.from({ length: points }, (_, index): C.ApiMetricsPoint => {
    const at = new Date(now.getTime() - (points - index) * minutes * MINUTE);
    const requests = Math.round(requestsPerMinute(at) * minutes * (0.85 + random.next() * 0.3));
    const spike = index === incident;
    const errors = Math.round(requests * errorRate * (spike ? 9 : 0.6 + random.next() * 0.8));
    return { at: at.toISOString(), requests, errors, p95_ms: Math.round(spike ? 880 + random.int(0, 200) : 165 + random.int(0, 70)) };
  });

  const timelineShape = TIMELINE[range];
  const spikeStart = Math.floor(timelineShape.points * 0.7);
  const timeline = Array.from({ length: timelineShape.points }, (_, index): C.ApiTimelinePoint => {
    const at = new Date(now.getTime() - (timelineShape.points - index) * timelineShape.minutes * MINUTE);
    const requests = Math.round(requestsPerMinute(at) * timelineShape.minutes * (0.85 + random.next() * 0.3));
    const spike = range !== "1h" && index >= spikeStart && index < spikeStart + Math.max(2, Math.round(timelineShape.points / 40));
    const share = (rate: number) => Math.round(requests * rate * (spike ? 9 : 0.6 + random.next() * 0.8));
    const p50 = 34 + random.int(0, 14);
    const p95 = spike ? 640 + random.int(0, 260) : 150 + random.int(0, 90);
    return {
      at: at.toISOString(),
      requests,
      errors_4xx: share(0.004),
      errors_429: spike ? share(0.002) : random.chance(0.05) ? 1 : 0,
      errors_5xx: share(0.0012),
      p50_ms: p50,
      p95_ms: p95,
      p99_ms: Math.round(p95 * (1.9 + random.next() * 0.8)),
    };
  });

  const requests = series.reduce((sum, point) => sum + point.requests, 0);
  const errors = series.reduce((sum, point) => sum + point.errors, 0);
  const rate = (part: number) => (requests === 0 ? 0 : part / requests);
  const rate5xx = rate(Math.round(errors * 0.3));
  const rate4xx = rate(errors) - rate5xx;

  const routes = ROUTES.map((route): C.RouteMetrics => {
    const p95 = Math.round(route.p95 * (0.9 + random.next() * 0.25));
    return {
      method: route.method,
      route: route.route,
      requests: Math.round(requests * route.share),
      error_rate: Math.min(1, route.errors * (0.7 + random.next() * 0.6)),
      p95_ms: p95,
      p99_ms: Math.round(p95 * (2.4 + random.next())),
    };
  }).sort((a, b) => b.requests - a.requests);

  return {
    generated_at: now.toISOString(),
    range,
    api: {
      requests,
      success_rate: 1 - rate4xx - rate5xx,
      rate_4xx: rate4xx,
      rate_5xx: rate5xx,
      p50_ms: 38 + random.int(0, 12),
      p95_ms: 190 + random.int(0, 40),
      p99_ms: 610 + random.int(0, 160),
      series,
      timeline_interval_seconds: timelineShape.minutes * 60,
      timeline,
      routes,
    },
    db: {
      connections_used: 18 + random.int(0, 6),
      connections_max: 60,
      cache_hit_ratio: 0.9962,
      size_bytes: 2_791_728_742,
      slow_queries: [
        { query_id: "-4581238471923471289", calls: 1_840, mean_ms: 412.6, total_ms: 759_184 },
        { query_id: "7712093384551029376", calls: 26_310, mean_ms: 88.1, total_ms: 2_317_911 },
        { query_id: "1209938475610293847", calls: 410, mean_ms: 61.4, total_ms: 25_174 },
        { query_id: "-998172635401928374", calls: 98_220, mean_ms: 12.9, total_ms: 1_267_038 },
        { query_id: "3341029384756610293", calls: 5_120, mean_ms: 9.7, total_ms: 49_664 },
      ],
      tables: [
        { name: "outbox_events", live_rows: 12_400, dead_rows: 96_880, size_bytes: 41_943_040 },
        { name: "audit_events", live_rows: 2_100_331, dead_rows: 84_220, size_bytes: 912_261_120 },
        { name: "messages", live_rows: 310_220, dead_rows: 4_100, size_bytes: 188_743_680 },
        { name: "access_log", live_rows: 1_420_880, dead_rows: 3_100, size_bytes: 402_653_184 },
        { name: "appointments", live_rows: 210_442, dead_rows: 1_920, size_bytes: 96_468_992 },
        { name: "patients", live_rows: 48_210, dead_rows: 310, size_bytes: 37_748_736 },
      ],
    },
    edge: {
          requests: Math.round(requests * 3.6),
          rate_4xx: 0.006,
          rate_5xx: 0.0004,
          cpu_p95_ms: 3.1,
          page_views: Math.round(requests * 0.4),
          lcp_p75_ms: 2_140,
          inp_p75_ms: 148,
          cls_p75: 0.04,
        },
  };
}
