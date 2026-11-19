/** Small pieces shared by the Insights tabs: a chart card with its one-line meaning, loading cards and stats. */

import type { ReactNode } from "react";

import type { MetricsRange } from "@aarogyam/api-client";
import { Card, LineChart, Skeleton, type LineChartProps } from "@sakalya/ui";

export const RANGE_WORDS: Readonly<Record<MetricsRange, string>> = {
  "1h": "the last hour",
  "6h": "the last 6 hours",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
};

export const one = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** A chart in a card, with one line saying what it means. */
export function ChartCard({ title, note, wide = false, ...chart }: LineChartProps & { title: string; note: string; wide?: boolean }) {
  return (
    <div className={wide ? "xl:col-span-2" : undefined}>
      <Card title={title}>
        <p className="mb-2 text-xs text-muted">{note}</p>
        <LineChart {...chart} />
      </Card>
    </div>
  );
}

/** Placeholder cards while a tab's numbers load. */
export function LoadingCharts({ titles, label }: { titles: readonly string[]; label: string }) {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={label}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} shape="block" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {titles.map((title) => (
          <Card key={title} title={title}>
            <LineChart loading times={[]} series={[]} summary="" xLabel="Time" yLabel={title} formatX={String} />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="text-xl font-extrabold tracking-tight text-text">{value}</dd>
      {note === undefined ? null : <dd>{note}</dd>}
    </div>
  );
}

/** The x axis of a chart; with no points the chart shows `empty` instead of the plot. */
export function xAxis(times: readonly number[], formatX: (time: number) => string, xLabel: string, empty: string) {
  return { times, formatX, xLabel, ...(times.length > 0 ? {} : { emptyMessage: empty }) };
}
