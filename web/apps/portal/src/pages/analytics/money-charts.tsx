import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EXPENSE_CATEGORIES } from "@aarogyam/api-client";

import { Empty, MkCard } from "../../components/mk/index.js";
import { compactRupees } from "../../lib/money.js";
import { CATEGORY_LABEL } from "../../lib/expenses.js";
import { SERIES_LABEL, withNet, type MoneySeries, type PeriodRow } from "./analytics-data.js";
import { ChartTooltip, Legend, series } from "./chart-tooltip.js";

const rupees = (value: number) => compactRupees(Math.round(value * 100));
/** Like `rupees`, with a proper minus for a net below zero (New look charts). */
const signed = (value: number) => (value < 0 ? `−${rupees(-value)}` : rupees(value));
const AXIS = { tickLine: false, axisLine: false, stroke: "var(--chart-axis)", fontSize: 11 } as const;

/** Income received per period: an area with a soft gradient under the line. */
export function IncomeChart({ rows, animate }: { rows: readonly PeriodRow[]; animate: boolean }) {
  const gradient = useId().replaceAll(":", "");
  const empty = rows.every((r) => (r.income ?? 0) === 0);
  return (
    <MkCard title="Income" hint="Payments received, not counting void ones; the latest period is so far" className="an-income">
      {empty ? (
        <Empty art="chart" title="No income in this range">Payments you record show here.</Empty>
      ) : (
        <div className="an-chart" role="img" aria-label={`Income by period, ${rows.map((r) => `${r.label} ${rupees(r.income ?? 0)}`).join(", ")}`}>
          <ResponsiveContainer>
            <AreaChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" {...AXIS} minTickGap={12} />
              <YAxis {...AXIS} width={52} tickFormatter={rupees} />
              <Tooltip cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} content={<ChartTooltip format={rupees} />} />
              <Area
                type="monotone"
                dataKey="income"
                name="Income"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill={`url(#${gradient})`}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={animate}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </MkCard>
  );
}

/** Expenses per period, stacked by category in the fixed category order. */
export function ExpensesChart({ rows, animate }: { rows: readonly PeriodRow[]; animate: boolean }) {
  const empty = rows.every((r) => (r.expenses ?? 0) === 0);
  const items = EXPENSE_CATEGORIES.map((category, i) => ({ key: category, label: CATEGORY_LABEL[category], color: series(i + 1) }));
  return (
    <MkCard title="Expenses" hint="By category; stock received counts as material" className="an-expenses">
      {empty ? (
        <Empty art="chart" title="No expenses in this range">Add expenses under Billing → Expenses.</Empty>
      ) : (
        <>
          <div className="an-chart" role="img" aria-label={`Expenses by period, ${rows.map((r) => `${r.label} ${rupees(r.expenses ?? 0)}`).join(", ")}`}>
            <ResponsiveContainer>
              <BarChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" {...AXIS} minTickGap={8} />
                <YAxis {...AXIS} width={52} tickFormatter={rupees} />
                <Tooltip cursor={{ fill: "var(--hover)" }} content={<ChartTooltip format={rupees} total />} />
                {items.map((item, i) => (
                  <Bar
                    key={item.key}
                    dataKey={item.key}
                    name={item.label}
                    stackId="spend"
                    fill={item.color}
                    stroke="var(--surface)"
                    strokeWidth={1}
                    radius={i === items.length - 1 ? [4, 4, 0, 0] : 0}
                    maxBarSize={36}
                    isAnimationActive={animate}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={items} />
        </>
      )}
    </MkCard>
  );
}

/**
 * New look: income and expenses over the range as two soft areas, with the net as a dashed line. With
 * `only`, just that series: the net then gets its own area, which dips below the zero line in a period
 * that spent more than it took in.
 */
export function IncomeVsExpensesChart({ rows, animate, only }: { rows: readonly PeriodRow[]; animate: boolean; only?: MoneySeries | undefined }) {
  const id = useId().replaceAll(":", "");
  const data = withNet(rows);
  const show = (key: MoneySeries) => only === undefined || only === key;
  const items = [
    { key: "income", label: "Income", color: series(1) },
    { key: "expenses", label: "Expenses", color: series(2) },
    { key: "net", label: "Net", color: series(3) },
  ].filter((item) => only === undefined || item.key === only);
  const amount = (r: (typeof data)[number], key: MoneySeries) => (key === "net" ? r.net : (r[key] ?? 0));
  const label =
    only === undefined
      ? `Income and expenses by period, ${rows.map((r) => `${r.label} ${rupees(r.income ?? 0)} in, ${rupees(r.expenses ?? 0)} out`).join("; ")}`
      : `${SERIES_LABEL[only]} by period, ${data.map((r) => `${r.label} ${signed(amount(r, only))}`).join(", ")}`;
  return (
    <div>
      <div className="an-chart" role="img" aria-label={label}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`${id}i`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id={`${id}e`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" {...AXIS} minTickGap={12} />
            <YAxis {...AXIS} width={52} tickFormatter={signed} />
            <Tooltip cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} content={<ChartTooltip format={signed} />} />
            {show("income") ? <Area className="an-s-income" type="monotone" dataKey="income" name="Income" stroke="var(--chart-1)" strokeWidth={2} fill={`url(#${id}i)`} isAnimationActive={animate} /> : null}
            {show("expenses") ? <Area className="an-s-expenses" type="monotone" dataKey="expenses" name="Expenses" stroke="var(--chart-2)" strokeWidth={2} fill={`url(#${id}e)`} isAnimationActive={animate} /> : null}
            {only === "net" ? <ReferenceLine y={0} stroke="var(--chart-axis)" /> : null}
            {only === "net" ? (
              <Area className="an-s-net" type="monotone" dataKey="net" name="Net" stroke="var(--chart-3)" strokeWidth={2} fill="var(--chart-3)" fillOpacity={0.14} dot={{ r: 3, fill: "var(--chart-3)", strokeWidth: 0 }} isAnimationActive={animate} />
            ) : null}
            {only === undefined ? <Line className="an-s-net" type="monotone" dataKey="net" name="Net" stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={animate} /> : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <Legend items={items} label="Series shown" />
    </div>
  );
}

/** New look: money collected per day or week, from the collections report, as a line with a dot per period. `rows` are `{ label, tip, value }` in rupees. */
export function WeeklyCollectionsChart({ rows, animate }: { rows: readonly { label: string; tip: string; value: number }[]; animate: boolean }) {
  const gradient = useId().replaceAll(":", "");
  return (
    <div className="an-chart" role="img" aria-label={`Collected per week, ${rows.map((r) => `${r.label} ${rupees(r.value)}`).join(", ")}`}>
      <ResponsiveContainer>
        <AreaChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.24} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} minTickGap={14} />
          <YAxis {...AXIS} width={52} tickFormatter={signed} />
          <Tooltip cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} content={<ChartTooltip format={signed} />} />
          <Area
            className="an-collected-line"
            type="monotone"
            dataKey="value"
            name="Collected"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill={`url(#${gradient})`}
            dot={{ r: 3, fill: "var(--chart-1)", strokeWidth: 0 }}
            activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={animate}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** New look: money collected per week, stacked by payment method. `methods` fixes the stack order and colours. */
export function MethodStackChart({ rows, methods, animate }: { rows: readonly ({ label: string; tip: string } & Record<string, number | string>)[]; methods: readonly { key: string; name: string; color: string }[]; animate: boolean }) {
  const totals = methods.map((m) => `${m.name} ${rupees(rows.reduce((sum, r) => sum + (typeof r[m.key] === "number" ? Number(r[m.key]) : 0), 0))}`);
  return (
    <div className="an-chart" role="img" aria-label={`Collected per week by method, ${totals.join(", ")}`}>
      <ResponsiveContainer>
        <BarChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} minTickGap={14} />
          <YAxis {...AXIS} width={52} tickFormatter={signed} />
          <Tooltip cursor={{ fill: "var(--hover)" }} content={<ChartTooltip format={signed} total />} />
          {methods.map((m) => (
            <Bar key={m.key} dataKey={m.key} name={m.name} stackId="method" fill={m.color} maxBarSize={28} isAnimationActive={animate} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
