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
  "30d": { points: 30, minutes: 1440 },
};

/** The timeline's resolution per range, matching the API: minutes per point and point count. */
const TIMELINE: Readonly<Record<C.MetricsRange, { points: number; minutes: number }>> = {
  "1h": { points: 60, minutes: 1 },
  "6h": { points: 360, minutes: 1 },
  "24h": { points: 288, minutes: 5 },
  "7d": { points: 168, minutes: 60 },
  "30d": { points: 120, minutes: 360 },
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
        { query_id: "-4581238471923471289", calls: 1_840, mean_ms: 412.6, total_ms: 759_184, query: "select p.id, p.number from aarogyam.patients p where p.org_id = $1 order by p.created_at desc limit $2" },
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
    source: "cloud_monitoring",
    cloud: cloudMetrics(timeline, timelineShape.minutes * 60),
    cloud_error: null,
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

/** Cloud Run's view of the same traffic, as Cloud Monitoring would answer it. */
function cloudMetrics(timeline: readonly C.ApiTimelinePoint[], intervalSeconds: number): C.CloudMetrics {
  const points = (value: (point: C.ApiTimelinePoint, index: number) => number): C.CloudPoint[] =>
    timeline.map((point, index) => ({ at: point.at, value: value(point, index) }));
  const busy = (point: C.ApiTimelinePoint) => (point.requests > 0 ? 1 : 0);
  return {
    interval_seconds: intervalSeconds,
    service: {
      requests: [
        { label: "2xx", points: points((p) => p.requests - p.errors_4xx - p.errors_429 - p.errors_5xx) },
        { label: "4xx", points: points((p) => p.errors_4xx + p.errors_429) },
        { label: "5xx", points: points((p) => p.errors_5xx) },
      ],
      latency_p50_ms: points((p) => p.p50_ms),
      latency_p95_ms: points((p) => p.p95_ms),
      latency_p99_ms: points((p) => p.p99_ms),
      instances: points(busy),
      cold_starts: points((_, index) => (index % 17 === 0 ? 1 : 0)),
      cpu_p95: points((p) => Math.min(1, 0.04 + p.requests / 4000)),
      memory_p95: points(() => 0.31),
    },
    job: {
      executions: [
        { label: "failed", points: points((_, index) => (index % 41 === 7 ? 1 : 0)) },
        { label: "succeeded", points: points(() => Math.max(1, Math.round(intervalSeconds / 120))) },
      ],
      billable_seconds: points(() => Math.round((intervalSeconds / 120) * 3.2)),
      cpu_seconds: points(() => Math.round((intervalSeconds / 120) * 3.2)),
      memory_gib_seconds: points(() => Math.round((intervalSeconds / 120) * 1.6)),
    },
  };
}

const DB_BUCKET_SECONDS: Readonly<Record<C.MetricsRange, { points: number; seconds: number }>> = {
  "1h": { points: 12, seconds: 300 },
  "6h": { points: 72, seconds: 300 },
  "24h": { points: 96, seconds: 900 },
  "7d": { points: 84, seconds: 7_200 },
  "30d": { points: 120, seconds: 21_600 },
};

/** The database over time, shaped like the drain job's samples. */
export function createDbInsights(range: C.MetricsRange, now: Date): C.DbInsights {
  const random = createRandom(Math.floor(now.getTime() / (60 * MINUTE)) * 17 + range.length);
  const { points, seconds } = DB_BUCKET_SECONDS[range];
  const metrics = createMetrics(range, now);
  const samples = Array.from({ length: points }, (_, index): C.DbSamplePoint => {
    const at = new Date(now.getTime() - (points - index) * seconds * 1000);
    const load = requestsPerMinute(at) / 90;
    return {
      at: at.toISOString(),
      connections: 6 + Math.round(load * 14) + random.int(0, 3),
      max_connections: 60,
      cache_hit_ratio: 0.99 + random.next() * 0.009,
      db_bytes: 180_000_000 + index * 40_000,
      commits_per_min: index === 0 ? null : Math.round(40 + load * 900 * (0.8 + random.next() * 0.4)),
      rollbacks_per_min: index === 0 ? null : Math.round(load * 6 * random.next()),
      rows_read_per_min: index === 0 ? null : Math.round(2_000 + load * 60_000 * (0.8 + random.next() * 0.4)),
      rows_written_per_min: index === 0 ? null : Math.round(20 + load * 700 * (0.8 + random.next() * 0.4)),
      deadlocks: 0,
      temp_bytes: random.chance(0.05) ? 8_388_608 : 0,
    };
  });
  return {
    generated_at: now.toISOString(),
    range,
    interval_seconds: seconds,
    size_limit_bytes: 500 * 1024 * 1024,
    current: metrics.db,
    samples,
  };
}

const FAKE_CLINICS = [
  { org_id: "01a1de06-4c8e-796c-9d69-88e115d26ba1", slug: "sunrise", name: "Sunrise Dental", visits: 18, staff: 7 },
  { org_id: "01a1de06-4c8e-796c-9d69-88e115d26ba2", slug: "lotus", name: "Lotus Smile Studio", visits: 9, staff: 4 },
  { org_id: "01a1de06-4c8e-796c-9d69-88e115d26ba3", slug: "pearl", name: "Pearl Clinic", visits: 2, staff: 2 },
] as const;

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Clinic usage and onboarding: counts, timings and dates for three made-up clinics. */
export function createUsageInsights(range: C.MetricsRange, now: Date): C.UsageInsights {
  const random = createRandom(Math.floor(now.getTime() / (24 * 60 * MINUTE)) * 13 + range.length);
  const span = range === "30d" ? 30 : range === "7d" ? 7 : 1;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayAt = (back: number) => new Date(today.getTime() - back * 24 * 60 * MINUTE);
  const timings = (visits: number): C.JourneyTimings =>
    visits < 5
      ? { arrive_to_seat_minutes: null, seat_to_start_minutes: null, visit_minutes: null, end_to_paid_minutes: null, booking_lead_days: null }
      : {
          arrive_to_seat_minutes: 8 + random.int(0, 9),
          seat_to_start_minutes: 2 + random.int(0, 4),
          visit_minutes: 22 + random.int(0, 14),
          end_to_paid_minutes: 3 + random.int(0, 6),
          booking_lead_days: 1 + random.int(0, 3),
        };
  const days = Array.from({ length: span }, (_, index): C.UsageDay => {
    const day = dayAt(span - index);
    const weekend = day.getUTCDay() === 0;
    const visits = FAKE_CLINICS.reduce((sum, clinic) => sum + (weekend ? 0 : clinic.visits + random.int(-2, 3)), 0);
    return {
      day: isoDay(day),
      clinics: FAKE_CLINICS.length,
      visits,
      booked: visits + random.int(0, 6),
      no_shows: random.int(0, 3),
      active_staff: weekend ? 2 : FAKE_CLINICS.reduce((sum, clinic) => sum + clinic.staff, 0) - random.int(0, 3),
      timings: timings(visits),
    };
  });
  const clinics = FAKE_CLINICS.map((clinic): C.ClinicUsage => ({
    org_id: clinic.org_id,
    slug: clinic.slug,
    name: clinic.name,
    days: span,
    visits: clinic.visits * span,
    booked: (clinic.visits + 2) * span,
    no_shows: Math.round(span * 0.6),
    active_staff: clinic.staff,
    timings: timings(clinic.visits),
    roles: clinic.staff >= 6 ? [{ role_key: "doctor", members: 3 }, { role_key: "front_desk", members: 3 }] : [],
  }));
  const roles = days.flatMap((day): C.RoleUsage[] => [
    { day: day.day, role_key: "owner", members: 3, clinics: 3 },
    { day: day.day, role_key: "doctor", members: 5, clinics: 3 },
    { day: day.day, role_key: "front_desk", members: 4, clinics: 2 },
    { day: day.day, role_key: "assistant", members: 1, clinics: 1 },
  ]);
  const at = (back: number) => dayAt(back).toISOString();
  const base = (clinic: (typeof FAKE_CLINICS)[number]) => ({ org_id: clinic.org_id, slug: clinic.slug, name: clinic.name });
  const onboarding: C.OnboardingClinic[] = [
    { ...base(FAKE_CLINICS[2]), status: "trial", created_at: at(3), owner_joined_at: at(3), setup_steps_done: 2, setup_completed_at: null, first_patient_at: at(2), first_visit_at: null, first_bill_at: null, first_busy_week: null },
    { ...base(FAKE_CLINICS[1]), status: "trial", created_at: at(20), owner_joined_at: at(19), setup_steps_done: 5, setup_completed_at: at(18), first_patient_at: at(18), first_visit_at: at(17), first_bill_at: at(17), first_busy_week: isoDay(dayAt(14)) },
    { ...base(FAKE_CLINICS[0]), status: "active", created_at: at(60), owner_joined_at: at(60), setup_steps_done: 6, setup_completed_at: at(59), first_patient_at: at(59), first_visit_at: at(58), first_bill_at: at(58), first_busy_week: isoDay(dayAt(56)) },
  ];
  return {
    generated_at: now.toISOString(),
    range,
    from: isoDay(dayAt(span)),
    to: isoDay(today),
    days,
    clinics,
    roles,
    onboarding,
  };
}

const PORTAL_PAGES = ["/today", "/patients/:id/visits/:visitId", "/patients/:id", "/calendar", "/billing", "/queue", "/patients", "/settings"];
const CONSOLE_PAGES = ["/health", "/clinics", "/clinics/:id"];
const API_ROUTES: [string, string][] = [
  ["GET", "/api/v1/today"],
  ["GET", "/api/v1/patients/{id}"],
  ["GET", "/api/v1/appointments"],
  ["POST", "/api/v1/visits/{id}/notes"],
  ["GET", "/api/v1/queue"],
  ["POST", "/api/v1/invoices"],
  ["POST", "/api/v1/telemetry"],
];

/** Durable API routes: made-up counts with a few errors and a slow route. */
export function createRouteInsights(range: C.MetricsRange, now: Date): C.ApiRouteInsights {
  const random = createRandom(Math.floor(now.getTime() / (60 * MINUTE)) * 17 + range.length);
  const scale = range === "30d" ? 720 : range === "7d" ? 168 : range === "24h" ? 24 : range === "6h" ? 6 : 1;
  const since = new Date(now.getTime() - scale * 60 * MINUTE);
  since.setUTCMinutes(0, 0, 0);
  const routes = API_ROUTES.map(([method, route], index) => {
    const requests = Math.round((400 - index * 45) * scale * (0.8 + random.next() * 0.4));
    const errors5xx = index === 3 ? Math.round(requests * 0.02) : 0;
    const errors429 = index === 6 ? Math.round(requests * 0.01) : 0;
    const p50 = 20 + index * 12 + random.next() * 10;
    return {
      method,
      route,
      requests,
      errors_4xx: Math.round(requests * 0.01),
      errors_5xx: errors5xx,
      errors_429: errors429,
      error_rate: requests === 0 ? 0 : (errors5xx + errors429) / requests,
      p50_ms: Math.round(p50 * 10) / 10,
      p95_ms: Math.round((p50 * (index === 3 ? 9 : 3)) * 10) / 10,
    };
  }).sort((a, b) => b.requests - a.requests);
  return { generated_at: now.toISOString(), range, since: since.toISOString(), routes };
}

const THRESHOLDS: C.VitalThreshold[] = [
  { vital: "lcp", good: 2500, poor: 4000, unit: "ms" },
  { vital: "inp", good: 200, poor: 500, unit: "ms" },
  { vital: "cls", good: 0.1, poor: 0.25, unit: "" },
  { vital: "ttfb", good: 800, poor: 1800, unit: "ms" },
];

function rate(value: number, vital: string): string {
  const threshold = THRESHOLDS.find((t) => t.vital === vital);
  if (threshold === undefined) return "good";
  return value <= threshold.good ? "good" : value <= threshold.poor ? "needs_work" : "poor";
}

function daySpan(range: C.MetricsRange, now: Date): { from: string; to: string } {
  const back = range === "30d" ? 29 : range === "7d" ? 6 : 1;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: new Date(today.getTime() - back * 24 * 60 * MINUTE).toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

/** Page speed per page and error classes, made up. */
export function createFrontEndInsights(range: C.MetricsRange, now: Date): C.FrontEndInsights {
  const random = createRandom(Math.floor(now.getTime() / (24 * 60 * MINUTE)) * 19 + range.length);
  const vitals: C.VitalStat[] = [];
  const pages: [string, string][] = [...PORTAL_PAGES.map((p): [string, string] => ["portal", p]), ...CONSOLE_PAGES.map((p): [string, string] => ["console", p])];
  pages.forEach(([app, route], index) => {
    const samples = index === pages.length - 1 ? 3 : 20 + Math.round(random.next() * 200);
    const base: Record<string, number> = { lcp: 1200 + index * 260 + random.next() * 400, inp: 80 + index * 30, cls: 0.02 + index * 0.02, ttfb: 300 + index * 60 };
    for (const vital of ["lcp", "inp", "cls", "ttfb"]) {
      if (vital === "ttfb" && index > 2) continue;
      const value = base[vital] ?? 0;
      const p75 = samples < 5 ? null : vital === "cls" ? Math.round(value * 1000) / 1000 : Math.round(value);
      const poor = Math.round(samples * (index / 40));
      const needs = Math.round(samples * 0.15);
      vitals.push({
        app,
        route,
        vital,
        samples,
        p75,
        rating: p75 === null ? null : rate(p75, vital),
        good: samples - needs - poor,
        needs_work: needs,
        poor,
      });
    }
  });
  const errors: C.ErrorStat[] = [
    { app: "portal", route: "/patients/:id/visits/:visitId", class: "type_error", count: 7 },
    { app: "portal", route: "/today", class: "chunk_load", count: 4 },
    { app: "portal", route: "other", class: "network", count: 2 },
    { app: "console", route: "/health", class: "unhandled_rejection", count: 1 },
  ];
  return { generated_at: now.toISOString(), range, ...daySpan(range, now), thresholds: THRESHOLDS, vitals, errors };
}

/** Pages by time and views per app, roles across clinics and clinic totals, made up. */
export function createPageInsights(range: C.MetricsRange, now: Date): C.PageInsights {
  const random = createRandom(Math.floor(now.getTime() / (24 * 60 * MINUTE)) * 23 + range.length);
  const span = range === "30d" ? 30 : range === "7d" ? 7 : 2;
  const page = (app: string, route: string, index: number): C.PageStat => {
    const views = route === "/settings" ? 3 : Math.round((300 - index * 30) * span * (0.7 + random.next() * 0.6));
    const avg = 20_000 + random.next() * 200_000 - index * 8_000;
    const shown = views >= 5;
    return { app, route, views, visible_ms: shown ? Math.round(views * avg) : null, avg_visible_ms: shown ? Math.round(avg) : null };
  };
  const pages = [...PORTAL_PAGES.map((route, i) => page("portal", route, i)), ...CONSOLE_PAGES.map((route, i) => page("console", route, i + 4))].sort(
    (a, b) => (b.visible_ms ?? 0) - (a.visible_ms ?? 0),
  );
  const roles: C.RolePages[] = [
    { app: "portal", role_key: "doctor", views: 2_100 * span, visible_ms: 9_000_000 * span },
    { app: "portal", role_key: "front_desk", views: 1_600 * span, visible_ms: 7_200_000 * span },
    { app: "portal", role_key: "owner", views: 700 * span, visible_ms: 2_400_000 * span },
    { app: "portal", role_key: "custom", views: 3, visible_ms: null },
    { app: "console", role_key: "owner", views: 90 * span, visible_ms: 600_000 * span },
  ];
  const clinics: C.ClinicPages[] = [
    { org_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405180", slug: "sunrise", name: "Sunrise Dental", views: 2_400 * span, visible_ms: 10_800_000 * span },
    { org_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405181", slug: "lotus", name: "Lotus Dental Care", views: 1_900 * span, visible_ms: 7_900_000 * span },
    { org_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405182", slug: "meadow", name: "Meadow Clinic", views: 4, visible_ms: null },
  ];
  return { generated_at: now.toISOString(), range, ...daySpan(range, now), pages, roles, clinics };
}
