/** The Front end tab: page speed per page against web.dev's thresholds, the slowest pages, and JavaScript error classes. */

import { Bug, Gauge, MousePointerClick, Move, Timer } from "lucide-react";
import type { ReactNode } from "react";

import type { ErrorStat, FrontEndInsights, MetricsRange, VitalStat } from "@aarogyam/api-client";
import { ApiErrorNotice, formatMs, formatNumber, formatPercent } from "@aarogyam/app-kit";
import { Card, DataTable, Pill, StatCard, type DataTableColumn } from "@sakalya/ui";

import { useFrontEndInsights } from "../../api.js";
import { LoadingCharts, RANGE_WORDS } from "./insight-parts.js";

const VITALS = ["lcp", "inp", "cls", "ttfb"] as const;
type VitalName = (typeof VITALS)[number];

const VITAL_WORDS: Readonly<Record<VitalName, { title: string; meaning: string; icon: ReactNode }>> = {
  lcp: { title: "Largest paint (LCP)", meaning: "When the main content showed", icon: <Timer className="size-7" /> },
  inp: { title: "Response to input (INP)", meaning: "The slowest reply to a tap or key", icon: <MousePointerClick className="size-7" /> },
  cls: { title: "Layout shift (CLS)", meaning: "How much the page jumped", icon: <Move className="size-7" /> },
  ttfb: { title: "First byte (TTFB)", meaning: "How fast the page started arriving", icon: <Gauge className="size-7" /> },
};

const CLASS_WORDS: Readonly<Record<string, string>> = {
  type_error: "Type error",
  reference_error: "Reference error",
  range_error: "Range error",
  syntax_error: "Syntax error",
  chunk_load: "Page code failed to load",
  network: "Network failure",
  unhandled_rejection: "Unhandled rejection",
  other: "Other",
};

const RATING_TONE = { good: "success", needs_work: "warning", poor: "danger" } as const;
const RATING_WORDS = { good: "Good", needs_work: "Needs work", poor: "Poor" } as const;

const isVital = (value: string): value is VitalName => VITALS.some((vital) => vital === value);

/** A vital's 75th percentile in its unit: milliseconds, or the unitless layout-shift score. */
export function formatVital(vital: string, value: number | null): string {
  if (value === null) return "—";
  return vital === "cls" ? value.toFixed(2) : formatMs(value);
}

const appWord = (app: string) => (app === "console" ? "Console" : "Portal");
const pageKey = (row: { app: string; route: string }) => `${row.app} ${row.route}`;

/** One row per app and page, with each vital's 75th percentile and rating. */
export interface PageSpeedRow {
  app: string;
  route: string;
  samples: number;
  vitals: Partial<Record<VitalName, VitalStat>>;
}

export function pageSpeedRows(vitals: readonly VitalStat[]): PageSpeedRow[] {
  const rows = new Map<string, PageSpeedRow>();
  for (const stat of vitals) {
    if (!isVital(stat.vital)) continue;
    const key = pageKey(stat);
    const row = rows.get(key) ?? { app: stat.app, route: stat.route, samples: 0, vitals: {} };
    row.vitals[stat.vital] = stat;
    row.samples = Math.max(row.samples, stat.samples);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The share of readings that were good for one vital, across every page of the portal. */
function goodShare(vitals: readonly VitalStat[], vital: VitalName): { share: number | null; samples: number } {
  const portal = vitals.filter((stat) => stat.app === "portal" && stat.vital === vital);
  const samples = portal.reduce((sum, stat) => sum + stat.samples, 0);
  const good = portal.reduce((sum, stat) => sum + stat.good, 0);
  return { share: samples === 0 ? null : good / samples, samples };
}

/** The Overview tile: the share of page loads, portal and console together, whose main content showed within 2.5 s. */
export function FrontEndTile({ href, range }: { href: string; range: MetricsRange }) {
  const front = useFrontEndInsights(range);
  const lcp = front.data?.vitals.filter((stat) => stat.vital === "lcp") ?? [];
  const samples = lcp.reduce((sum, stat) => sum + stat.samples, 0);
  const good = lcp.reduce((sum, stat) => sum + stat.good, 0);
  const share = samples === 0 ? null : good / samples;
  const footer = front.isPending
    ? "Loading…"
    : front.isError
      ? "Couldn't load front-end numbers"
      : share === null
        ? "No page loads counted yet"
        : `${formatNumber(samples)} page loads, portal and console`;
  return (
    <StatCard
      label="Pages shown within 2.5 s"
      value={share === null ? "—" : formatPercent(share, 0)}
      tone={share === null ? "neutral" : share >= 0.75 ? "success" : share >= 0.5 ? "warning" : "danger"}
      icon={<Timer className="size-7" />}
      href={href}
      footer={<p className="text-xs text-muted">{footer}</p>}
    />
  );
}

export function FrontEndTab({ range }: { range: MetricsRange }) {
  const front = useFrontEndInsights(range);
  if (front.isPending) {
    return <LoadingCharts titles={["Page speed by page", "Slowest pages"]} label="Loading front-end numbers" />;
  }
  if (front.isError) {
    return <ApiErrorNotice title="Couldn't load front-end numbers" error={front.error} onRetry={() => void front.refetch()} />;
  }
  return <FrontEndBody front={front.data} range={range} />;
}

function VitalCell({ stat }: { stat: VitalStat | undefined }) {
  if (stat === undefined) return <span className="text-muted">—</span>;
  if (stat.p75 === null || stat.rating === null) {
    return <span className="text-xs text-muted">Under 5 readings</span>;
  }
  return <Pill tone={RATING_TONE[stat.rating]}>{`${formatVital(stat.vital, stat.p75)} · ${RATING_WORDS[stat.rating]}`}</Pill>;
}

const sortP75 = (vital: VitalName) => (row: PageSpeedRow) => row.vitals[vital]?.p75 ?? -1;

const PAGE_COLUMNS: readonly DataTableColumn<PageSpeedRow>[] = [
  {
    id: "page",
    header: "Page",
    cell: (row) => (
      <span className="font-mono text-xs">
        <span className="font-semibold text-primary-text">{appWord(row.app)}</span> {row.route}
      </span>
    ),
    sortValue: (row) => pageKey(row),
  },
  ...VITALS.map(
    (vital): DataTableColumn<PageSpeedRow> => ({
      id: vital,
      header: `${vital.toUpperCase()} p75`,
      align: "end",
      cell: (row) => <VitalCell stat={row.vitals[vital]} />,
      sortValue: sortP75(vital),
    }),
  ),
  { id: "samples", header: "Loads", align: "end", cell: (row) => formatNumber(row.samples), sortValue: (row) => row.samples },
];

const ERROR_COLUMNS: readonly DataTableColumn<ErrorStat>[] = [
  {
    id: "page",
    header: "Page",
    cell: (row) => (
      <span className="font-mono text-xs">
        <span className="font-semibold text-primary-text">{appWord(row.app)}</span> {row.route}
      </span>
    ),
    sortValue: (row) => pageKey(row),
  },
  { id: "class", header: "Kind", cell: (row) => CLASS_WORDS[row.class] ?? row.class, sortValue: (row) => row.class },
  { id: "count", header: "Errors", align: "end", cell: (row) => formatNumber(row.count), sortValue: (row) => row.count },
];

function FrontEndBody({ front, range }: { front: FrontEndInsights; range: MetricsRange }) {
  const words = range === "7d" || range === "30d" ? RANGE_WORDS[range] : "yesterday and today";
  const rows = pageSpeedRows(front.vitals);
  const slowest = rows
    .filter((row) => row.vitals.lcp?.p75 !== null && row.vitals.lcp?.p75 !== undefined)
    .sort((a, b) => (b.vitals.lcp?.p75 ?? 0) - (a.vitals.lcp?.p75 ?? 0))
    .slice(0, 5);
  const thresholds = new Map(front.thresholds.map((threshold) => [threshold.vital, threshold]));
  const errorCount = front.errors.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">
        Counted in each signed-in browser and sent when the tab is hidden, per page template (never the address), {words}. A 75th percentile needs 5 readings.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {VITALS.map((vital) => {
          const { share, samples } = goodShare(front.vitals, vital);
          const threshold = thresholds.get(vital);
          const limit = threshold === undefined ? "" : ` (good up to ${formatVital(vital, threshold.good)})`;
          return (
            <StatCard
              key={vital}
              label={VITAL_WORDS[vital].title}
              value={share === null ? "—" : formatPercent(share, 0)}
              tone={share === null ? "neutral" : share >= 0.75 ? "success" : share >= 0.5 ? "warning" : "danger"}
              icon={VITAL_WORDS[vital].icon}
              footer={<p className="text-xs text-muted">{samples === 0 ? "No readings yet" : `Good in the portal${limit}; ${VITAL_WORDS[vital].meaning.toLowerCase()}`}</p>}
            />
          );
        })}
      </div>

      <Card title="Page speed by page">
        <p className="mb-2 text-xs text-muted">The 75th percentile of each measure: three loads in four were at least this fast. Green is good, amber needs work, red is poor.</p>
        <DataTable
          caption="Page speed by page"
          columns={PAGE_COLUMNS}
          rows={rows}
          rowKey={pageKey}
          defaultSort={{ columnId: "samples", direction: "descending" }}
          pageSize={10}
          empty={{ title: "No readings yet", description: "Pages report their speed when a signed-in tab is hidden." }}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Slowest pages">
          <p className="mb-2 text-xs text-muted">By largest paint at the 75th percentile: where people wait longest for the page to show.</p>
          {slowest.length === 0 ? (
            <p className="text-sm text-muted">No page has 5 readings yet.</p>
          ) : (
            <ol className="flex flex-col gap-2" aria-label="Slowest pages">
              {slowest.map((row) => (
                <li key={pageKey(row)} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs">
                    <span className="font-semibold text-primary-text">{appWord(row.app)}</span> {row.route}
                  </span>
                  <VitalCell stat={row.vitals.lcp} />
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="JavaScript errors">
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
            <Bug aria-hidden="true" className="size-3.5" />
            {errorCount === 0 ? "None counted" : `${formatNumber(errorCount)} counted`} {words}, by kind only. Messages and stacks are in Error Reporting.
          </p>
          <DataTable caption="JavaScript errors by page and kind" columns={ERROR_COLUMNS} rows={front.errors} rowKey={(row) => `${pageKey(row)} ${row.class}`} defaultSort={{ columnId: "count", direction: "descending" }} pageSize={10} empty={{ title: "No errors counted" }} />
        </Card>
      </div>
    </div>
  );
}
