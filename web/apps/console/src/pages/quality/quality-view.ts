/** Pure helpers behind the Quality page. */

import type { QualityReport, QualityRun } from "@aarogyam/api-client";

export interface FlakyTest {
  suite: string;
  test: string;
  /** Runs (of those that included the suite) in which it failed. */
  failedRuns: number;
  /** Runs that included the suite. */
  totalRuns: number;
  /** Times it switched between passing and failing, oldest to newest. */
  flips: number;
  lastMessage: string;
}

/**
 * Tests that both passed and failed across the recent runs and flipped at least twice: a test
 * that failed once and stayed fixed is a regression that was repaired, not a flake. Runs record
 * only failures, so "passed" means the suite ran and the test was not in its failures.
 */
export function findFlaky(runs: readonly QualityRun[]): FlakyTest[] {
  const oldestFirst = [...runs].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const seen = new Map<string, { suite: string; test: string }>();
  for (const run of oldestFirst) {
    for (const suite of run.suites) {
      for (const failure of suite.failures) {
        seen.set(`${suite.name}\u0000${failure.test}`, { suite: suite.name, test: failure.test });
      }
    }
  }
  const flaky: FlakyTest[] = [];
  for (const { suite, test } of seen.values()) {
    const history: boolean[] = [];
    let lastMessage = "";
    for (const run of oldestFirst) {
      const ran = run.suites.find((s) => s.name === suite);
      if (ran === undefined) {
        continue;
      }
      const failure = ran.failures.find((f) => f.test === test);
      history.push(failure !== undefined);
      if (failure !== undefined) {
        lastMessage = failure.message;
      }
    }
    const failedRuns = history.filter(Boolean).length;
    const flips = history.filter((failed, index) => index > 0 && failed !== history[index - 1]).length;
    if (failedRuns > 0 && failedRuns < history.length && flips >= 2) {
      flaky.push({ suite, test, failedRuns, totalRuns: history.length, flips, lastMessage });
    }
  }
  return flaky.sort((a, b) => b.flips - a.flips || a.suite.localeCompare(b.suite) || a.test.localeCompare(b.test));
}

export interface TrendView {
  /** Epoch ms of each run, oldest first. */
  times: number[];
  /** One pass-rate series (0 to 100) per suite; `null` where the suite was not in that run. */
  series: { id: string; label: string; values: (number | null)[] }[];
}

/** One line per suite across the runs, from the report's per-suite trends. */
export function trendView(report: QualityReport): TrendView {
  const runs = [...report.runs].sort((a, b) => a.started_at.localeCompare(b.started_at));
  return {
    times: runs.map((run) => Date.parse(run.started_at)),
    series: report.trend.map((trend) => {
      const byRun = new Map(trend.points.map((point) => [point.run_id, point.pass_rate * 100]));
      return { id: trend.name, label: trend.name, values: runs.map((run) => byRun.get(run.run_id) ?? null) };
    }),
  };
}

/** The first line of a failure, cut to `max` characters, for a table cell. */
export function excerpt(message: string, max = 140): string {
  const line = message.trim().split("\n", 1)[0] ?? "";
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export interface RunTotals {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export function runTotals(run: QualityRun): RunTotals {
  return run.suites.reduce(
    (sum, suite) => ({
      passed: sum.passed + suite.passed,
      failed: sum.failed + suite.failed,
      skipped: sum.skipped + suite.skipped,
      durationMs: sum.durationMs + suite.duration_ms,
    }),
    { passed: 0, failed: 0, skipped: 0, durationMs: 0 },
  );
}
