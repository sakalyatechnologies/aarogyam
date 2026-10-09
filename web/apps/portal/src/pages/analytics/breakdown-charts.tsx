import { m } from "motion/react";
import type { CSSProperties } from "react";
import { Pie, PieChart, Tooltip } from "recharts";

import type { Analytics, KeyCount } from "@aarogyam/api-client";

import { Empty, MkCard } from "../../components/mk/index.js";
import { WEEKDAY, busyGrid, hourLabel } from "./analytics-data.js";
import { ChartTooltip, series, swatch } from "./chart-tooltip.js";

const count = (value: number) => String(Math.round(value));
/** Keys meaning "not known" always take the neutral last colour. */
const NEUTRAL = new Set(["unknown"]);

/**
 * A donut with its own legend beside it (name, count and share), so every slice is readable without
 * its colour. Slices keep the API's fixed key order, and with it their colours.
 */
export function DonutCard({ title, hint, area, data, labels, unit, animate }: { title: string; hint: string; area: string; data: readonly KeyCount[]; labels: Readonly<Record<string, string>>; unit: string; animate: boolean }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const slices = data.map((d, i) => ({ key: d.key, name: labels[d.key] ?? d.key, value: d.count, color: NEUTRAL.has(d.key) ? series(8) : series(i + 1) }));
  return (
    <MkCard title={title} hint={hint} className={area}>
      {total === 0 ? (
        <Empty art="chart" title="Nothing yet">It fills in as patients visit.</Empty>
      ) : (
        <div className="an-donut">
          <div className="an-donut-c">
            <PieChart width={140} height={140}>
              <Pie data={slices.map((s) => ({ ...s, fill: s.color }))} dataKey="value" nameKey="name" innerRadius={46} outerRadius={68} paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2} isAnimationActive={animate}>
              </Pie>
              <Tooltip content={<ChartTooltip format={count} />} />
            </PieChart>
            <div className="an-donut-n" aria-hidden="true">
              <strong>{total}</strong>
              <span>{unit}</span>
            </div>
          </div>
          <ul className="an-legend col" aria-label={title}>
            {slices.map((s) => (
              <li key={s.key}>
                <span className="an-sw" style={swatch(s.color)} aria-hidden="true" />
                <span>{s.name}</span>
                <b>
                  {`${String(s.value)} (${String(Math.round((s.value / total) * 100))}%)`}
                </b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </MkCard>
  );
}

const ROW = { hidden: {}, show: { transition: { staggerChildren: 0.012 } } };
const CELL = { hidden: { opacity: 0, scale: 0.6 }, show: { opacity: 1, scale: 1, transition: { duration: 0.2 } } };

/** Visits by weekday and hour, in five steps of one brand colour, with a Low → High legend. */
export function BusyHours({ report }: { report: Analytics }) {
  const grid = busyGrid(report);
  const cols: CSSProperties = Object.fromEntries([["--cols", String(grid.hours.length)]]);
  return (
    <MkCard title="Busy hours" hint="Visits by weekday and starting hour" className="an-busy">
      {report.busy_hours.length === 0 ? (
        <Empty art="calendar" title="No visits in this range">The busiest hours show here once patients are seen.</Empty>
      ) : (
        <>
          <div style={cols}>
          <m.div className="an-heat" role="table" aria-label="Visits by weekday and hour" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}>
            <div role="row" className="an-heat-line">
              <span role="columnheader" className="an-heat-day">
                <span className="mk-sr">Day</span>
              </span>
              <div className="an-heat-hours">
                {grid.hours.map((hour) => (
                  <span key={hour} role="columnheader">
                    {hourLabel(hour)}
                  </span>
                ))}
              </div>
            </div>
            {grid.rows.map((row) => (
              <HeatRow key={row.weekday} weekday={row.weekday} cells={row.cells} />
            ))}
          </m.div>
          </div>
          <div className="an-heat-legend" aria-hidden="true">
            Low
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className="an-cell" data-level={level} />
            ))}
            High
          </div>
        </>
      )}
    </MkCard>
  );
}

function HeatRow({ weekday, cells }: { weekday: number; cells: readonly { hour: number; visits: number; level: number }[] }) {
  const day = WEEKDAY[weekday - 1] ?? "";
  return (
    <div role="row" className="an-heat-line">
      <span className="an-heat-day" role="rowheader">
        {day}
      </span>
      <m.div className="an-heat-row" variants={ROW}>
        {cells.map((cell) => (
          <m.span
            key={cell.hour}
            role="cell"
            className="an-cell"
            data-level={cell.level}
            title={`${day} ${hourLabel(cell.hour)}: ${String(cell.visits)} visits`}
            aria-label={`${day} ${hourLabel(cell.hour)}: ${String(cell.visits)} visits`}
            variants={CELL}
            whileHover={{ scale: 1.18 }}
          />
        ))}
      </m.div>
    </div>
  );
}
