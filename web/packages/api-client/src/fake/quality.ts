/** Synthetic quality runs for the console's Quality page, shaped like `scripts/quality-run.sh`'s
 * real output. No patient data, ever. */

import type * as C from "../contract.js";
import { fakeUuid, type Random } from "./random.js";

const HOUR = 3_600_000;

interface SuitePlan {
  name: string;
  kind: string;
  total: number;
  /** Typical share that fails, 0 to 1. */
  failRate: number;
}

const PLANS: readonly SuitePlan[] = [
  { name: "aarogyam workspace (unit)", kind: "unit", total: 180, failRate: 0 },
  { name: "aarogyam workspace (database)", kind: "db", total: 70, failRate: 0 },
  { name: "web packages (vitest)", kind: "web", total: 130, failRate: 0.01 },
  { name: "golden journey (Playwright)", kind: "e2e", total: 4, failRate: 0.1 },
];

/** 14 runs, six hours apart, newest last (oldest first), each with a run-specific id. */
export function createQualityReport(random: Random, now: Date): C.QualityReport {
  const runs: C.QualityRun[] = Array.from({ length: 14 }, (_, index) => {
    const startedAt = new Date(now.getTime() - (13 - index) * 6 * HOUR);
    const finishedAt = new Date(startedAt.getTime() + random.int(60, 400) * 1000);
    const runId = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const suites: C.QualitySuite[] = PLANS.map((plan) => {
      const failed = random.chance(plan.failRate) ? random.int(1, 3) : 0;
      const skipped = plan.kind === "db" && index < 2 ? plan.total : random.int(0, 2);
      const passed = Math.max(0, plan.total - failed - skipped);
      const failures: C.QualityFailure[] =
        failed === 0
          ? []
          : Array.from({ length: failed }, (_, n) => ({
              test: `${plan.name} › case ${String(n + 1)}`,
              message: "assertion failed (synthetic, for the gallery)",
            }));
      return { name: plan.name, kind: plan.kind, passed, failed, skipped, duration_ms: random.int(500, 60_000), failures };
    });
    return {
      run_id: runId,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      environment: "local",
      commit: fakeUuid(random, startedAt).slice(0, 7),
      suites,
    };
  });

  const newestFirst = [...runs].reverse();

  const trend: C.QualityTrend[] = PLANS.map((plan) => ({
    name: plan.name,
    kind: plan.kind,
    points: runs.map((run) => {
      const suite = run.suites.find((s) => s.name === plan.name);
      const graded = (suite?.passed ?? 0) + (suite?.failed ?? 0);
      return { run_id: run.run_id, started_at: run.started_at, pass_rate: graded === 0 ? 1 : (suite?.passed ?? 0) / graded };
    }),
  }));

  const latest = newestFirst[0];
  const failing: C.QualityFailingTest[] =
    latest === undefined
      ? []
      : latest.suites.flatMap((suite) => suite.failures.map((failure) => ({ suite: suite.name, run_id: latest.run_id, ...failure })));

  return { runs: newestFirst, trend, failing };
}
