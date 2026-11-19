/** The Database tab: the drain job's samples over time, then the database as it is now. */

import { Database } from "lucide-react";

import type { DbInsights, MetricsRange } from "@aarogyam/api-client";
import { ApiErrorNotice, DEFAULT_TIME_ZONE, formatBytes, formatMs, formatNumber, formatPercent } from "@aarogyam/app-kit";
import { Card, DataTable, type DataTableColumn } from "@sakalya/ui";

import { useDbInsights } from "../../api.js";
import { ChartCard, LoadingCharts, RANGE_WORDS, Stat, one, xAxis } from "./insight-parts.js";
import { timeFormatter } from "./metrics-view.js";

const TITLES = ["Connections", "Database size", "Cache hit ratio", "Transactions per minute", "Rows per minute", "Deadlocks and spills"] as const;

const MB = 1024 * 1024;

export function DatabaseTab({ range }: { range: MetricsRange }) {
  const insights = useDbInsights(range);
  if (insights.isPending) {
    return <LoadingCharts titles={TITLES} label="Loading the database" />;
  }
  if (insights.isError) {
    return <ApiErrorNotice title="Couldn't load the database history" error={insights.error} onRetry={() => void insights.refetch()} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <DatabaseCharts insights={insights.data} range={range} />
      <DatabaseNow db={insights.data.current} limitBytes={insights.data.size_limit_bytes} />
    </div>
  );
}

function DatabaseCharts({ insights, range }: { insights: DbInsights; range: MetricsRange }) {
  const samples = insights.samples;
  const words = RANGE_WORDS[range];
  const x = xAxis(
    samples.map((s) => Date.parse(s.at)),
    timeFormatter(range, DEFAULT_TIME_ZONE),
    "Time (IST)",
    `No samples in ${words} yet: the outbox job takes one at most every 5 minutes.`,
  );
  const limit = samples.at(-1)?.max_connections ?? insights.current.connections_max;
  const perMin = (value: number) => one.format(value);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartCard
        {...x}
        title="Connections"
        note="The most connections open at once in each interval, against the database's limit."
        yLabel="Connections"
        formatY={perMin}
        series={[{ id: "connections", label: "Connections", values: samples.map((s) => s.connections), color: "var(--sk-chart-1)" }]}
        reference={{ value: limit, label: `Limit ${String(limit)}`, color: "var(--sk-danger)" }}
        summary={`Open connections over ${words}, against a limit of ${String(limit)}.`}
      />
      <ChartCard
        {...x}
        title="Database size"
        note="Everything stored, against the plan's limit; the free plan stops writes when it is full."
        yLabel="Size (MB)"
        formatY={perMin}
        series={[{ id: "size", label: "Size", values: samples.map((s) => s.db_bytes / MB), color: "var(--sk-chart-1)" }]}
        reference={{ value: insights.size_limit_bytes / MB, label: `Plan limit ${formatBytes(insights.size_limit_bytes)}`, color: "var(--sk-danger)" }}
        summary={`Database size in MB over ${words}, against the plan limit of ${formatBytes(insights.size_limit_bytes)}.`}
      />
      <ChartCard
        {...x}
        title="Cache hit ratio"
        note="Share of reads served from memory; below 99% the database is reading from disk more than it should."
        yLabel="Cache hit ratio (%)"
        formatY={(value) => `${one.format(value)}%`}
        series={[{ id: "cache", label: "Cache hit ratio", values: samples.map((s) => (s.cache_hit_ratio === null ? null : s.cache_hit_ratio * 100)), color: "var(--sk-chart-3)" }]}
        reference={{ value: 99, label: "Target 99%", color: "var(--sk-success)" }}
        summary={`Cache hit ratio over ${words}, against a 99% target.`}
      />
      <ChartCard
        {...x}
        title="Transactions per minute"
        note="Committed and rolled-back transactions; rollbacks are failed or cancelled work."
        yLabel="Transactions per minute"
        formatY={perMin}
        series={[
          { id: "commits", label: "Commits", values: samples.map((s) => s.commits_per_min), color: "var(--sk-chart-1)" },
          { id: "rollbacks", label: "Rollbacks", values: samples.map((s) => s.rollbacks_per_min), color: "var(--sk-danger)", dash: "7 4" },
        ]}
        summary={`Commits and rollbacks per minute over ${words}.`}
      />
      <ChartCard
        {...x}
        title="Rows per minute"
        note="Rows read and rows inserted, updated or deleted: how hard the database works."
        yLabel="Rows per minute"
        formatY={(value) => formatNumber(Math.round(value))}
        series={[
          { id: "read", label: "Read", values: samples.map((s) => s.rows_read_per_min), color: "var(--sk-chart-1)" },
          { id: "written", label: "Written", values: samples.map((s) => s.rows_written_per_min), color: "var(--sk-warning)", dash: "7 4" },
        ]}
        summary={`Rows read and written per minute over ${words}.`}
      />
      <ChartCard
        {...x}
        title="Deadlocks and spills"
        note="Deadlocks (should stay at zero) and megabytes of sorts or joins that spilled to disk."
        yLabel="Count / MB"
        formatY={perMin}
        series={[
          { id: "deadlocks", label: "Deadlocks", values: samples.map((s) => s.deadlocks), color: "var(--sk-danger)" },
          { id: "temp", label: "Spilled to disk (MB)", values: samples.map((s) => s.temp_bytes / MB), color: "var(--sk-info)", dash: "2 3" },
        ]}
        summary={`Deadlocks and temporary-file megabytes per interval over ${words}.`}
      />
    </div>
  );
}

type Db = DbInsights["current"];

const QUERY_COLUMNS: readonly DataTableColumn<Db["slow_queries"][number]>[] = [
  {
    id: "query",
    header: "Statement",
    cell: (row) => <span className="font-mono text-xs break-all">{row.query ?? row.query_id}</span>,
  },
  { id: "mean", header: "Mean", align: "end", cell: (row) => formatMs(row.mean_ms), sortValue: (row) => row.mean_ms },
  { id: "calls", header: "Calls", align: "end", cell: (row) => formatNumber(row.calls), sortValue: (row) => row.calls },
  { id: "total", header: "Total", align: "end", cell: (row) => formatMs(row.total_ms), sortValue: (row) => row.total_ms },
];

const TABLE_COLUMNS: readonly DataTableColumn<Db["tables"][number]>[] = [
  { id: "name", header: "Table", cell: (row) => <span className="font-mono text-xs">{row.name}</span>, sortValue: (row) => row.name },
  { id: "dead", header: "Dead rows", align: "end", cell: (row) => formatNumber(row.dead_rows), sortValue: (row) => row.dead_rows },
  { id: "live", header: "Live rows", align: "end", cell: (row) => formatNumber(row.live_rows), sortValue: (row) => row.live_rows },
  { id: "size", header: "Size", align: "end", cell: (row) => formatBytes(row.size_bytes), sortValue: (row) => row.size_bytes },
];

export function DatabaseNow({ db, limitBytes }: { db: Db; limitBytes?: number }) {
  const used = db.connections_max === 0 ? 0 : db.connections_used / db.connections_max;
  return (
    <Card title="Database now" action={<Database aria-hidden="true" className="size-5 text-muted" />}>
      <dl className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Connections" value={`${String(db.connections_used)} of ${String(db.connections_max)}`} note={<span className="text-xs text-muted">{formatPercent(used)} in use</span>} />
        <Stat label="Cache hit ratio" value={formatPercent(db.cache_hit_ratio, 2)} />
        <Stat
          label="Database size"
          value={formatBytes(db.size_bytes)}
          note={limitBytes === undefined ? undefined : <span className="text-xs text-muted">{formatPercent(db.size_bytes / limitBytes)} of the plan</span>}
        />
      </dl>
      <h3 className="mb-2 text-sm font-bold text-text">Slowest statements</h3>
      <p className="mb-2 text-xs text-muted">Reads and writes only, with values replaced by $1, $2 …; other statements are left out because they can carry values.</p>
      <DataTable
        caption="Slowest statements by mean time"
        columns={QUERY_COLUMNS}
        rows={db.slow_queries}
        rowKey={(row) => row.query_id}
        defaultSort={{ columnId: "mean", direction: "descending" }}
        pageSize={5}
      />
      <h3 className="mt-5 mb-2 text-sm font-bold text-text">Tables with the most dead rows</h3>
      <DataTable
        caption="Tables by dead rows"
        columns={TABLE_COLUMNS}
        rows={db.tables}
        rowKey={(row) => row.name}
        defaultSort={{ columnId: "dead", direction: "descending" }}
        pageSize={6}
      />
    </Card>
  );
}
