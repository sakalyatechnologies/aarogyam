import { afterEach, describe, expect, it, vi } from "vitest";

import { addMonths, monthWeeks } from "./time.js";
import { clockLabel, gridHours, nowMinutes, offsetPercent, packColumns, placementOf, scrollTopToCentre } from "./time-grid.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(["UTC", "America/Los_Angeles", "Asia/Kolkata"])("clinic-time placement with the browser in %s", (browserZone) => {
  it("puts 13:15 IST at 1:15 pm whatever the browser's zone", () => {
    vi.stubEnv("TZ", browserZone);
    // 07:45 UTC is 13:15 in Kolkata.
    const p = placementOf("2026-10-03T07:45:00Z", "2026-10-03T08:15:00Z", "Asia/Kolkata");
    expect(p).toEqual({ date: "2026-10-03", startMin: 13 * 60 + 15, endMin: 13 * 60 + 45 });
    expect(clockLabel(p.startMin)).toBe("1:15 pm");
    expect(Math.floor(p.startMin / 60)).toBe(13);
  });

  it("uses the clinic's date near midnight", () => {
    vi.stubEnv("TZ", browserZone);
    // 19:00 UTC on the 2nd is 00:30 IST on the 3rd.
    expect(placementOf("2026-10-02T19:00:00Z", "2026-10-02T19:30:00Z", "Asia/Kolkata").date).toBe("2026-10-03");
    expect(nowMinutes("2026-10-02T19:00:00Z", "Asia/Kolkata")).toEqual({ date: "2026-10-03", minutes: 30 });
  });
});

describe("grid maths", () => {
  it("labels hours in 12-hour time", () => {
    expect([0, 8 * 60, 12 * 60, 13 * 60, 21 * 60 + 30].map(clockLabel)).toEqual(["12 am", "8 am", "12 pm", "1 pm", "9:30 pm"]);
  });

  it("defaults to 8-21 and extends to include early and late visits", () => {
    expect(gridHours([])).toEqual({ start: 8, end: 21 });
    expect(gridHours([{ startMin: 7 * 60 + 30, endMin: 8 * 60 }, { startMin: 21 * 60 + 30, endMin: 22 * 60 + 10 }])).toEqual({ start: 7, end: 23 });
  });

  it("gives zero-length visits 15 minutes and caps at midnight", () => {
    expect(placementOf("2026-10-03T04:30:00Z", "2026-10-03T04:30:00Z", "UTC").endMin).toBe(4 * 60 + 45);
    expect(placementOf("2026-10-03T23:30:00Z", "2026-10-04T01:00:00Z", "UTC").endMin).toBe(1440);
  });

  it("offsets by percentage of the visible range", () => {
    expect(offsetPercent(13 * 60, 8, 18)).toBe(50);
  });

  it("packs overlapping events side by side and lets later ones reuse columns", () => {
    const packed = packColumns([
      { id: "a", startMin: 600, endMin: 660 },
      { id: "b", startMin: 615, endMin: 700 },
      { id: "c", startMin: 665, endMin: 700 },
      { id: "d", startMin: 800, endMin: 830 },
    ]);
    const by = Object.fromEntries(packed.map((p) => [p.item.id, [p.column, p.columns]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });
});

describe("month maths", () => {
  it("adds months landing on the 1st", () => {
    expect(addMonths("2026-10-31", 1)).toBe("2026-11-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("builds Monday-first weeks covering the month", () => {
    const weeks = monthWeeks("2026-10-03");
    expect(weeks[0]?.[0]).toBe("2026-09-28");
    expect(weeks.at(-1)?.[6]).toBe("2026-11-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
});

describe("scrolling to now", () => {
  it("centres the marker and never scrolls above the top", () => {
    expect(scrollTopToCentre({ top: 100, height: 300 }, { top: 700, height: 20 }, 50)).toBe(50 + 600 - 150 + 10);
    expect(scrollTopToCentre({ top: 100, height: 300 }, { top: 120, height: 20 }, 0)).toBe(0);
  });
});
