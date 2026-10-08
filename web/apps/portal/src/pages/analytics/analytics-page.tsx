import { Armchair, HandCoins, Lock, Scale, Wallet } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import type { Analytics, AnalyticsBucket } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";

import { AlertBanner, Empty, PageHeader, Segments, Skeleton, StatTile } from "../../components/mk/index.js";
import { StaggerItem, StaggerList } from "../../components/mk/motion.js";
import { useClinic } from "../../clinic.js";
import { compactRupees } from "../../lib/money.js";
import { useTodayDate } from "../../lib/patients.js";
import { AGE_LABEL, REFERRAL_LABEL, VISIT_LABEL, isEmpty, periodRows, rangeStart, totals, type Months } from "./analytics-data.js";
import { BusyHours, DonutCard } from "./breakdown-charts.js";
import { ChairChart, PatientMixChart } from "./chair-charts.js";
import { ExpensesChart, IncomeChart } from "./money-charts.js";
import { useAnalytics } from "./queries.js";
import "./analytics.css";

type MonthsKey = "3" | "6" | "12";
const MONTHS: readonly { value: MonthsKey; label: string }[] = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];
const BUCKETS: readonly { value: AnalyticsBucket; label: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "week", label: "Weekly" },
];

/**
 * Analytics: money, chair use, patients and busy hours over 3, 6 or 12 months, by month or week.
 * Needs `analytics.view`; the money tiles and charts also need `finance.view` (the API leaves them
 * out otherwise). The range lives in the URL (`?months=6&by=week`).
 */
export function AnalyticsPage() {
  const { session } = useClinic();
  useDocumentTitle("Analytics", session.clinic.name);
  const today = useTodayDate();
  const [params, setParams] = useSearchParams();
  // Kept in state, mirrored to the URL: two quick clicks must not lose one to a pending navigation.
  const [choice, setChoice] = useState<{ months: MonthsKey; by: AnalyticsBucket }>(() => ({
    months: MONTHS.find((o) => o.value === params.get("months"))?.value ?? "12",
    by: params.get("by") === "week" ? "week" : "month",
  }));
  const months: Months = choice.months === "3" ? 3 : choice.months === "6" ? 6 : 12;
  const bucket = choice.by;
  const report = useAnalytics({ from: rangeStart(today, months), bucket });
  const choose = (next: Partial<typeof choice>) => {
    setChoice((current) => ({ ...current, ...next }));
  };
  const asked = `${params.get("months") ?? ""}|${params.get("by") ?? ""}`;
  useEffect(() => {
    if (asked !== `${choice.months}|${choice.by}`) {
      setParams({ months: choice.months, by: choice.by }, { replace: true });
    }
  }, [asked, choice, setParams]);

  return (
    <div className="mk-panel an-page">
      <PageHeader
        eyebrow={session.clinic.name}
        title="Analytics"
        subtitle="Money, chair use and who your patients are."
        actions={
          <div className="an-controls">
            {report.isPlaceholderData ? (
              <span className="an-updating" role="status">
                Updating…
              </span>
            ) : null}
            <Segments label="Range" options={MONTHS} value={choice.months} onChange={(v) => { choose({ months: v }); }} />
            <Segments label="Group by" options={BUCKETS} value={bucket} onChange={(v) => { choose({ by: v }); }} />
          </div>
        }
      />
      {report.isError && report.data === undefined ? (
        <ApiErrorNotice title="Couldn't load analytics" error={report.error} onRetry={() => void report.refetch()} />
      ) : report.data === undefined ? (
        <LoadingTiles />
      ) : isEmpty(report.data) ? (
        <Empty art="chart" title="Nothing to show yet">Charts fill in once the clinic has visits, payments and expenses in this range.</Empty>
      ) : (
        <Report report={report.data} />
      )}
    </div>
  );
}

function Report({ report }: { report: Analytics }) {
  const animate = useReducedMotion() !== true;
  const rows = periodRows(report);
  const money = report.money_visible;
  return (
    <>
      <KpiRow report={report} />
      {money ? null : (
        <div className="an-moneynote">
          <AlertBanner tone="info">Income and expenses are for the owner and finance roles; your role sees chair use and patients.</AlertBanner>
        </div>
      )}
      <div className={money ? "an-grid" : "an-grid no-money"}>
        {money ? <IncomeChart rows={rows} animate={animate} /> : null}
        {money ? <ExpensesChart rows={rows} animate={animate} /> : null}
        <ChairChart report={report} rows={rows} animate={animate} />
        <PatientMixChart rows={rows} animate={animate} />
        <BusyHours report={report} />
        <DonutCard title="Age" hint="Patients seen, by age" area="an-age" data={report.patients.age_bands} labels={AGE_LABEL} unit="patients" animate={animate} />
        <DonutCard title="Visit kind" hint="Visits by appointment kind" area="an-visit" data={report.patients.visit_kinds} labels={VISIT_LABEL} unit="visits" animate={animate} />
        <DonutCard title="Referral source" hint="New patients, by how they found you" area="an-referral" data={report.patients.referral_sources} labels={REFERRAL_LABEL} unit="new" animate={animate} />
      </div>
    </>
  );
}

const OWNER_ONLY = (
  <span className="an-owner">
    <Lock aria-hidden="true" size={14} /> Owner only
  </span>
);

function KpiRow({ report }: { report: Analytics }) {
  const t = totals(report);
  const money = report.money_visible;
  const use = t.chairUse === null ? null : Math.round(t.chairUse * 100);
  return (
    <StaggerList as="ul" className="an-kpis" aria-label="Totals for the range">
      <StaggerItem as="li">
        <StatTile label="Income" value={money ? compactRupees(t.incomePaise) : OWNER_ONLY} icon={<Wallet />} />
      </StaggerItem>
      <StaggerItem as="li">
        <StatTile label="Expenses" value={money ? compactRupees(t.expensesPaise) : OWNER_ONLY} icon={<HandCoins />} />
      </StaggerItem>
      <StaggerItem as="li">
        <StatTile
          label="Net"
          tone={money && t.netPaise < 0 ? "warn" : undefined}
          value={money ? `${t.netPaise < 0 ? "−" : ""}${compactRupees(Math.abs(t.netPaise))}` : OWNER_ONLY}
          icon={<Scale />}
          trend={money && t.incomePaise > 0 ? { direction: t.netPaise >= 0 ? "up" : "down", text: `${String(Math.round((t.netPaise / t.incomePaise) * 100))}% margin`, good: t.netPaise >= 0 } : undefined}
        />
      </StaggerItem>
      <StaggerItem as="li">
        <StatTile label="Avg chair use" value={use === null ? "—" : `${String(use)}%`} icon={<Armchair />} />
        {use === null ? null : (
          <span className="an-meter" role="meter" aria-label="Average chair use" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, use)}>
            <span style={{ width: `${String(Math.min(100, use))}%` }} />
          </span>
        )}
      </StaggerItem>
    </StaggerList>
  );
}

function LoadingTiles() {
  return (
    <div role="status" aria-label="Loading analytics">
      <div className="an-kpis" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="stat" />
        ))}
      </div>
      <div className="an-skel-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} shape="block" style={{ height: 260 }} />
        ))}
      </div>
    </div>
  );
}
