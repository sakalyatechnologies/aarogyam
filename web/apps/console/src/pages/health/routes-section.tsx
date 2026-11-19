/** The API tab's durable routes: every instance's per-route counters, flushed each minute, by traffic, latency and errors. */

import type { DurableRoute, MetricsRange } from "@aarogyam/api-client";
import { ApiErrorNotice, formatMs, formatNumber, formatPercent } from "@aarogyam/app-kit";
import { Card, DataTable, Skeleton, type DataTableColumn } from "@sakalya/ui";

import { useRouteInsights } from "../../api.js";
import { RANGE_WORDS } from "./insight-parts.js";

const routeKey = (row: DurableRoute) => `${row.method} ${row.route}`;

const ROUTE_CELL: DataTableColumn<DurableRoute> = {
  id: "route",
  header: "Route",
  cell: (row) => (
    <span className="font-mono text-xs">
      <span className="font-semibold text-primary-text">{row.method}</span> {row.route}
    </span>
  ),
  sortValue: routeKey,
};

const TRAFFIC_COLUMNS: readonly DataTableColumn<DurableRoute>[] = [
  ROUTE_CELL,
  { id: "requests", header: "Requests", align: "end", cell: (row) => formatNumber(row.requests), sortValue: (row) => row.requests },
  { id: "p50", header: "p50", align: "end", cell: (row) => formatMs(row.p50_ms), sortValue: (row) => row.p50_ms },
  { id: "p95", header: "p95", align: "end", cell: (row) => formatMs(row.p95_ms), sortValue: (row) => row.p95_ms },
];

const ERROR_COLUMNS: readonly DataTableColumn<DurableRoute>[] = [
  ROUTE_CELL,
  { id: "failed", header: "5xx + 429", align: "end", cell: (row) => formatNumber(row.errors_5xx + row.errors_429), sortValue: (row) => row.errors_5xx + row.errors_429 },
  { id: "rate", header: "Error rate", align: "end", cell: (row) => formatPercent(row.error_rate, 2), sortValue: (row) => row.error_rate },
  { id: "client", header: "4xx", align: "end", cell: (row) => formatNumber(row.errors_4xx), sortValue: (row) => row.errors_4xx },
];

/** Routes from the durable counters: every instance, surviving scale to zero. */
export function DurableRoutes({ range }: { range: MetricsRange }) {
  const routes = useRouteInsights(range);
  if (routes.isPending) {
    return (
      <div role="status" aria-label="Loading routes">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (routes.isError) {
    return <ApiErrorNotice title="Couldn't load routes" error={routes.error} onRetry={() => void routes.refetch()} />;
  }
  const rows = routes.data.routes;
  const failing = rows.filter((row) => row.errors_5xx + row.errors_429 + row.errors_4xx > 0);
  const empty = { title: "No routes counted yet", description: "Each instance adds its finished minutes as requests arrive." };
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-text">Routes, every instance</h2>
        <p className="text-xs text-muted">Counted per route template by each instance and added to the database every minute, {RANGE_WORDS[range]} (whole hours). The last minute before an instance stops is not counted.</p>
      </div>
      <Card title="Routes by traffic">
        <DataTable caption="Routes by traffic, every instance" columns={TRAFFIC_COLUMNS} rows={rows} rowKey={routeKey} defaultSort={{ columnId: "requests", direction: "descending" }} pageSize={10} empty={empty} />
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Slowest routes">
          <p className="mb-2 text-xs text-muted">By 95th percentile latency: one request in twenty was slower.</p>
          <DataTable caption="Slowest routes by p95" columns={TRAFFIC_COLUMNS} rows={rows} rowKey={routeKey} defaultSort={{ columnId: "p95", direction: "descending" }} pageSize={10} empty={empty} />
        </Card>
        <Card title="Error routes">
          <p className="mb-2 text-xs text-muted">Routes that answered with an error: server errors and turned-away callers first.</p>
          <DataTable caption="Routes with errors" columns={ERROR_COLUMNS} rows={failing} rowKey={routeKey} defaultSort={{ columnId: "failed", direction: "descending" }} pageSize={10} empty={{ title: "No errors", description: `No route answered with an error in ${RANGE_WORDS[range]}.` }} />
        </Card>
      </div>
    </div>
  );
}
