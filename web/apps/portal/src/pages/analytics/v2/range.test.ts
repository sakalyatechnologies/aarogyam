import { describe, expect, it } from "vitest";

import { bucketFor, customProblem, expenseWindow, windowLabel, windowOf } from "./range.js";

describe("analytics ranges", () => {
  const today = "2026-11-17";

  it("ends every preset today, by day up to a month, by week up to three, then by month", () => {
    expect(windowOf("1d", today)).toEqual({ from: today, to: today, days: 1, bucket: "day" });
    expect(windowOf("3d", today)).toMatchObject({ from: "2026-11-15", days: 3, bucket: "day" });
    expect(windowOf("7d", today)).toMatchObject({ from: "2026-11-11", days: 7, bucket: "day" });
    expect(windowOf("1m", today)).toMatchObject({ from: "2026-10-18", days: 31, bucket: "day" });
    expect(windowOf("3m", today)).toMatchObject({ from: "2026-08-18", bucket: "week" });
    expect(windowOf("6m", today)).toMatchObject({ from: "2026-05-18", bucket: "month" });
    expect(windowOf("12m", today)).toMatchObject({ from: "2025-11-18", bucket: "month" });
    expect([bucketFor(31), bucketFor(32), bucketFor(92), bucketFor(93)]).toEqual(["day", "week", "week", "month"]);
  });

  it("clamps a month back to the shorter month's end", () => {
    expect(windowOf("1m", "2026-03-31").from).toBe("2026-03-01");
  });

  it("uses a valid custom range and falls back to 6 months otherwise", () => {
    expect(windowOf("custom", today, { from: "2026-10-01", to: "2026-10-31" })).toMatchObject({ days: 31, bucket: "day" });
    expect(windowOf("custom", today, { from: "2026-10-31", to: "2026-10-01" })).toEqual(windowOf("6m", today));
    expect(customProblem("", today, today)).toMatch(/start and an end/);
    expect(customProblem(today, today, today)).toBeUndefined();
    expect(customProblem("2026-11-01", "2026-11-18", today)).toMatch(/after today/);
    expect(customProblem("2025-01-01", "2026-11-17", today)).toMatch(/at most a year/);
  });

  it("labels the window and cuts the expense list to six weeks", () => {
    expect(windowLabel(windowOf("1d", today))).toBe("17 Nov 2026");
    expect(windowLabel(windowOf("12m", today))).toBe("18 Nov 2025 – 17 Nov 2026");
    expect(expenseWindow(windowOf("6m", today))).toEqual({ from: "2026-10-07", to: today });
    expect(expenseWindow(windowOf("7d", today))).toEqual({ from: "2026-11-11", to: today });
  });
});
