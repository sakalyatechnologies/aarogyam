import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { Analytics } from "@aarogyam/api-client";

import { Empty, MkCard } from "../../components/mk/index.js";
import { bucketLabel, chairKey, type PeriodRow } from "./analytics-data.js";
import { ChartTooltip, Legend, series, swatch } from "./chart-tooltip.js";

const AXIS = { tickLine: false, axisLine: false, stroke: "var(--chart-axis)", fontSize: 11 } as const;
const percent = (value: number) => `${String(Math.round(value))}%`;
const count = (value: number) => String(Math.round(value));

/** Chair use over time, one line per chair, then a bar per chair for the latest period. */
export function ChairChart({ report, rows, animate }: { report: Analytics; rows: readonly PeriodRow[]; animate: boolean }) {
  const chairs = report.chairs.map((chair, i) => ({ key: chairKey(i), label: chair.name, color: series(i + 1), id: chair.id }));
  const latest = report.buckets.at(-1);
  return (
    <MkCard title="Chair use" hint={`Booked time over open time (${String(report.open_minutes_per_day / 60)} h a day)`} className="an-chairs">
      {chairs.length === 0 ? (
        <Empty art="calendar" title="No chairs yet">Add chairs in Settings → Chairs and doctors.</Empty>
      ) : (
        <>
          <div className="an-chart sm" role="img" aria-label="Chair use by period">
            <ResponsiveContainer>
              <LineChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" {...AXIS} minTickGap={12} />
                <YAxis {...AXIS} width={40} tickFormatter={percent} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />
                <Tooltip cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} content={<ChartTooltip format={percent} />} />
                {chairs.map((chair) => (
                  <Line
                    key={chair.key}
                    type="monotone"
                    dataKey={chair.key}
                    name={chair.label}
                    stroke={chair.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                    isAnimationActive={animate}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={chairs} />
          {latest === undefined ? null : (
            <ul className="an-chairrows" aria-label={`Chair use, ${bucketLabel(latest.start, report.bucket)}`}>
              {chairs.map((chair) => {
                const bps = latest.chair_utilization.find((u) => u.room_id === chair.id)?.utilization_bps ?? 0;
                return (
                  <li key={chair.key} className="an-chairrow">
                    <span>{chair.label}</span>
                    <span className="an-bar" role="meter" aria-label={chair.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bps / 100)}>
                      <span style={{ ...swatch(chair.color), width: `${String(Math.min(100, bps / 100))}%` }} />
                    </span>
                    <b>{percent(bps / 100)}</b>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </MkCard>
  );
}

/** New and returning patients per period, stacked. */
export function PatientMixChart({ rows, animate }: { rows: readonly PeriodRow[]; animate: boolean }) {
  const items = [
    { key: "returning", label: "Returning", color: series(1) },
    { key: "newPatients", label: "New", color: series(2) },
  ];
  const empty = rows.every((r) => r.newPatients + r.returning === 0);
  return (
    <MkCard title="New and returning patients" hint="Patients seen each period" className="an-mix">
      {empty ? (
        <Empty art="patients" title="No visits in this range">Patients seen show here.</Empty>
      ) : (
        <>
          <div className="an-chart sm" role="img" aria-label={`Patients by period, ${rows.map((r) => `${r.label} ${String(r.newPatients)} new, ${String(r.returning)} returning`).join("; ")}`}>
            <ResponsiveContainer>
              <AreaChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" {...AXIS} minTickGap={12} />
                <YAxis {...AXIS} width={40} allowDecimals={false} />
                <Tooltip cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }} content={<ChartTooltip format={count} total />} />
                {items.map((item) => (
                  <Area
                    key={item.key}
                    type="monotone"
                    dataKey={item.key}
                    name={item.label}
                    stackId="patients"
                    stroke={item.color}
                    strokeWidth={2}
                    fill={item.color}
                    fillOpacity={0.22}
                    activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                    isAnimationActive={animate}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <Legend items={items} />
        </>
      )}
    </MkCard>
  );
}
