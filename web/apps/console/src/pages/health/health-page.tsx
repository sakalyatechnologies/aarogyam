import { AlertTriangle, CheckCircle2, Clock3, Cloud, Database, Gauge, Globe, IndianRupee, OctagonAlert, Server, Timer, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";

import { metricsRange, type CloudMetrics, type Metrics, type MetricsRange } from "@aarogyam/api-client";
import { ApiErrorNotice, DEFAULT_TIME_ZONE, formatBytes, formatMs, formatNumber, formatPercent, formatTime, useDocumentTitle } from "@aarogyam/app-kit";
import { Card, DataTable, EmptyState, LineChart, PageHeader, Pill, RadioGroup, StatCard, Tabs, type DataTableColumn } from "@sakalya/ui";

import { useMetrics, useUsageInsights } from "../../api.js";
import { DatabaseTab } from "./database-tab.js";
import { FrontEndTab } from "./frontend-tab.js";
import { ChartCard, LoadingCharts, RANGE_WORDS, one, xAxis } from "./insight-parts.js";
import {
  HEALTH_TONE,
  P95_BUDGET_MS,
  RANGE_MINUTES,
  alignPoints,
  latencyHealth,
  perMinuteOf,
  serverErrorHealth,
  successHealth,
  timeFormatter,
  timelineView,
  type Health,
} from "./metrics-view.js";
import { UsageTab } from "./usage-tab.js";
import { DurableRoutes } from "./routes-section.js";

const RANGES = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
] as const;

const TABS = ["overview", "api", "database", "frontend", "usage", "cost"] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab === value);

function HealthNote({ health, children }: { health: Health; children: ReactNode }) {
  const Icon = health === "good" ? CheckCircle2 : health === "watch" ? AlertTriangle : OctagonAlert;
  return (
    <Pill tone={HEALTH_TONE[health]} icon={<Icon aria-hidden="true" className="size-3.5" />}>
      {children}
    </Pill>
  );
}

/** Insights: the service, the database and how clinics use the product, one range for every tab. */
export function HealthPage() {
  useDocumentTitle("Insights", "Sakalya Console");
  const [params, setParams] = useSearchParams();
  const range = metricsRange.catch("1h").parse(params.get("range"));
  const tabParam = params.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "overview";
  const metrics = useMetrics(range);
  const go = (next: { tab?: Tab; range?: MetricsRange }) => {
    setParams({ tab: next.tab ?? tab, range: next.range ?? range }, { replace: true });
  };
  const link = (to: Tab) => `/health?tab=${to}&range=${range}`;

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Service, database and clinic usage for Aarogyam"
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
            go({ range: metricsRange.catch(range).parse(value) });
          }}
        />
      </div>
      <Tabs<Tab>
        label="Insights"
        value={tab}
        onValueChange={(value) => {
          go({ tab: value });
        }}
        items={[
          { value: "overview", label: "Overview", content: <OverviewTab metrics={metrics} range={range} link={link} /> },
          { value: "api", label: "API", content: <ApiTab metrics={metrics} range={range} /> },
          { value: "database", label: "Database", content: <DatabaseTab range={range} /> },
          {
            value: "frontend",
            label: "Front end",
            content: <FrontEndTab range={range} />,
          },
          { value: "usage", label: "Usage", content: <UsageTab range={range} /> },
          {
            value: "cost",
            label: "Cost",
            content: <ComingSoon title="Cost coming soon" description="An estimate of this month's Cloud Run cost for the API and the outbox job, after the free tier." icon={<IndianRupee className="size-7" />} />,
          },
        ]}
      />
    </>
  );
}

function ComingSoon({ title, description, icon }: { title: string; description: string; icon: ReactNode }) {
  return (
    <Card>
      <EmptyState title={title} description={description} icon={icon} />
    </Card>
  );
}

type MetricsQuery = ReturnType<typeof useMetrics>;

/** Says where the service numbers come from. */
function SourceNote({ metrics }: { metrics: Metrics }) {
  return metrics.source === "cloud_monitoring" ? (
    <Pill tone="success" icon={<Cloud aria-hidden="true" className="size-3.5" />}>
      Source: Cloud Monitoring
    </Pill>
  ) : (
    <span className="flex flex-wrap items-center gap-2">
      <Pill tone="warning" icon={<Server aria-hidden="true" className="size-3.5" />}>
        This instance only
      </Pill>
      <span className="text-xs text-muted">
        {metrics.cloud_error === null ? "Numbers since this instance started; Cloud Run scales to zero, so they reset." : `Cloud Monitoring could not be read (${metrics.cloud_error}).`}
      </span>
    </span>
  );
}

function OverviewTab({ metrics, range, link }: { metrics: MetricsQuery; range: MetricsRange; link: (tab: Tab) => string }) {
  const usage = useUsageInsights(range);
  if (metrics.isPending) {
    return <LoadingCharts titles={[]} label="Loading the overview" />;
  }
  if (metrics.isError) {
    return <ApiErrorNotice title="Couldn't load the overview" error={metrics.error} onRetry={() => void metrics.refetch()} />;
  }
  const { api, db } = metrics.data;
  const success = successHealth(api.success_rate);
  const visits = usage.data?.days.reduce((sum, day) => sum + day.visits, 0);
  const usageWords = range === "7d" || range === "30d" ? RANGE_WORDS[range] : "yesterday";
  return (
    <div className="flex flex-col gap-4">
      <SourceNote metrics={metrics.data} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="API success rate"
          value={formatPercent(api.success_rate, 2)}
          tone={HEALTH_TONE[success]}
          icon={<CheckCircle2 className="size-7" />}
          href={link("api")}
          footer={<p className="text-xs text-muted">{formatNumber(api.requests)} requests in {RANGE_WORDS[range]} · p95 {formatMs(api.p95_ms)}</p>}
        />
        <StatCard
          label="Database size"
          value={formatBytes(db.size_bytes)}
          tone="neutral"
          icon={<Database className="size-7" />}
          href={link("database")}
          footer={<p className="text-xs text-muted">{`${String(db.connections_used)} of ${String(db.connections_max)} connections · cache ${formatPercent(db.cache_hit_ratio, 1)}`}</p>}
        />
        <StatCard
          label="Visits"
          value={visits === undefined ? "—" : formatNumber(visits)}
          tone="neutral"
          icon={<Users className="size-7" />}
          href={link("usage")}
          footer={<p className="text-xs text-muted">{usage.isError ? "Couldn't load usage" : `All clinics, ${usageWords}`}</p>}
        />
        <StatCard label="Front end" value="Coming soon" tone="neutral" icon={<Globe className="size-7" />} href={link("frontend")} />
        <StatCard label="Cost" value="Coming soon" tone="neutral" icon={<IndianRupee className="size-7" />} href={link("cost")} />
      </div>
    </div>
  );
}

function ApiTab({ metrics, range }: { metrics: MetricsQuery; range: MetricsRange }) {
  if (metrics.isPending) {
    return <LoadingCharts titles={CHARTS.map((chart) => chart.title)} label="Loading service health" />;
  }
  if (metrics.isError) {
    return <ApiErrorNotice title="Couldn't load service health" error={metrics.error} onRetry={() => void metrics.refetch()} />;
  }
  const { cloud } = metrics.data;
  return (
    <div className="flex flex-col gap-4">
      <SourceNote metrics={metrics.data} />
      {cloud === null ? null : <CloudCharts cloud={cloud} range={range} />}
      {cloud === null ? null : (
        <div>
          <h2 className="text-lg font-bold tracking-tight text-text">This instance</h2>
          <p className="text-xs text-muted">The instance that answered, since it started. Routes from every instance are below.</p>
        </div>
      )}
      <InstanceBody api={metrics.data.api} range={range} />
      <DurableRoutes range={range} />
    </div>
  );
}

/** Cloud Run's charts: every instance and revision of the API, and the outbox job. */
function CloudCharts({ cloud, range }: { cloud: CloudMetrics; range: MetricsRange }) {
  const words = RANGE_WORDS[range];
  const formatX = timeFormatter(range, DEFAULT_TIME_ZONE);
  const perMinute = perMinuteOf(cloud.interval_seconds);
  const empty = `Cloud Run recorded nothing in ${words}.`;
  const { service, job } = cloud;
  const requests = alignPoints(service.requests.map((series) => series.points));
  const latency = alignPoints([service.latency_p50_ms, service.latency_p95_ms, service.latency_p99_ms]);
  const instances = alignPoints([service.instances, service.cold_starts]);
  const usage = alignPoints([service.cpu_p95, service.memory_p95]);
  const executions = alignPoints(job.executions.map((series) => series.points));
  const jobTime = alignPoints([job.billable_seconds, job.cpu_seconds]);
  const colors: Readonly<Record<string, string>> = { "2xx": "var(--sk-chart-1)", "3xx": "var(--sk-chart-3)", "4xx": "var(--sk-warning)", "5xx": "var(--sk-danger)", succeeded: "var(--sk-success)", failed: "var(--sk-danger)" };
  const count = (value: number) => formatNumber(Math.round(value));
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartCard
        {...xAxis(requests.times, formatX, "Time (IST)", empty)}
        title="Requests by class"
        note="Requests per minute across every instance, by response class; 5xx are the service's failures."
        yLabel="Requests per minute"
        formatY={(value) => one.format(value)}
        series={service.requests.map((series, index) => ({
          id: series.label,
          label: series.label,
          values: (requests.values[index] ?? []).map(perMinute),
          color: colors[series.label] ?? "var(--sk-info)",
        }))}
        summary={`Requests per minute by response class over ${words}, all instances.`}
      />
      <ChartCard
        {...xAxis(latency.times, formatX, "Time (IST)", empty)}
        title="Latency, all instances"
        note="How long Cloud Run took to answer, including cold starts the instance itself never sees."
        yLabel="Latency (ms)"
        formatY={(value) => one.format(value)}
        formatValue={(value) => `${one.format(value)} ms`}
        series={[
          { id: "p50", label: "p50", values: latency.values[0] ?? [], color: "var(--sk-chart-3)", dash: "2 3" },
          { id: "p95", label: "p95", values: latency.values[1] ?? [], color: "var(--sk-chart-1)" },
          { id: "p99", label: "p99", values: latency.values[2] ?? [], color: "var(--sk-info)", dash: "7 4" },
        ]}
        reference={{ value: P95_BUDGET_MS, label: `p95 budget ${String(P95_BUDGET_MS)} ms`, color: "var(--sk-danger)" }}
        summary={`Latency percentiles over ${words}, all instances.`}
      />
      <ChartCard
        {...xAxis(instances.times, formatX, "Time (IST)", empty)}
        title="Instances and cold starts"
        note="Instances running (0 when idle) and how many started cold; each cold start makes one request slow."
        yLabel="Instances / starts"
        formatY={count}
        series={[
          { id: "instances", label: "Instances", values: instances.values[0] ?? [], color: "var(--sk-chart-1)" },
          { id: "cold", label: "Cold starts", values: instances.values[1] ?? [], color: "var(--sk-warning)", dash: "7 4" },
        ]}
        summary={`Running instances and cold starts over ${words}.`}
      />
      <ChartCard
        {...xAxis(usage.times, formatX, "Time (IST)", empty)}
        title="CPU and memory"
        note="95th percentile use of each instance's CPU and memory; near 100% the service needs more."
        yLabel="Use (%)"
        formatY={(value) => `${one.format(value)}%`}
        series={[
          { id: "cpu", label: "CPU p95", values: (usage.values[0] ?? []).map((value) => (value === null ? null : value * 100)), color: "var(--sk-chart-1)" },
          { id: "memory", label: "Memory p95", values: (usage.values[1] ?? []).map((value) => (value === null ? null : value * 100)), color: "var(--sk-info)", dash: "7 4" },
        ]}
        summary={`CPU and memory use over ${words}.`}
      />
      <ChartCard
        {...xAxis(executions.times, formatX, "Time (IST)", `The outbox job did not run in ${words}.`)}
        title="Outbox job runs"
        note="Runs of the job that sends messages and does the daily work, started every 2 minutes; failed runs retry next time."
        yLabel="Runs"
        formatY={count}
        series={job.executions.map((series, index) => ({
          id: series.label,
          label: series.label,
          values: executions.values[index] ?? [],
          color: colors[series.label] ?? "var(--sk-info)",
        }))}
        summary={`Outbox job runs by result over ${words}.`}
      />
      <ChartCard
        {...xAxis(jobTime.times, formatX, "Time (IST)", `The outbox job did not run in ${words}.`)}
        title="Outbox job time"
        note="Seconds the job was billed and its vCPU seconds, per interval: what the job costs."
        yLabel="Seconds"
        formatY={count}
        series={[
          { id: "billable", label: "Billable seconds", values: jobTime.values[0] ?? [], color: "var(--sk-chart-1)" },
          { id: "cpu", label: "vCPU seconds", values: jobTime.values[1] ?? [], color: "var(--sk-warning)", dash: "7 4" },
        ]}
        summary={`Outbox job billable and vCPU seconds over ${words}.`}
      />
    </div>
  );
}

function InstanceBody({ api, range }: { api: Metrics["api"]; range: MetricsRange }) {
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
        <p className="mb-2 text-xs text-muted">How busy the API was, per minute.</p>
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
        <p className="mb-2 text-xs text-muted">Share of requests that failed, against the 0.5% target.</p>
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
          <p className="mb-2 text-xs text-muted">How long this instance took to answer, against the p95 budget.</p>
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
