import { describe, expect, it } from "vitest";

import { splitRange } from "./date-range.js";

describe("splitRange", () => {
  it("keeps a short range whole", () => {
    expect(splitRange({ from: "2026-10-01", to: "2026-10-31" })).toEqual([{ from: "2026-10-01", to: "2026-10-31" }]);
  });
  it("cuts 90 days into pieces of at most 31 dates, without gaps or overlap", () => {
    const pieces = splitRange({ from: "2026-10-01", to: "2026-12-30" });
    expect(pieces).toEqual([
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2026-11-01", to: "2026-12-01" },
      { from: "2026-12-02", to: "2026-12-30" },
    ]);
  });
  it("gives nothing for a backwards range", () => {
    expect(splitRange({ from: "2026-10-02", to: "2026-10-01" })).toEqual([]);
  });
});
