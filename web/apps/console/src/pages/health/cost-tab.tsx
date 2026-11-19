/** The Cost tab and the Overview's cost tile: this month's estimated Cloud Run cost after the free tier, and the free plans. */

import { CalendarRange, CloudOff, ExternalLink, IndianRupee, TrendingUp, Wallet } from "lucide-react";

import type { CostInsights, CostItem } from "@aarogyam/api-client";
import { ApiErrorNotice, formatBytes, formatDate, formatNumber, formatPercent } from "@aarogyam/app-kit";
import { Card, DataTable, EmptyState, Meter, Pill, StatCard, type DataTableColumn } from "@sakalya/ui";

import { useCostInsights } from "../../api.js";
import { LoadingCharts, one } from "./insight-parts.js";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Dollars, with a hint when a non-zero amount rounds to nothing. */
export function formatUsd(value: number): string {
  return value > 0 && value < 0.005 ? "< $0.01" : usd.format(value);
}

/** An amount in its unit, such as `1.2 GiB`, `214,000 vCPU-s` or `180 MB`. */
export function formatAmount(value: number, unit: string): string {
  if (unit === "bytes") {
    return formatBytes(value);
  }
  if (unit === "GiB") {
    return `${one.format(value)} GiB`;
  }
  return `${formatNumber(Math.round(value))} ${unit}`;
}

/** Rupees with the GST apart, such as `₹1,234 + ₹222 GST`. */
function rupees(amount: number | null, gst: number | null): string {
  return amount === null || gst === null ? "—" : `${inr.format(amount)} + ${inr.format(gst)} GST`;
}

export function CostTab() {
  const cost = useCostInsights();
  if (cost.isPending) {
    return <LoadingCharts titles={[]} label="Loading the cost estimate" />;
  }
  if (cost.isError) {
    return <ApiErrorNotice title="Couldn't load the cost estimate" error={cost.error} onRetry={() => void cost.refetch()} />;
  }
  return <CostBody cost={cost.data} />;
}

function CostBody({ cost }: { cost: CostInsights }) {
  const cloudRun = cost.items.filter((item) => item.provider === "cloud_run");
  const plans = cost.items.filter((item) => item.provider !== "cloud_run");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pill tone="warning">{cost.label}</Pill>
        <a
          href={cost.billing_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded text-sm font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Open Google Cloud Billing
          <span className="sr-only"> in a new tab</span>
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </div>
      {cost.source === "unavailable" ? (
        <Card>
          <EmptyState
            title="No Cloud Run usage to price here"
            description={
              cost.error === null
                ? "This server isn't running on Cloud Run, so there is no usage to read. Deployed, this tab estimates the API's and the outbox job's cost this month from Cloud Monitoring."
                : `Cloud Run usage could not be read (${cost.error}). Try again in a few minutes, or check the bill in Google Cloud Billing.`
            }
            icon={<CloudOff className="size-7" />}
          />
        </Card>
      ) : (
        <CloudRunCost cost={cost} items={cloudRun} />
      )}
      <Card title="Free plans">
        <p className="mb-2 text-xs text-muted">Supabase and Cloudflare run on free plans: $0, shown against their limits.</p>
        <DataTable caption="Free plans" columns={PLAN_COLUMNS} rows={plans} rowKey={(row) => row.key} />
      </Card>
    </div>
  );
}

function CloudRunCost({ cost, items }: { cost: CostInsights; items: readonly CostItem[] }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="So far this month"
          value={formatUsd(cost.total_usd ?? 0)}
          tone="neutral"
          icon={<Wallet className="size-7" />}
          footer={<p className="text-xs text-muted">{rupees(cost.total_inr, cost.total_gst_inr)}</p>}
        />
        <StatCard
          label="Forecast for the month"
          value={formatUsd(cost.forecast_usd ?? 0)}
          tone="neutral"
          icon={<TrendingUp className="size-7" />}
          footer={<p className="text-xs text-muted">{`${rupees(cost.forecast_inr, cost.forecast_gst_inr)} · at this month's pace`}</p>}
        />
        <StatCard
          label="Month gone"
          value={formatPercent(cost.elapsed_fraction, 0)}
          tone="neutral"
          icon={<CalendarRange className="size-7" />}
          footer={<p className="text-xs text-muted">{`From ${formatDate(cost.period_start)} to ${formatDate(cost.period_end)} (UTC month) · ₹${String(cost.inr_per_usd)} a dollar`}</p>}
        />
      </div>
      <Card title="Cloud Run">
        <p className="mb-2 text-xs text-muted">Usage this month from Cloud Monitoring, priced at list prices after each free tier. The API and the outbox job have their own prices and free tiers.</p>
        <DataTable caption="Cloud Run cost by item" columns={CLOUD_RUN_COLUMNS} rows={items} rowKey={(row) => row.key} />
      </Card>
    </>
  );
}

function FreeLeft({ item }: { item: CostItem }) {
  if (item.free === null) {
    return <span className="text-xs text-muted">{item.unit_price_usd === null ? "—" : "No free tier"}</span>;
  }
  if (item.free === 0) {
    return <span className="text-xs text-muted">No free tier</span>;
  }
  if (item.free_left === null) {
    return <span className="text-xs text-muted">Limit {formatAmount(item.free, item.unit)}</span>;
  }
  return (
    <Meter
      className="min-w-40"
      label={`${item.label}: free left`}
      value={item.free_left}
      max={item.free}
      lowAt={item.free * 0.1}
      valueLabel={`${formatAmount(item.free_left, item.unit)} of ${formatAmount(item.free, item.unit)}`}
    />
  );
}

const itemCell = (row: CostItem) => (
  <span className="flex flex-col">
    <span className="font-semibold text-text">{row.label}</span>
    {row.note === null ? null : <span className="text-xs text-muted">{row.note}</span>}
  </span>
);

const CLOUD_RUN_COLUMNS: readonly DataTableColumn<CostItem>[] = [
  { id: "item", header: "Item", cell: itemCell },
  { id: "used", header: "Used so far", cell: (row) => (row.used === null ? "—" : formatAmount(row.used, row.unit)), align: "end" },
  { id: "free", header: "Free tier left", cell: (row) => <FreeLeft item={row} /> },
  { id: "cost", header: "Est. cost", cell: (row) => (row.unit_price_usd === null ? "—" : formatUsd(row.cost_usd)), align: "end" },
  { id: "forecast", header: "Month forecast", cell: (row) => (row.unit_price_usd === null ? "—" : formatUsd(row.forecast_usd)), align: "end", hideOnMobile: true },
];

const PLAN_COLUMNS: readonly DataTableColumn<CostItem>[] = [
  { id: "item", header: "Item", cell: itemCell },
  { id: "used", header: "Used", cell: (row) => (row.used === null ? "Not read" : formatAmount(row.used, row.unit)), align: "end" },
  { id: "free", header: "Plan left", cell: (row) => <FreeLeft item={row} /> },
  { id: "cost", header: "Cost", cell: (row) => formatUsd(row.cost_usd), align: "end" },
];

/** The Overview's tile: the month's forecast, linking to the Cost tab. */
export function CostTile({ href }: { href: string }) {
  const cost = useCostInsights();
  const data = cost.data;
  const available = data?.source === "cloud_monitoring";
  const value = available ? formatUsd(data.forecast_usd ?? 0) : "—";
  const footer = cost.isPending
    ? "Loading…"
    : cost.isError
      ? "Couldn't load the cost estimate"
      : available
        ? `${rupees(data.forecast_inr, data.forecast_gst_inr)} · so far ${formatUsd(data.total_usd ?? 0)}`
        : "Cloud Run usage isn't available here";
  return <StatCard label="Est. cost this month" value={value} tone="neutral" icon={<IndianRupee className="size-7" />} href={href} footer={<p className="text-xs text-muted">{footer}</p>} />;
}
