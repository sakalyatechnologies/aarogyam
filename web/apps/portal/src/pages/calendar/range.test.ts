import { describe, expect, it } from "vitest";

import { visibleRange } from "./calendar-page.js";

const days = (r: { from: string; to: string }) => (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;

describe("visibleRange", () => {
  it("requests exactly the month grid, which can be six weeks", () => {
    // August 2026 starts on a Saturday and ends on a Monday: six Monday-first weeks.
    expect(visibleRange("month", "2026-08-15")).toEqual({ from: "2026-07-27", to: "2026-09-06" });
    expect(days(visibleRange("month", "2026-08-15"))).toBe(42);
  });

  it("never asks for more than the API's 42 days, in any month", () => {
    for (let m = 1; m <= 12; m++) {
      const range = visibleRange("month", `2026-${String(m).padStart(2, "0")}-10`);
      expect(days(range)).toBeLessThanOrEqual(42);
      expect(days(range) % 7).toBe(0);
    }
  });

  it("is a Monday-first week or a single day otherwise", () => {
    expect(visibleRange("week", "2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(visibleRange("day", "2026-10-07")).toEqual({ from: "2026-10-07", to: "2026-10-07" });
  });
});
