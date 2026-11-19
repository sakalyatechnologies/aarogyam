/**
 * The console's cost estimate for the fake backend: a small clinic platform's month on Cloud Run,
 * priced the way the API prices it (crates/aarogyam-app/src/cloud_cost.rs), so the Cost tab shows
 * both lines inside the free tier and a line over it.
 */

import type * as C from "../contract.js";

const GIB = 1_073_741_824;
const INR_PER_USD = 88;
const GST_PERCENT = 18;

/** Key, resource, label, unit, used so far, and [free amount, USD per unit] when billed. */
type Row = readonly [string, "service" | "job", string, string, number, readonly [number, number] | null];

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function createCostInsights(now: Date): C.CostInsights {
  const start = monthStart(now);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const fraction = Math.min(1, Math.max(60_000, now.getTime() - start.getTime()) / (next.getTime() - start.getTime()));
  // About 60,000 requests a day, each about 120 ms of one vCPU and 512 MiB.
  const days = fraction * 30;
  const requests = Math.round(60_000 * days);
  const rows: readonly Row[] = [
    ["service_cpu", "service", "API vCPU time", "vCPU-s", requests * 0.12, [180_000, 0.000024]],
    ["service_memory", "service", "API memory time", "GiB-s", requests * 0.06, [360_000, 0.0000025]],
    ["service_requests", "service", "API requests", "requests", requests, [2_000_000, 0.4 / 1_000_000]],
    ["service_egress", "service", "API data sent", "GiB", (requests * 9_000) / GIB, [0, 0.12]],
    ["service_billable", "service", "API billable instance time", "s", requests * 0.15, null],
    ["job_cpu", "job", "Drain job vCPU time", "vCPU-s", days * 720 * 9, [240_000, 0.000018]],
    ["job_memory", "job", "Drain job memory time", "GiB-s", days * 720 * 4.5, [450_000, 0.000002]],
    ["job_billable", "job", "Drain job billable time", "s", days * 720 * 9, null],
    ["job_runs", "job", "Drain job runs", "runs", Math.round(days * 720), null],
  ];
  const items: C.CostItem[] = rows.map(([key, resource, label, unit, used, billed]) => {
    const forecastUsed = used / fraction;
    const over = (amount: number) => (billed === null ? 0 : Math.max(0, amount - billed[0]) * billed[1]);
    return {
      key,
      provider: "cloud_run",
      resource,
      label,
      unit,
      used,
      forecast_used: forecastUsed,
      free: billed?.[0] ?? null,
      free_left: billed === null ? null : Math.max(0, billed[0] - used),
      unit_price_usd: billed?.[1] ?? null,
      cost_usd: over(used),
      forecast_usd: over(forecastUsed),
      note: billed === null ? "Context only; billed through vCPU and memory time" : key === "service_egress" ? "Everything the API sends, priced as internet egress" : null,
    };
  });
  const limit = 500 * 1024 * 1024;
  const dbBytes = 180_000_000;
  items.push(
    {
      key: "supabase_db",
      provider: "supabase",
      resource: "database",
      label: "Supabase database size",
      unit: "bytes",
      used: dbBytes,
      forecast_used: null,
      free: limit,
      free_left: limit - dbBytes,
      unit_price_usd: null,
      cost_usd: 0,
      forecast_usd: 0,
      note: "Free plan: the size now against the plan's limit",
    },
    {
      key: "cloudflare",
      provider: "cloudflare",
      resource: "edge",
      label: "Cloudflare (DNS, Workers, Pages)",
      unit: "requests",
      used: null,
      forecast_used: null,
      free: null,
      free_left: null,
      unit_price_usd: null,
      cost_usd: 0,
      forecast_usd: 0,
      note: "Free plan; usage isn't read here (Workers: 100,000 requests a day)",
    },
  );
  const total = items.reduce((sum, item) => sum + item.cost_usd, 0);
  const forecast = items.reduce((sum, item) => sum + item.forecast_usd, 0);
  return {
    generated_at: now.toISOString(),
    period_start: start.toISOString(),
    period_end: now.toISOString(),
    elapsed_fraction: fraction,
    source: "cloud_monitoring",
    error: null,
    items,
    total_usd: total,
    forecast_usd: forecast,
    inr_per_usd: INR_PER_USD,
    gst_percent: GST_PERCENT,
    total_inr: total * INR_PER_USD,
    total_gst_inr: (total * INR_PER_USD * GST_PERCENT) / 100,
    forecast_inr: forecast * INR_PER_USD,
    forecast_gst_inr: (forecast * INR_PER_USD * GST_PERCENT) / 100,
    label: "Estimate — this project only; the free tier is shared across the billing account",
    billing_url: "https://console.cloud.google.com/billing",
  };
}
