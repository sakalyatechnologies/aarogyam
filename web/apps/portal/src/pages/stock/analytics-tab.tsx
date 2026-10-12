import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "motion/react";

import type { InventoryItemId, StockInsight } from "@aarogyam/api-client";
import { ApiErrorNotice, formatNumber } from "@aarogyam/app-kit";
import { Button, Select, Skeleton } from "@sakalya/ui";

import { SortHeader } from "../../components/sort-header.js";
import { useSortable, type SortColumn } from "../../components/use-sortable.js";
import { HEALTHY, coverText, reorderText } from "./projection.js";
import { useStockAnalytics } from "./queries.js";

const AXIS = { tickLine: false, axisLine: false, stroke: "var(--sk-text-muted)", fontSize: 11 } as const;
const shortDay = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const day = (iso: string) => shortDay.format(new Date(`${iso}T00:00:00Z`));

interface Point {
  day: string;
  label: string;
  quantity: number;
}

/** The 28-day daily series for one item or, summed, for every item. */
export function dailyPoints(items: readonly StockInsight[]): Point[] {
  const totals = new Map<string, number>();
  for (const item of items) for (const d of item.series) totals.set(d.day, (totals.get(d.day) ?? 0) + d.quantity);
  return [...totals.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([d, quantity]) => ({ day: d, label: day(d), quantity }));
}

function isPoint(value: unknown): value is Point {
  return typeof value === "object" && value !== null && "label" in value && "quantity" in value;
}

function TipBox({ active, payload }: { active?: boolean | undefined; payload?: readonly { payload?: unknown }[] | undefined }) {
  const point = payload?.[0]?.payload;
  if (active !== true || !isPoint(point)) return null;
  return (
    <div className="st2-tip" role="presentation">
      <b>{point.label}</b>
      <div>{formatNumber(point.quantity)} used</div>
    </div>
  );
}

/** Usage over the last 28 days, as a soft area chart. */
function UsageTrend({ items }: { items: readonly StockInsight[] }) {
  const [choice, setChoice] = useState<string>("");
  const animate = useReducedMotion() !== true;
  const shown = choice === "" ? items : items.filter((i) => i.item_id === choice);
  const points = useMemo(() => dailyPoints(shown), [shown]);
  const total = points.reduce((sum, p) => sum + p.quantity, 0);
  return (
    <section className="st2-card" aria-label="Usage trend">
      <div className="st2-card-head">
        <div>
          <h3>Usage trend</h3>
          <p className="st2-sub">Units used each day over the last 28 days</p>
        </div>
        <div className="st2-pick">
        <Select
          aria-label="Item shown"
          options={[{ value: "", label: "All items" }, ...items.map((i) => ({ value: i.item_id, label: i.name }))]}
          value={choice}
          onValueChange={setChoice}
        />
        </div>
      </div>
      {total === 0 ? (
        <p className="st2-sub">No stock used in the last 28 days yet. Once you record use, the trend shows up here.</p>
      ) : (
        <div className="st2-chart" role="img" aria-label={`Daily use over 28 days, ${formatNumber(total)} units in all`}>
          <ResponsiveContainer>
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="st2-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--sk-chart-1, var(--sk-primary))" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--sk-chart-1, var(--sk-primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--sk-border)" />
              <XAxis dataKey="label" {...AXIS} minTickGap={24} />
              <YAxis {...AXIS} width={40} allowDecimals={false} />
              <Tooltip cursor={{ stroke: "var(--sk-text-muted)", strokeDasharray: "3 3" }} content={<TipBox />} />
              <Area type="monotone" dataKey="quantity" name="Used" stroke="var(--sk-chart-1, var(--sk-primary))" strokeWidth={2} fill="url(#st2-fill)" isAnimationActive={animate} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

const COLUMNS: readonly SortColumn<StockInsight>[] = [
  { id: "item", kind: "text", value: (i) => i.name },
  { id: "on_hand", kind: "number", value: (i) => i.on_hand },
  { id: "usage", kind: "number", value: (i) => i.daily_usage },
  { id: "cover", kind: "number", value: (i) => i.days_cover },
  { id: "runs_out", kind: "date", value: (i) => i.runs_out_on },
];

/** Every item with its use, days of cover and run-out date; the headers sort. */
function CoverTable({ items }: { items: readonly StockInsight[] }) {
  const sortable = useSortable(items, COLUMNS, { columnId: "cover", direction: "ascending" });
  return (
    <section className="st2-card" aria-label="Days of cover">
      <div className="st2-card-head">
        <div>
          <h3>Days of cover</h3>
          <p className="st2-sub">How long each item lasts at the current rate of use. Items with too little history show a dash.</p>
        </div>
      </div>
      <div className="st2-tablewrap">
        <table className="st2-table">
          <caption className="mk-sr">Days of cover</caption>
          <thead>
            <tr>
              <SortHeader id="item" sortable={sortable}>Item</SortHeader>
              <SortHeader id="on_hand" sortable={sortable} className="num">In stock</SortHeader>
              <SortHeader id="usage" sortable={sortable} className="num">Used per day</SortHeader>
              <SortHeader id="cover" sortable={sortable} className="num">Days of cover</SortHeader>
              <SortHeader id="runs_out" sortable={sortable} className="num">Runs out</SortHeader>
            </tr>
          </thead>
          <tbody>
            {sortable.rows.map((i) => (
              <tr key={i.item_id}>
                <th scope="row">{i.name}</th>
                <td className="num">{formatNumber(i.on_hand)}</td>
                <td className="num">{i.daily_usage == null ? "—" : (Math.round(i.daily_usage * 10) / 10).toLocaleString("en-IN")}</td>
                <td className="num">{i.days_cover == null ? "—" : formatNumber(i.days_cover)}</td>
                <td className="num">{i.runs_out_on == null ? "—" : day(i.runs_out_on)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReorderList({ items, canManage, onReorder }: { items: readonly StockInsight[]; canManage: boolean; onReorder: (id: InventoryItemId) => void }) {
  return (
    <section className="st2-card" aria-label="Reorder list">
      <div className="st2-card-head">
        <div>
          <h3>Reorder list</h3>
          <p className="st2-sub">What to order now, so it arrives before the shelf is empty</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="st2-calm">{HEALTHY}</p>
      ) : (
        <ul className="st2-list">
          {items.map((i) => (
            <li key={i.item_id} className="st2-row">
              <div>
                <p className="st2-name">{i.name}</p>
                <p className="st2-sub">
                  <span className="st2-warn">{coverText(i.days_cover)}</span> · {reorderText(i.suggested_reorder_qty, i.unit) ?? "No quantity to suggest yet"}
                </p>
              </div>
              {canManage ? (
                <Button
                  variant="secondary"
                  aria-label={`Reorder ${i.name} from the list`}
                  onClick={() => {
                    onReorder(i.item_id);
                  }}
                >
                  Reorder
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The Analytics tab on Stock: usage trend, days of cover and the reorder list. */
export function StockAnalyticsTab({ canManage, onReorder }: { canManage: boolean; onReorder: (id: InventoryItemId) => void }) {
  const analytics = useStockAnalytics();
  if (analytics.isError) return <ApiErrorNotice title="Couldn't load stock analytics" error={analytics.error} onRetry={() => void analytics.refetch()} />;
  if (analytics.isPending) return <Skeleton shape="block" />;
  if (analytics.data.items.length === 0) return <p className="st2-calm">Add a few items and record their use; the trends will appear here.</p>;
  return (
    <div className="st2-grid">
      <UsageTrend items={analytics.data.items} />
      <CoverTable items={analytics.data.items} />
      <ReorderList items={analytics.data.reorder_list} canManage={canManage} onReorder={onReorder} />
    </div>
  );
}
