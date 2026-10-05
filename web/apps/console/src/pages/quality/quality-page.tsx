import { Check, ClipboardList, Copy, GitCommit, Shuffle, Timer } from "lucide-react";
import { useState } from "react";

import type { QualityFailingTest, QualityReport, QualityRun, QualitySuite } from "@aarogyam/api-client";
import { ApiErrorNotice, DEFAULT_TIME_ZONE, formatDateTime, formatMs, formatNumber, formatPercent, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, EmptyState, LineChart, PageHeader, Skeleton, type DataTableColumn } from "@sakalya/ui";

import { useQuality } from "../../api.js";
import { StatusChip } from "../../ui/status-chip.js";
import { Tile } from "../../ui/tile.js";
import { excerpt, findFlaky, runTotals, trendView, type FlakyTest } from "./quality-view.js";

const COMMAND = "scripts/quality-run.sh [environment]";

/** Service: status per suite, the pass-rate trend, flaky and failing tests, run history, how to record one. */
export function QualityPage() {
  useDocumentTitle("Quality", "Sakalya Console");
  const quality = useQuality();

  return (
    <>
      <PageHeader title="Quality" subtitle="Test suites, recorded by scripts/quality-run.sh" />
      {quality.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading quality runs">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} shape="block" />
          ))}
        </div>
      ) : quality.isError ? (
        <ApiErrorNotice title="Couldn't load quality runs" error={quality.error} onRetry={() => void quality.refetch()} />
      ) : (
        <QualityBody report={quality.data} />
      )}
    </>
  );
}

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded-lg bg-surface-muted px-3 py-2 font-mono text-sm text-text">{COMMAND}</code>
      <Button
        variant="secondary"
        icon={copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
        onClick={() => {
          void navigator.clipboard.writeText(COMMAND).then(() => {
            setCopied(true);
          }, () => undefined);
        }}
      >
        {copied ? "Copied" : "Copy command"}
      </Button>
    </div>
  );
}

function HowToRecord() {
  return (
    <div className="flex flex-col gap-3 text-sm text-muted">
      <CopyCommand />
      <p>Run it from the repository root. It records three kinds of suite, each timed and kept as data even when it fails:</p>
      <ul className="list-disc pl-5">
        <li>
          <strong className="text-text">Rust workspace:</strong> unit tests, then the database tests when Postgres answers on localhost.
        </li>
        <li>
          <strong className="text-text">Web packages:</strong> the vitest suite of the console, portal and shared packages.
        </li>
        <li>
          <strong className="text-text">Golden journey:</strong> the Playwright end-to-end suite, when the local dev stack is up.
        </li>
      </ul>
      <p>
        It writes one summary to <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-text">var/quality/&lt;run_id&gt;.json</code>
        , which this page reads. That folder sits outside the patient database on purpose and becomes a GCS bucket or BigQuery dataset once
        deployed. Run it a few times to see the pass-rate trend and flaky tests.
      </p>
    </div>
  );
}

function SuiteTile({ suite, run }: { suite: QualitySuite; run: QualityRun }) {
  const graded = suite.passed + suite.failed;
  const failing = suite.failed > 0;
  return (
    <Tile
      label={`${suite.name} · ${suite.kind}`}
      tone={failing ? "danger" : "success"}
      value={graded === 0 ? "—" : formatPercent(suite.passed / graded)}
      note={
        <div className="flex flex-col gap-1.5">
          <StatusChip tone={failing ? "danger" : "success"}>{failing ? `${String(suite.failed)} failing` : "Passing"}</StatusChip>
          <p>
            <span className="font-semibold text-text">{formatNumber(suite.passed)}</span> passed ·{" "}
            <span className="font-semibold text-text">{formatNumber(suite.failed)}</span> failed ·{" "}
            <span className="font-semibold text-text">{formatNumber(suite.skipped)}</span> skipped
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1">
              <Timer aria-hidden="true" className="size-3.5" />
              {formatMs(suite.duration_ms)}
            </span>
            <span className="inline-flex items-center gap-1">
              <GitCommit aria-hidden="true" className="size-3.5" />
              <span className="font-mono">{run.commit}</span>
            </span>
          </p>
          <p>Last run {formatDateTime(run.started_at)}</p>
        </div>
      }
    />
  );
}

function QualityBody({ report }: { report: QualityReport }) {
  const latest = report.runs[0];

  if (latest === undefined) {
    return (
      <Card>
        <EmptyState
          title="No runs recorded yet"
          description="Nothing has been recorded. Run the script below, then refresh this page."
          icon={<ClipboardList className="size-7" />}
        />
        <div className="mx-auto mt-2 max-w-2xl">
          <HowToRecord />
        </div>
      </Card>
    );
  }

  const trend = trendView(report);
  const flaky = findFlaky(report.runs);
  const trendWords = `Pass rate of each suite across the last ${String(report.runs.length)} recorded runs.`;
  const clock = new Intl.DateTimeFormat("en-IN", { timeZone: DEFAULT_TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {latest.suites.map((suite) => (
          <SuiteTile key={suite.name} suite={suite} run={latest} />
        ))}
      </div>

      <Card title="Pass rate over time">
        <LineChart
          times={trend.times}
          series={trend.series}
          formatX={(time) => clock.format(new Date(time))}
          formatY={(value) => `${String(Math.round(value))}%`}
          formatValue={(value) => `${value.toFixed(1)}%`}
          xLabel="Run started"
          yLabel="Pass rate (% of graded tests)"
          summary={trendWords}
          emptyMessage="Not enough runs to draw a trend."
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Failing now">
          {report.failing.length === 0 ? (
            <EmptyState title="Nothing failing in the newest run" description={`Run ${latest.run_id} passed every graded test.`} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Tests failing in the newest run">
              {report.failing.map((failure) => (
                <FailureItem key={`${failure.suite}:${failure.test}`} failure={failure} />
              ))}
            </ul>
          )}
        </Card>
        <Card title="Flaky tests" action={<Shuffle aria-hidden="true" className="size-5 text-muted" />}>
          {flaky.length === 0 ? (
            <EmptyState
              title="No flaky tests"
              description="A test shows here when it passed and failed, back and forth, across the recent runs."
            />
          ) : (
            <DataTable
              caption="Tests that both passed and failed across recent runs"
              columns={FLAKY_COLUMNS}
              rows={flaky}
              rowKey={(row) => `${row.suite}:${row.test}`}
              pageSize={8}
            />
          )}
        </Card>
      </div>

      <Card title="Run history">
        <DataTable
          caption="Recorded quality runs, newest first"
          columns={RUN_COLUMNS}
          rows={report.runs}
          rowKey={(row) => row.run_id}
          defaultSort={{ columnId: "started_at", direction: "descending" }}
          pageSize={10}
        />
      </Card>

      <Card title="How to record a run">
        <HowToRecord />
      </Card>
    </div>
  );
}

function FailureItem({ failure }: { failure: QualityFailingTest }) {
  const short = excerpt(failure.message);
  const long = failure.message.trim() !== short;
  return (
    <li className="rounded-xl border border-border bg-surface-muted px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone="danger">Failing</StatusChip>
        <span className="text-xs text-muted">{failure.suite}</span>
      </div>
      <p className="mt-1.5 font-mono text-xs font-semibold break-words text-text">{failure.test}</p>
      {long ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-sm text-danger-text">{short}</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-surface p-3 font-mono text-xs whitespace-pre-wrap text-text">{failure.message}</pre>
        </details>
      ) : (
        <p className="mt-1 text-sm text-danger-text">{short}</p>
      )}
    </li>
  );
}

const FLAKY_COLUMNS: readonly DataTableColumn<FlakyTest>[] = [
  {
    id: "test",
    header: "Test",
    cell: (row) => (
      <span className="flex flex-col">
        <span className="font-mono text-xs font-semibold break-words">{row.test}</span>
        <span className="text-xs text-muted">{row.suite}</span>
      </span>
    ),
    sortValue: (row) => row.test,
  },
  {
    id: "failed",
    header: "Failed in",
    align: "end",
    cell: (row) => `${String(row.failedRuns)} of ${String(row.totalRuns)} runs`,
    sortValue: (row) => row.failedRuns / row.totalRuns,
  },
  { id: "flips", header: "Flips", align: "end", cell: (row) => String(row.flips), sortValue: (row) => row.flips },
];

const RUN_COLUMNS: readonly DataTableColumn<QualityRun>[] = [
  {
    id: "result",
    header: "Result",
    cell: (row) => {
      const failed = runTotals(row).failed;
      return <StatusChip tone={failed === 0 ? "success" : "danger"}>{failed === 0 ? "Passed" : `${String(failed)} failed`}</StatusChip>;
    },
    sortValue: (row) => runTotals(row).failed,
  },
  { id: "started_at", header: "Started", cell: (row) => formatDateTime(row.started_at), sortValue: (row) => row.started_at },
  { id: "environment", header: "Environment", cell: (row) => row.environment },
  { id: "commit", header: "Commit", cell: (row) => <span className="font-mono text-xs">{row.commit}</span> },
  { id: "passed", header: "Passed", align: "end", cell: (row) => formatNumber(runTotals(row).passed), sortValue: (row) => runTotals(row).passed },
  { id: "failed", header: "Failed", align: "end", cell: (row) => formatNumber(runTotals(row).failed), sortValue: (row) => runTotals(row).failed },
  { id: "skipped", header: "Skipped", align: "end", cell: (row) => formatNumber(runTotals(row).skipped), sortValue: (row) => runTotals(row).skipped },
  { id: "duration", header: "Duration", align: "end", cell: (row) => formatMs(runTotals(row).durationMs), sortValue: (row) => runTotals(row).durationMs },
];
