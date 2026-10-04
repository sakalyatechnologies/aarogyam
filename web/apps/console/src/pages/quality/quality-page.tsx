import { AlertTriangle, CheckCircle2, ClipboardList, OctagonAlert } from "lucide-react";

import type { QualityFailingTest, QualityReport, QualityRun, QualitySuite } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, formatMs, formatPercent, useDocumentTitle } from "@aarogyam/app-kit";
import { BarChart, Card, DataTable, EmptyState, PageHeader, Pill, Skeleton, type DataTableColumn, type Tone } from "@sakalya/ui";

import { useQuality } from "../../api.js";

function suiteTone(suite: QualitySuite | undefined): Tone {
  if (suite === undefined) {
    return "neutral";
  }
  return suite.failed === 0 ? "success" : "danger";
}

/** Service: status per suite, a pass-rate trend, latest failures, run history, how to record one. */
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

function QualityBody({ report }: { report: QualityReport }) {
  const latest = report.runs[0];

  if (latest === undefined) {
    return (
      <Card>
        <EmptyState
          title="No runs recorded yet"
          description="Record one with scripts/quality-run.sh [environment]; it writes to var/quality, which this page reads."
          icon={<ClipboardList className="size-7" />}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {report.trend.map((trend) => {
          const suite = latest.suites.find((s) => s.name === trend.name);
          const tone = suiteTone(suite);
          const last = trend.points.at(-1);
          return (
            <Card key={trend.name} title={trend.name}>
              <div className="flex items-center justify-between gap-3">
                <Pill
                  tone={tone}
                  icon={tone === "success" ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <OctagonAlert aria-hidden="true" className="size-3.5" />}
                >
                  {suite === undefined ? "Not in this run" : tone === "success" ? "Passing" : `${String(suite.failed)} failing`}
                </Pill>
                <span className="text-xs text-muted">{trend.kind}</span>
              </div>
              <p className="mt-3 text-2xl font-extrabold tracking-tight text-text">
                {last === undefined ? "—" : formatPercent(last.pass_rate)}
              </p>
              {suite === undefined ? null : (
                <p className="text-xs text-muted">
                  {suite.passed} passed · {suite.failed} failed · {suite.skipped} skipped · {formatMs(suite.duration_ms)}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {report.trend.map((trend) => (
          <Card key={trend.name} title={`${trend.name}: pass rate`}>
            <BarChart
              data={trend.points.map((point) => ({
                label: formatDateTime(point.started_at).slice(0, 11),
                total: 100,
                part: Math.round(point.pass_rate * 100),
              }))}
              totalLabel="Runs"
              partLabel="Pass rate %"
              categoryLabel="Run"
              summary={`${trend.name}'s pass rate across its last ${String(trend.points.length)} recorded runs.`}
            />
          </Card>
        ))}
      </div>

      <Card title="Latest failures">
        {report.failing.length === 0 ? (
          <EmptyState title="Nothing failing in the newest run" icon={<CheckCircle2 className="size-7" />} />
        ) : (
          <DataTable
            caption="Tests failing in the newest run"
            columns={FAILING_COLUMNS}
            rows={report.failing}
            rowKey={(row) => `${row.suite}:${row.test}`}
            pageSize={10}
          />
        )}
      </Card>

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
        <p className="text-sm text-muted">
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-text">scripts/quality-run.sh [environment]</code>{" "}
          runs the Rust workspace (unit, then database tests when Postgres answers locally), the web packages&apos; vitest suite, and the
          Playwright golden journey (when the local dev stack is up), then writes one summary to{" "}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-text">var/quality/&lt;run_id&gt;.json</code>, which
          this page reads. That directory sits outside the patient database on purpose; it becomes a GCS bucket or BigQuery dataset once
          deployed.
        </p>
      </Card>
    </div>
  );
}

const RUN_COLUMNS: readonly DataTableColumn<QualityRun>[] = [
  { id: "started_at", header: "Started", cell: (row) => formatDateTime(row.started_at), sortValue: (row) => row.started_at },
  { id: "environment", header: "Environment", cell: (row) => row.environment },
  { id: "commit", header: "Commit", cell: (row) => <span className="font-mono text-xs">{row.commit}</span> },
  {
    id: "suites",
    header: "Suites",
    cell: (row) => (
      <span className="flex flex-wrap gap-1">
        {row.suites.map((suite) => (
          <Pill key={suite.name} tone={suite.failed === 0 ? "success" : "danger"}>
            {suite.kind}
          </Pill>
        ))}
      </span>
    ),
  },
  {
    id: "totals",
    header: "Passed / failed / skipped",
    align: "end",
    cell: (row) => {
      const totals = row.suites.reduce(
        (sum, suite) => ({ passed: sum.passed + suite.passed, failed: sum.failed + suite.failed, skipped: sum.skipped + suite.skipped }),
        { passed: 0, failed: 0, skipped: 0 },
      );
      return `${String(totals.passed)} / ${String(totals.failed)} / ${String(totals.skipped)}`;
    },
  },
];

const FAILING_COLUMNS: readonly DataTableColumn<QualityFailingTest>[] = [
  { id: "suite", header: "Suite", cell: (row) => row.suite, sortValue: (row) => row.suite },
  { id: "test", header: "Test", cell: (row) => <span className="font-mono text-xs">{row.test}</span> },
  {
    id: "message",
    header: "Message",
    cell: (row) => (
      <span className="flex items-start gap-1.5 text-danger-text">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {row.message}
      </span>
    ),
  },
];
