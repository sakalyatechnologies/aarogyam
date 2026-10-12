import { Armchair, ClipboardList, UserPlus, Users } from "lucide-react";
import { useReducedMotion } from "motion/react";

import type { Analytics } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { BentoCard, Heatmap } from "@sakalya/ui";

import { Empty, Skeleton } from "../../../components/mk/index.js";
import { AGE_LABEL, REFERRAL_LABEL, VISIT_LABEL, WEEKDAY, busyGrid, hourLabel, isEmpty, periodRows, rangeStart, totals } from "../analytics-data.js";
import { DonutCard } from "../breakdown-charts.js";
import { ChairChart, PatientMixChart } from "../chair-charts.js";
import { useAnalytics } from "../queries.js";
import { bucketOf, monthsOf, type RangeKey } from "./range.js";
import { Tile } from "./tiles.js";

/** `endodontics` → `Endodontics`, `root_canal` → `Root canal`. */
export const prettyKey = (key: string) => {
  const spaced = key.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Practice: who came, what was done, how the chairs were used and when it was busy. Nothing here is money. */
export function PracticeTab({ range, today }: { range: RangeKey; today: string }) {
  const report = useAnalytics({ from: rangeStart(today, monthsOf(range)), bucket: bucketOf(range) });
  if (report.isError && report.data === undefined) {
    return <ApiErrorNotice title="Couldn't load analytics" error={report.error} onRetry={() => void report.refetch()} />;
  }
  if (report.data === undefined) return <Loading />;
  if (isEmpty(report.data)) {
    return <Empty art="chart" title="Nothing to show yet">Charts fill in once the clinic has visits in this range.</Empty>;
  }
  return <Practice report={report.data} updating={report.isPlaceholderData} />;
}

function Practice({ report, updating }: { report: Analytics; updating: boolean }) {
  const animate = useReducedMotion() !== true;
  const rows = periodRows(report);
  const t = totals(report);
  const newPatients = rows.reduce((s, r) => s + r.newPatients, 0);
  const procedures = report.procedures_by_category.reduce((s, p) => s + p.count, 0);
  const use = t.chairUse === null ? null : Math.round(t.chairUse * 100);
  const procedureLabels = Object.fromEntries(report.procedures_by_category.map((p) => [p.key, prettyKey(p.key)]));
  return (
    <div className="an2-stack" aria-busy={updating}>
      <ul className="an2-kpis" aria-label="Practice totals for the range">
        <Tile label="Patients seen" value={String(t.patients)} hint="New and returning" icon={<Users className="size-4" />} />
        <Tile label="New patients" value={String(newPatients)} hint={t.patients === 0 ? undefined : `${String(Math.round((newPatients / t.patients) * 100))}% of patients seen`} icon={<UserPlus className="size-4" />} />
        <Tile label="Procedures" value={String(procedures)} hint="Done in this range" icon={<ClipboardList className="size-4" />} />
        <Tile label="Avg chair use" value={use === null ? "—" : `${String(use)}%`} hint="Booked over open time" icon={<Armchair className="size-4" />} meter={use} />
      </ul>
      <div className="an2-grid">
        <div className="an2-cell an2-w6">
          <PatientMixChart rows={rows} animate={animate} />
        </div>
        <div className="an2-cell an2-w6">
          <DonutCard
            title="Procedures"
            hint="What was done, by kind"
            area="an-procedures"
            data={report.procedures_by_category}
            labels={procedureLabels}
            unit="done"
            animate={animate}
          />
          {/* TODO(backend report fields): amounts per procedure, so this card can show the rupees each kind earned. */}
        </div>
        <div className="an2-cell an2-w6">
          <ChairChart report={report} rows={rows} animate={animate} />
        </div>
        <div className="an2-cell an2-w6">
          <BusyHoursCard report={report} />
        </div>
        <div className="an2-cell an2-w4">
          <DonutCard title="Age" hint="Patients seen, by age" area="an-age" data={report.patients.age_bands} labels={AGE_LABEL} unit="patients" animate={animate} />
        </div>
        <div className="an2-cell an2-w4">
          <DonutCard title="Visit kind" hint="Visits by appointment kind" area="an-visit" data={report.patients.visit_kinds} labels={VISIT_LABEL} unit="visits" animate={animate} />
        </div>
        <div className="an2-cell an2-w4">
          <DonutCard title="Referral source" hint="New patients, by how they found you" area="an-referral" data={report.patients.referral_sources} labels={REFERRAL_LABEL} unit="new" animate={animate} />
        </div>
      </div>
    </div>
  );
}

/** Visits by weekday and starting hour, drawn by the shared Heatmap. */
function BusyHoursCard({ report }: { report: Analytics }) {
  const grid = busyGrid(report);
  const max = Math.max(1, ...report.busy_hours.map((h) => h.visits));
  return (
    <BentoCard title="Busy hours" subtitle="Visits by weekday and starting hour">
      {report.busy_hours.length === 0 ? (
        <Empty art="calendar" title="No visits in this range">The busiest hours show here once patients are seen.</Empty>
      ) : (
        <div className="an2-heat">
          <Heatmap
            columns={grid.hours.map(hourLabel)}
            rows={grid.rows.map((r) => ({ id: String(r.weekday), label: WEEKDAY[r.weekday - 1] ?? "", values: r.cells.map((c) => c.visits) }))}
            max={max}
            describe={(value, row, column) => `${row.label} ${column}: ${String(value)} visits`}
            summary="Visits by weekday and hour"
            legend={{ low: "Quiet", high: "Busy" }}
            showValues={false}
          />
          {/* TODO(backend report fields): chair x hour occupancy (percent of each hour booked, per chair), as a second Heatmap with a chair per row. */}
        </div>
      )}
    </BentoCard>
  );
}

function Loading() {
  return (
    <div role="status" aria-label="Loading analytics">
      <div className="an2-kpis" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="stat" />
        ))}
      </div>
      <div className="an2-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="block" className="an2-w6" style={{ height: 240 }} />
        ))}
      </div>
    </div>
  );
}
