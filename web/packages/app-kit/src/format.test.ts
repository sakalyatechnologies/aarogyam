import { describe, expect, it } from "vitest";

import { formatBytes, formatMs, formatNumber, formatPercent, formatRelative, formatRupees, formatTime } from "./index.js";

describe("format", () => {
  it("groups digits the Indian way and shows rupees from paise", () => {
    expect(formatNumber(1234567)).toBe("12,34,567");
    expect(formatRupees(2_850_000)).toBe("₹28,500");
    expect(formatRupees(2_850_050)).toBe("₹28,500.50");
  });

  it("formats rates, sizes and latencies for the health dashboard", () => {
    expect(formatPercent(0.9982, 2)).toBe("99.82%");
    expect(formatBytes(2_791_728_742)).toBe("2.6 GB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatMs(38.4)).toBe("38 ms");
    expect(formatMs(1840)).toBe("1.84 s");
  });

  it("measures relative time from a given now and shows clinic-local times", () => {
    const now = "2026-10-03T05:30:00Z";
    expect(formatRelative("2026-10-03T05:25:00Z", now)).toBe("5 min ago");
    expect(formatRelative("2026-10-03T02:30:00Z", now)).toBe("3 hr ago");
    expect(formatRelative(now, now)).toBe("just now");
    expect(formatTime(now, "Asia/Kolkata")).toBe("11:00 am");
  });
});
