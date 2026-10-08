import { describe, expect, it } from "vitest";

import { analytics, type Analytics } from "@aarogyam/api-client";

import { busyGrid, isEmpty, periodEnd, periodRows, rangeStart, totals } from "./analytics-data.js";

const report: Analytics = analytics.parse({
  from: "2026-09-01",
  to: "2026-10-03",
  bucket: "month",
  open_minutes_per_day: 540,
  money_visible: true,
  chairs: [{ id: "c1", name: "Chair 1" }],
  buckets: [
    {
      start: "2026-09-01",
      first_day: "2026-09-01",
      last_day: "2026-09-30",
      chair_utilization: [{ room_id: "c1", booked_minutes: 8100, open_minutes: 16200, appointments: 200, utilization_bps: 5000 }],
      income_paise: 100_000,
      payments: 3,
      expenses_paise: 40_000,
      expenses: [{ category: "rent", amount_paise: 40_000 }],
      stock_purchases_paise: 0,
      patients: { new: 2, returning: 5 },
    },
    {
      start: "2026-10-01",
      first_day: "2026-10-01",
      last_day: "2026-10-03",
      chair_utilization: [{ room_id: "c1", booked_minutes: 1620, open_minutes: 1620, appointments: 40, utilization_bps: 10000 }],
      income_paise: 50_000,
      payments: 1,
      expenses_paise: 0,
      expenses: [],
      stock_purchases_paise: 0,
      patients: { new: 0, returning: 1 },
    },
  ],
  patients: { age_bands: [], visit_kinds: [], referral_sources: [] },
  busy_hours: [
    { weekday: 1, hour: 10, visits: 8 },
    { weekday: 6, hour: 12, visits: 2 },
  ],
});

describe("analytics data", () => {
  it("starts ranges on whole months and finds period ends", () => {
    expect(rangeStart("2026-10-08", 12)).toBe("2025-11-01");
    expect(rangeStart("2026-03-31", 3)).toBe("2026-01-01");
    expect(periodEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(periodEnd("2026-10-05", "week")).toBe("2026-10-11");
  });

  it("shapes rows in rupees and percent, marking a period cut short", () => {
    const rows = periodRows(report);
    expect(rows.map((r) => r.tip)).toEqual(["Sept", "Oct (so far)"]);
    expect(rows[0]).toMatchObject({ income: 1000, expenses: 400, rent: 400, salary: 0, chair0: 50, newPatients: 2 });
  });

  it("totals money and chair use across periods", () => {
    expect(totals(report)).toEqual({ incomePaise: 150_000, expensesPaise: 40_000, netPaise: 110_000, chairUse: 9720 / 17820, patients: 8 });
    expect(isEmpty(report)).toBe(false);
  });

  it("grades busy hours into five steps", () => {
    const grid = busyGrid(report);
    expect(grid.hours).toEqual([10, 11, 12]);
    expect(grid.rows[0]?.cells.map((c) => c.level)).toEqual([4, 0, 0]);
    expect(grid.rows[5]?.cells.map((c) => c.level)).toEqual([0, 0, 1]);
  });
});
