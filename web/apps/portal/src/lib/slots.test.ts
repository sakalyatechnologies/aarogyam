import { describe, expect, it } from "vitest";

import { formatHm, freeSlots, isoWeekday, parseHm, shiftsOn } from "./slots.js";

describe("slots", () => {
  it("parses and formats 24-hour times", () => {
    expect(parseHm("09:30")).toBe(570);
    expect(parseHm("24:00")).toBeNaN();
    expect(formatHm(570)).toBe("09:30");
  });

  it("numbers weekdays Monday 1 to Sunday 7", () => {
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(isoWeekday("2026-10-05")).toBe(1);
  });

  it("uses the weekday's shifts, a default day with no hours, and nothing on a day off", () => {
    expect(shiftsOn(undefined, "2026-10-05")).toEqual([{ startMin: 540, endMin: 1080 }]);
    const hours = [{ weekday: 1, starts: "10:00", ends: "12:00" }];
    expect(shiftsOn(hours, "2026-10-05")).toEqual([{ startMin: 600, endMin: 720 }]);
    expect(shiftsOn(hours, "2026-10-06")).toEqual([]);
  });

  it("skips busy spans, past times and slots that would overrun the shift", () => {
    const shifts = [{ startMin: 600, endMin: 720 }];
    expect(freeSlots({ shifts, busy: [{ startMin: 630, endMin: 660 }], duration: 30, step: 30 })).toEqual([600, 660, 690]);
    expect(freeSlots({ shifts, busy: [], duration: 60, step: 30, notBefore: 615 })).toEqual([630, 660]);
  });
});
