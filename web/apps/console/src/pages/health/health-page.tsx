import { AlertTriangle, CheckCircle2, Clock3, Database, Gauge, Globe, OctagonAlert, Server, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";

import { metricsRange, type Metrics, type MetricsRange } from "@aarogyam/api-client";
import {
  ApiErrorNotice,
  DEFAULT_TIME_ZONE,
  formatBytes,
  formatMs,
  formatNumber,
  formatPercent,
  formatTime,
  useDocumentTitle,
} from "@aarogyam/app-kit";
import { Card, DataTable, EmptyState, LineChart, PageHeader, Pill, RadioGroup, Skeleton, StatCard, type DataTableColumn } from "@sakalya/ui";

import { useMetrics } from "../../api.js";
import {
  HEALTH_TONE,
  P95_BUDGET_MS,
  RANGE_MINUTES,
  clsHealth,
  inpHealth,
  latencyHealth,
  lcpHealth,
  serverErrorHealth,
  successHealth,
  timeFormatter,
  timelineView,
  type Health,
} from "./metrics-view.js";

const RANGES = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
] as const;

const RANGE_WORDS: Readonly<Record<MetricsRange, string>> = {
  "1h": "the last hour",
  "6h": "the last 6 hours",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
};

function HealthNote({ health, children }: { health: Health; children: ReactNode }) {
  const Icon = health === "good" ? CheckCircle2 : health === "watch" ? AlertTriangle : OctagonAlert;
  return (
    <Pill tone={HEALTH_TONE[health]} icon={<Icon aria-hidden="true" className="size-3.5" />}>
      {children}
    </Pill>
  );
}

/** Service health: API traffic, errors and latency, the database, and the edge. */
export function HealthPage() {
  useDocumentTitle("Service health", "Sakalya Console");
  const [params, setParams] = useSearchParams();
  const range = metricsRange.catch("1h").parse(params.get("range"));
  const metrics = useMetrics(range);

  return (
    <>
      <PageHeader
        title="Service health"
        subtitle="API, database and edge for Aarogyam"
        end={
          metrics.data === undefined ? null : (
            <p role="status" className="text-sm text-muted">
              {metrics.isFetching ? "Updating…" : `Updated ${formatTime(metrics.data.generated_at)}`}
            </p>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-4 rounded-card border border-border bg-surface px-5 py-4 shadow-card">
        <RadioGroup
          label="Time range"
          orientation="horizontal"
          options={RANGES}
          value={range}
          onValueChange={(value) => {
            setParams({ range: value }, { replace: true });
          }}
        />
      </div>
      {metrics.isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label="Loading service health">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} shape="block" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {CHARTS.map((chart) => (
              <Card key={chart.title} title={chart.title}>
                <LineChart loading times={[]} series={[]} summary="" xLabel="Time" yLabel={chart.title} formatX={String} />
              </Card>
            ))}
          </div>
        </div>
      ) : metrics.isError ? (
        <ApiErrorNotice title="Couldn't load service health" error={metrics.error} onRetry={() => void metrics.refetch()} />
      ) : (
        <HealthBody metrics={metrics.data} range={range} />
      )}
    </>
  );
}

function HealthBody({ metrics, range }: { metrics: Metrics; range: MetricsRange }) {
  const { api } = metrics;
  const perMinute = api.requests / RANGE_MINUTES[range];
  const success = successHealth(api.success_rate);
  const serverErrors = serverErrorHealth(api.rate_5xx);
  const p95 = latencyHealth(api.p95_ms);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Requests per minute"
          value={perMinute < 10 ? perMinute.toFixed(1) : formatNumber(perMinute)}
          icon={<Server className="size-7" />}
          footer={<p className="text-xs text-muted">{formatNumber(api.requests)} in {RANGE_WORDS[range]}</p>}
        />
        <StatCard
          label="Success rate"
          value={formatPercent(api.success_rate, 2)}
          tone={HEALTH_TONE[success]}
          icon={<CheckCircle2 className="size-7" />}
          footer={<HealthNote health={success}>{success === "good" ? "At or above 99.5%" : "Below the 99.5% target"}</HealthNote>}
        />
        <StatCard
          label="Client errors (4xx)"
          value={formatPercent(api.rate_4xx, 2)}
          tone="neutral"
          icon={<AlertTriangle className="size-7" />}
          footer={<p className="text-xs text-muted">Bad input, expired sessions, missing records</p>}
        />
        <StatCard
          label="Server errors (5xx)"
          value={formatPercent(api.rate_5xx, 2)}
          tone={HEALTH_TONE[serverErrors]}
          icon={<OctagonAlert className="size-7" />}
          footer={<HealthNote health={serverErrors}>{serverErrors === "good" ? "Under 0.1%" : "Above the 0.1% target"}</HealthNote>}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Latency p50" value={formatMs(api.p50_ms)} tone="neutral" icon={<Timer className="size-7" />} />
        <StatCard
          label="Latency p95"
          value={formatMs(api.p95_ms)}
          tone={HEALTH_TONE[p95]}
          icon={<Gauge className="size-7" />}
          footer={<HealthNote health={p95}>{p95 === "good" ? `Within ${String(P95_BUDGET_MS)} ms budget` : `Over ${String(P95_BUDGET_MS)} ms budget`}</HealthNote>}
        />
        <StatCard label="Latency p99" value={formatMs(api.p99_ms)} tone="neutral" icon={<Clock3 className="size-7" />} />
      </div>

      <TrafficCharts api={api} range={range} />

      <Card title="Routes by traffic">
        <DataTable
          caption="API routes by traffic"
          columns={ROUTE_COLUMNS}
          rows={api.routes}
          rowKey={(row) => `${row.method} ${row.route}`}
          defaultSort={{ columnId: "requests", direction: "descending" }}
          pageSize={10}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DatabasePanel db={metrics.db} />
        <EdgePanel edge={metrics.edge} />
      </div>
    </div>
  );
}

const CHARTS = [
  { title: "Requests per minute", unit: "requests per minute" },
  { title: "Errors per minute", unit: "errors per minute" },
  { title: "Error rate", unit: "% of requests" },
  { title: "Errors by class", unit: "errors per minute" },
  { title: "Latency", unit: "milliseconds" },
] as const;

const one = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const rateOf = (value: number) => `${one.format(value)}%`;
const msOf = (value: number) => `${one.format(value)} ms`;
const perMin = (value: number) => (value < 10 ? one.format(Math.round(value * 10) / 10) : formatNumber(Math.round(value)));

/** The time-series charts: traffic, failures (total, rate and by class) and latency against its budget. */
function TrafficCharts({ api, range }: { api: Metrics["api"]; range: MetricsRange }) {
  const view = timelineView(api);
  const formatX = timeFormatter(range, DEFAULT_TIME_ZONE);
  const words = RANGE_WORDS[range];
  const empty = view.total === 0 ? `No requests in ${words} yet.` : undefined;
  const times = empty === undefined ? view.times : [];
  const common = { times, formatX, xLabel: "Time (IST)", ...(empty === undefined ? {} : { emptyMessage: empty }) };
  const peak = Math.max(0, ...view.requests);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Requests per minute">
        <LineChart
          {...common}
          yLabel="Requests per minute"
          formatY={perMin}
          series={[{ id: "requests", label: "Requests", values: view.requests, color: "var(--sk-chart-1)" }]}
          summary={`Requests per minute over ${words}; the busiest minute averaged ${perMin(peak)} requests.`}
        />
      </Card>
      <Card title="Errors per minute">
        <p className="mb-2 text-xs text-muted">Server errors (5xx) and throttled requests (429), the failures that count against the success rate.</p>
        <LineChart
          {...common}
          yLabel="Errors per minute"
          formatY={perMin}
          series={[{ id: "errors", label: "Errors", values: view.errors, color: "var(--sk-danger)" }]}
          summary={`Errors per minute over ${words}.`}
        />
      </Card>
      <Card title="Error rate">
        <LineChart
          {...common}
          yLabel="Error rate (% of requests)"
          formatY={rateOf}
          series={[{ id: "rate", label: "Error rate", values: view.errorRate, color: "var(--sk-danger)", dash: "7 4" }]}
          reference={{ value: 0.5, label: "Target: under 0.5%", color: "var(--sk-success)" }}
          summary={`Share of requests that failed over ${words}, against a 0.5% target.`}
        />
      </Card>
      <Card title="Errors by class">
        <p className="mb-2 text-xs text-muted">Client errors (4xx) are bad input, expired sessions or missing records; 429 means a caller was throttled.</p>
        <LineChart
          {...common}
          yLabel="Errors per minute"
          formatY={perMin}
          series={[
            { id: "4xx", label: "4xx client errors", values: view.errors4xx, color: "var(--sk-warning)", dash: "7 4" },
            { id: "5xx", label: "5xx server errors", values: view.errors5xx, color: "var(--sk-danger)" },
            { id: "429", label: "429 throttled", values: view.errors429, color: "var(--sk-info)", dash: "2 3" },
          ]}
          summary={`Errors per minute over ${words}, split into 4xx client errors, 5xx server errors and 429 throttled requests.`}
        />
      </Card>
      <div className="xl:col-span-2">
        <Card title="Latency">
          <LineChart
            {...common}
            height={240}
            yLabel="Latency (ms)"
            formatY={(value) => one.format(value)}
            formatValue={msOf}
            series={[
              { id: "p50", label: "p50 (median)", values: view.p50, color: "var(--sk-chart-3)", dash: "2 3" },
              { id: "p95", label: "p95", values: view.p95, color: "var(--sk-chart-1)" },
              { id: "p99", label: "p99", values: view.p99, color: "var(--sk-info)", dash: "7 4" },
            ]}
            reference={{ value: P95_BUDGET_MS, label: `p95 budget ${String(P95_BUDGET_MS)} ms`, color: "var(--sk-danger)" }}
            summary={`Request latency percentiles over ${words}, against the ${String(P95_BUDGET_MS)} ms p95 budget.`}
          />
        </Card>
      </div>
    </div>
  );
}

type RouteRow = Metrics["api"]["routes"][number];

const ROUTE_COLUMNS: readonly DataTableColumn<RouteRow>[] = [
  {
    id: "route",
    header: "Route",
    cell: (row) => (
      <span className="font-mono text-xs">
        <span className="font-semibold text-primary-text">{row.method}</span> {row.route}
      </span>
    ),
    sortValue: (row) => row.route,
  },
  { id: "requests", header: "Requests", align: "end", cell: (row) => formatNumber(row.requests), sortValue: (row) => row.requests },
  { id: "errors", header: "Error rate", align: "end", cell: (row) => formatPercent(row.error_rate, 2), sortValue: (row) => row.error_rate },
  { id: "p95", header: "p95", align: "end", cell: (row) => formatMs(row.p95_ms), sortValue: (row) => row.p95_ms },
  { id: "p99", header: "p99", align: "end", cell: (row) => formatMs(row.p99_ms), sortValue: (row) => row.p99_ms },
];

function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="text-xl font-extrabold tracking-tight text-text">{value}</dd>
      {note === undefined ? null : <dd>{note}</dd>}
    </div>
  );
}

type Db = Metrics["db"];

const QUERY_COLUMNS: readonly DataTableColumn<Db["slow_queries"][number]>[] = [
  { id: "query", header: "Query ID", cell: (row) => <span className="font-mono text-xs">{row.query_id}</span> },
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

function DatabasePanel({ db }: { db: Db }) {
  const used = db.connections_max === 0 ? 0 : db.connections_used / db.connections_max;
  return (
    <Card title="Database" action={<Database aria-hidden="true" className="size-5 text-muted" />}>
      <dl className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Connections" value={`${String(db.connections_used)} of ${String(db.connections_max)}`} note={<span className="text-xs text-muted">{formatPercent(used)} in use</span>} />
        <Stat label="Cache hit ratio" value={formatPercent(db.cache_hit_ratio, 2)} />
        <Stat label="Database size" value={formatBytes(db.size_bytes)} />
      </dl>
      <h3 className="mb-2 text-sm font-bold text-text">Slowest queries</h3>
      <DataTable
        caption="Slowest queries by mean time"
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

function EdgePanel({ edge }: { edge: Metrics["edge"] }) {
  if (edge === null) {
    return (
      <Card title="Frontend and edge">
        <EmptyState
          title="Not connected yet"
          description="Cloudflare traffic and Core Web Vitals will show here once the analytics feed is connected."
          icon={<Globe className="size-7" />}
        />
      </Card>
    );
  }
  const vitals = [
    { label: "LCP p75", value: formatMs(edge.lcp_p75_ms), health: lcpHealth(edge.lcp_p75_ms), target: "Good up to 2.5 s" },
    { label: "INP p75", value: formatMs(edge.inp_p75_ms), health: inpHealth(edge.inp_p75_ms), target: "Good up to 200 ms" },
    { label: "CLS p75", value: edge.cls_p75.toFixed(2), health: clsHealth(edge.cls_p75), target: "Good up to 0.1" },
  ];
  const words: Readonly<Record<Health, string>> = { good: "Good", watch: "Needs improvement", bad: "Poor" };
  return (
    <Card title="Frontend and edge" action={<Globe aria-hidden="true" className="size-5 text-muted" />}>
      <dl className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Edge requests" value={formatNumber(edge.requests)} />
        <Stat label="Edge 4xx" value={formatPercent(edge.rate_4xx, 2)} />
        <Stat label="Edge 5xx" value={formatPercent(edge.rate_5xx, 2)} />
        <Stat label="Worker CPU p95" value={formatMs(edge.cpu_p95_ms)} />
        <Stat label="Page views" value={formatNumber(edge.page_views)} />
      </dl>
      <h3 className="mb-2 text-sm font-bold text-text">Core Web Vitals</h3>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {vitals.map((vital) => (
          <Stat
            key={vital.label}
            label={vital.label}
            value={vital.value}
            note={
              <span className="flex flex-col items-start gap-1">
                <HealthNote health={vital.health}>{words[vital.health]}</HealthNote>
                <span className="text-xs text-muted">{vital.target}</span>
              </span>
            }
          />
        ))}
      </dl>
    </Card>
  );
}
