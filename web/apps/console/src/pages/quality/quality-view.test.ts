import { describe, expect, it } from "vitest";

import { qualityRunId, type QualityRun } from "@aarogyam/api-client";

import { excerpt, findFlaky, runTotals } from "./quality-view.js";

function run(index: number, suites: Record<string, string[]>): QualityRun {
  return {
    run_id: qualityRunId.parse(`r${String(index)}`),
    started_at: new Date(Date.UTC(2026, 9, 1, index)).toISOString(),
    finished_at: new Date(Date.UTC(2026, 9, 1, index, 5)).toISOString(),
    environment: "local",
    commit: "abc1234",
    suites: Object.entries(suites).map(([name, failing]) => ({
      name,
      kind: "web",
      passed: 10,
      failed: failing.length,
      skipped: 1,
      duration_ms: 1000,
      failures: failing.map((test) => ({ test, message: `${test} broke` })),
    })),
  };
}

describe("findFlaky", () => {
  it("lists a test that failed, passed and failed again", () => {
    const runs = [run(0, { web: [] }), run(1, { web: ["a"] }), run(2, { web: [] }), run(3, { web: ["a"] })];
    expect(findFlaky(runs)).toEqual([{ suite: "web", test: "a", failedRuns: 2, totalRuns: 4, flips: 3, lastMessage: "a broke" }]);
  });

  it("does not list a test that failed once and stayed fixed, or one that always fails", () => {
    const fixed = [run(0, { web: ["a", "b"] }), run(1, { web: ["b"] }), run(2, { web: ["b"] })];
    expect(findFlaky(fixed)).toEqual([]);
  });

  it("ignores runs that did not include the suite", () => {
    const runs = [run(0, { web: ["a"] }), run(1, { other: [] }), run(2, { web: [] }), run(3, { web: ["a"] })];
    expect(findFlaky(runs).map((f) => f.totalRuns)).toEqual([3]);
  });
});

describe("helpers", () => {
  it("sums a run's suites", () => {
    expect(runTotals(run(0, { a: ["x"], b: [] }))).toEqual({ passed: 20, failed: 1, skipped: 2, durationMs: 2000 });
  });
  it("cuts a failure to its first line", () => {
    expect(excerpt("line one\nline two")).toBe("line one");
    expect(excerpt("x".repeat(200), 10)).toBe("xxxxxxxxx…");
  });
});
