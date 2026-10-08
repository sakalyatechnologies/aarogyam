import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EXPENSE_CATEGORIES } from "@aarogyam/api-client";

import { Empty, MkCard } from "../../components/mk/index.js";
import { compactRupees } from "../../lib/money.js";
import { CATEGORY_LABEL } from "../../lib/expenses.js";
import type { PeriodRow } from "./analytics-data.js";
import { ChartTooltip, Legend, series } from "./chart-tooltip.js";

const rupees = (value: number) => compactRupees(Math.round(value * 100));
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
