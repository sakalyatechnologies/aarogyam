/** Synthetic test results for the console's Quality page. No patient data, ever. */

import type * as C from "../contract.js";
import { fakeUuid, type Random } from "./random.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface SuitePlan {
  suite: C.TestSuite;
  environment: C.QualityEnvironment;
  /** Tests (or canary steps) per day. */
  daily: number;
  /** Typical share that fails. */
  failRate: number;
  lastStatus: C.RunStatus;
  hoursAgo: number;
}

const PLANS: readonly SuitePlan[] = [
  { suite: "unit", environment: "ci", daily: 412, failRate: 0, lastStatus: "passed", hoursAgo: 1 },
  { suite: "integration", environment: "ci", daily: 138, failRate: 0.004, lastStatus: "passed", hoursAgo: 1 },
  { suite: "e2e_web", environment: "staging", daily: 46, failRate: 0.03, lastStatus: "failed", hoursAgo: 3 },
  { suite: "e2e_mobile", environment: "staging", daily: 31, failRate: 0.02, lastStatus: "passed", hoursAgo: 5 },
  { suite: "canary", environment: "staging", daily: 384, failRate: 0.005, lastStatus: "passed", hoursAgo: 0.2 },
  { suite: "canary", environment: "production", daily: 384, failRate: 0.002, lastStatus: "passed", hoursAgo: 0.1 },
  { suite: "load", environment: "staging", daily: 6, failRate: 0, lastStatus: "running", hoursAgo: 0.3 },
];

export function createQualityReport(random: Random, now: Date): C.QualityReport {
  const suites = PLANS.map((plan): C.QualitySuiteStatus => {
    const trend = Array.from({ length: 14 }, (_, index): C.QualityDay => {
      const day = new Date(now.getTime() - (13 - index) * DAY).toISOString().slice(0, 10);
      const total = Math.max(1, plan.daily + random.int(-Math.ceil(plan.daily * 0.05), Math.ceil(plan.daily * 0.05)));
      const failures = plan.failRate === 0 ? 0 : random.int(0, Math.ceil(total * plan.failRate * 2));
      return { day, total, passed: total - failures };
    });
    const startedAt = new Date(now.getTime() - plan.hoursAgo * HOUR);
    const total = plan.suite === "canary" ? 4 : plan.daily;
    const failed = plan.lastStatus === "failed" ? 2 : 0;
    const flaky = plan.suite === "integration" || plan.suite === "e2e_web" ? 1 : 0;
    const skipped = plan.suite === "e2e_mobile" ? 2 : 0;
    const finished = plan.lastStatus !== "running";
    return {
      suite: plan.suite,
      environment: plan.environment,
      last_run: {
        id: fakeUuid(random, startedAt),
        status: plan.lastStatus,
        started_at: startedAt.toISOString(),
        finished_at: finished ? new Date(startedAt.getTime() + random.int(40, 900) * 1000).toISOString() : null,
        total,
        passed: finished ? total - failed - skipped : 0,
        failed,
        skipped,
        flaky,
        commit_sha: random.hex(40),
        run_url: plan.environment === "ci" ? "https://github.com/sakalyatechnologies/aarogyam/actions" : null,
      },
      trend,
    };
  });

  const flakyTests: C.FlakyTest[] = [
    {
      test_name: "patients::search::recent_first_when_query_is_empty",
      suite: "integration",
      environment: "ci",
      flaky_runs: 3,
      total_runs: 61,
      last_seen_at: new Date(now.getTime() - 5 * HOUR).toISOString(),
    },
    {
      test_name: "portal › new patient › maps API field errors",
      suite: "e2e_web",
      environment: "staging",
      flaky_runs: 2,
      total_runs: 28,
      last_seen_at: new Date(now.getTime() - 27 * HOUR).toISOString(),
    },
    {
      test_name: "canary › book_appointment",
      suite: "canary",
      environment: "production",
      flaky_runs: 4,
      total_runs: 1344,
      last_seen_at: new Date(now.getTime() - 9 * HOUR).toISOString(),
    },
  ];

  const failure = (hoursAgo: number, plan: Pick<C.FailingRequest, "suite" | "environment" | "test_name" | "error_message">): C.FailingRequest => {
    const failedAt = new Date(now.getTime() - hoursAgo * HOUR);
    return { request_id: fakeUuid(random, failedAt), failed_at: failedAt.toISOString(), ...plan };
  };

  return {
    generated_at: now.toISOString(),
    suites,
    flaky_tests: flakyTests,
    failing_requests: [
      failure(3, {
        suite: "e2e_web",
        environment: "staging",
        test_name: "portal › today › shows the queue",
        error_message: "GET /api/v1/today returned 503 (upstream timeout)",
      }),
      failure(3.1, {
        suite: "e2e_web",
        environment: "staging",
        test_name: "portal › patients › opens Patient 360",
        error_message: "GET /api/v1/patients/{id} returned 500",
      }),
      failure(9, {
        suite: "canary",
        environment: "production",
        test_name: "canary › book_appointment",
        error_message: "POST /api/v1/appointments took 4.2 s (limit 3 s)",
      }),
      failure(30, {
        suite: "canary",
        environment: "staging",
        test_name: "canary › issue_bill",
        error_message: "POST /api/v1/invoices returned 409 (sequence busy)",
      }),
    ],
  };
}
