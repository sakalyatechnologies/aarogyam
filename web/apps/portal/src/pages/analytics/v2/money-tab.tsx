import { HandCoins, Hourglass, Scale, Wallet } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { EXPENSE_CATEGORIES, type Analytics, type Collections } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees } from "@aarogyam/app-kit";
import { BentoCard, Tag } from "@sakalya/ui";

import { Skeleton } from "../../../components/mk/index.js";
import { CATEGORY_LABEL } from "../../../lib/expenses.js";
import { compactRupees } from "../../../lib/money.js";
import { useExpenses, usePendingReport } from "../../billing/queries.js";
import { MoneyEye, useShowMoney } from "../../today/v2/money.js";
import { Body, Empty } from "../../today/v2/widget-parts.js";
import { useWeeklyCollections } from "../../today/v2/queries.js";
import { bucketLabel, isEmpty, periodRows, rangeStart, totals } from "../analytics-data.js";
import { series } from "../chart-tooltip.js";
import { IncomeVsExpensesChart, WeeklyCollectionsChart } from "../money-charts.js";
import { useAnalytics } from "../queries.js";
import { bucketOf, expenseWindow, monthsOf, weeksOf, type RangeKey } from "./range.js";
import { Tile } from "./tiles.js";

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const METHOD_LABEL: Readonly<Record<string, string>> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank transfer", cheque: "Cheque", insurance: "Insurance" };
const methodName = (method: string) => METHOD_LABEL[method] ?? method.charAt(0).toUpperCase() + method.slice(1).replaceAll("_", " ");

/** A money card: the title, the eye, and the body only while the eye is open. Nothing inside is fetched or drawn until then. */
function MoneyCard({ title, subtitle, wide, children }: { title: string; subtitle: string; wide: string; children: ReactNode }) {
  const [shown] = useShowMoney();
  return (
    <div className={`an2-cell ${wide}`}>
      <BentoCard title={title} subtitle={subtitle} action={<MoneyEye what={title.toLowerCase()} className="an2-eye" />}>
        {shown ? children : <p className="an2-veil">Hidden. Press the eye to show the amounts.</p>}
      </BentoCard>
    </div>
  );
}

/** Money: income and expenses, what was collected and how, what is still owed, and the expense log. Needs `finance.view`. */
export function MoneyTab({ range, today }: { range: RangeKey; today: string }) {
  const [shown] = useShowMoney();
  const report = useAnalytics({ from: rangeStart(today, monthsOf(range)), bucket: bucketOf(range) });
  const pending = usePendingReport(shown);
  if (report.isError && report.data === undefined) {
    return <ApiErrorNotice title="Couldn't load money figures" error={report.error} onRetry={() => void report.refetch()} />;
  }
  if (report.data === undefined) return <Loading />;
  return <Money report={report.data} range={range} today={today} pending={pending} />;
}

function Money({ report, range, today, pending }: { report: Analytics; range: RangeKey; today: string; pending: ReturnType<typeof usePendingReport> }) {
  const [shown] = useShowMoney();
  const t = totals(report);
  const owed = pending.data;
  return (
    <div className="an2-stack">
      <ul className="an2-kpis" aria-label="Money totals for the range">
        <Tile money label="Income" value={compactRupees(t.incomePaise)} hint="Payments received" icon={<Wallet className="size-4" />} />
        <Tile money label="Expenses" value={compactRupees(t.expensesPaise)} hint="Including stock received" icon={<HandCoins className="size-4" />} />
        <Tile
          money
          label="Net"
          value={`${t.netPaise < 0 ? "−" : ""}${compactRupees(Math.abs(t.netPaise))}`}
          hint={t.incomePaise > 0 ? `${String(Math.round((t.netPaise / t.incomePaise) * 100))}% margin` : "No income yet"}
          icon={<Scale className="size-4" />}
        />
        <Tile
          money
          label="Outstanding"
          value={owed === undefined ? "—" : compactRupees(owed.outstanding_paise)}
          hint={owed === undefined ? (pending.isError ? "Couldn't load" : "Loading") : `${String(owed.patients)} ${owed.patients === 1 ? "patient owes" : "patients owe"}`}
          icon={<Hourglass className="size-4" />}
        />
      </ul>
      <div className="an2-grid">
        <MoneyCard title="Income vs expenses" subtitle="Received and spent in each period; the latest is so far" wide="an2-w8">
          <IncomeBody report={report} />
        </MoneyCard>
        <MoneyCard title="Billed vs collected" subtitle="Where the money went, this range" wide="an2-w4">
          <BilledBody range={range} pending={pending} />
        </MoneyCard>
        <MoneyCard title="Collections by week" subtitle="Payments received each week" wide="an2-w8">
          <WeeklyBody range={range} />
        </MoneyCard>
        <MoneyCard title="Collections by method" subtitle="How patients paid" wide="an2-w4">
          <MethodBody range={range} />
        </MoneyCard>
        <MoneyCard title="Expenses by category" subtitle="Share of everything spent" wide="an2-w4">
          <CategoryBody report={report} />
        </MoneyCard>
        <MoneyCard title="Expense log" subtitle="The last six weeks, newest first" wide="an2-w8">
          <ExpenseLog today={today} enabled={shown} />
        </MoneyCard>
      </div>
    </div>
  );
}

function IncomeBody({ report }: { report: Analytics }) {
  const animate = useReducedMotion() !== true;
  if (isEmpty(report) || periodRows(report).every((r) => (r.income ?? 0) === 0 && (r.expenses ?? 0) === 0)) {
    return <Empty title="No income or expenses in this range" description="Payments and expenses you record show here." />;
  }
  return <IncomeVsExpensesChart rows={periodRows(report)} animate={animate} />;
}

function BilledBody({ range, pending }: { range: RangeKey; pending: ReturnType<typeof usePendingReport> }) {
  const collections = useWeeklyCollections(weeksOf(range), true);
  return (
    <Body query={collections} label="billed and collected" rows={4} isEmpty={(c) => c.invoiced_paise === 0 && c.collected_paise === 0} empty={<Empty title="Nothing billed yet" description="Invoices and payments show here." />}>
      {(c) => <BilledFlow c={c} pending={pending} />}
    </Body>
  );
}

function BilledFlow({ c, pending }: { c: Collections; pending: ReturnType<typeof usePendingReport> }) {
  const rate = c.invoiced_paise > 0 ? Math.round((c.collected_paise / c.invoiced_paise) * 100) : null;
  const top = Math.max(c.invoiced_paise, c.collected_paise, 1);
  const lines = [
    { key: "billed", label: "Billed", paise: c.invoiced_paise, color: series(4) },
    { key: "collected", label: "Collected", paise: c.collected_paise, color: series(1) },
    { key: "outstanding", label: "Still to collect", paise: c.outstanding_paise, color: series(2) },
  ];
  // Summed from the bills: the report's own buckets are not amounts in every build.
  const ages = pending.data === undefined ? undefined : Object.fromEntries(["0_30", "31_60", "61_90", "90_plus"].map((k) => [k, pending.data.items.filter((i) => i.bucket === k).reduce((sum, i) => sum + i.balance_paise, 0)]));
  return (
    <div className="an2-flow">
      {lines.map((l) => (
        <div key={l.key}>
          <div className="an2-row">
            <span>{l.label}</span>
            <b>{formatRupees(l.paise)}</b>
          </div>
          <div className="an2-track" aria-hidden="true">
            <span style={{ width: `${String(Math.max(2, (l.paise / top) * 100))}%`, background: l.color }} />
          </div>
        </div>
      ))}
      <div className="an2-rate">
        <span>Collection rate</span>
        <b>{rate === null ? "—" : `${String(rate)}%`}</b>
      </div>
      {ages === undefined ? null : (
        <ul className="an2-ages" aria-label="Owed by age of the bill">
          {(
            [
              ["0_30", "Up to 30 days"],
              ["31_60", "31 to 60"],
              ["61_90", "61 to 90"],
              ["90_plus", "Over 90"],
            ] as const
          ).map(([key, label]) => (
            <li key={key}>
              <span>{label}</span>
              <b>{formatRupees(ages[key] ?? 0)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WeeklyBody({ range }: { range: RangeKey }) {
  const animate = useReducedMotion() !== true;
  const collections = useWeeklyCollections(weeksOf(range), true);
  return (
    <Body query={collections} label="collections by week" isEmpty={(c) => c.by_week.length === 0 || c.by_week.every((w) => w.amount_paise === 0)} empty={<Empty title="Nothing collected yet" description="Payments you record show here week by week." />}>
      {(c) => (
        <WeeklyCollectionsChart
          animate={animate}
          rows={c.by_week.map((w) => ({ label: bucketLabel(w.date, "week"), tip: `Week of ${dayLabel(w.date)} (${String(w.payments)} payments)`, value: w.amount_paise / 100 }))}
        />
      )}
    </Body>
  );
}

function MethodBody({ range }: { range: RangeKey }) {
  const collections = useWeeklyCollections(weeksOf(range), true);
  return (
    <Body query={collections} label="collections by method" rows={4} isEmpty={(c) => c.by_method.length === 0} empty={<Empty title="No payments yet" />}>
      {(c) => (
        <ul className="an2-bars" aria-label="Collections by method">
          {c.by_method.map((m, i) => (
            <li key={m.method}>
              <div className="an2-row">
                <span>{methodName(m.method)}</span>
                <b>{`${formatRupees(m.amount_paise)} (${String(Math.round(m.share_bps / 100))}%)`}</b>
              </div>
              <div className="an2-track" aria-hidden="true">
                <span style={{ width: `${String(Math.max(2, m.share_bps / 100))}%`, background: series(i + 1) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Body>
  );
}

function CategoryBody({ report }: { report: Analytics }) {
  const sums = EXPENSE_CATEGORIES.map((category, i) => ({
    category,
    color: series(i + 1),
    paise: report.buckets.reduce((s, b) => s + (b.expenses?.find((e) => e.category === category)?.amount_paise ?? 0), 0),
  })).filter((c) => c.paise > 0);
  const total = sums.reduce((s, c) => s + c.paise, 0);
  if (total === 0) return <Empty title="No expenses in this range" description="Add expenses under Billing, Expenses." />;
  return (
    <ul className="an2-bars" aria-label="Expenses by category">
      {sums
        .sort((a, b) => b.paise - a.paise)
        .map((c) => (
          <li key={c.category}>
            <div className="an2-row">
              <span>{CATEGORY_LABEL[c.category]}</span>
              <b>{`${formatRupees(c.paise)} (${String(Math.round((c.paise / total) * 100))}%)`}</b>
            </div>
            <div className="an2-track" aria-hidden="true">
              <span style={{ width: `${String(Math.max(2, (c.paise / total) * 100))}%`, background: c.color }} />
            </div>
          </li>
        ))}
    </ul>
  );
}

function ExpenseLog({ today, enabled }: { today: string; enabled: boolean }) {
  const expenses = useExpenses(expenseWindow(today), enabled);
  return (
    <Body query={expenses} label="expenses" rows={4} isEmpty={(d) => d.items.length === 0} empty={<Empty title="No expenses in the last six weeks" description="Add them under Billing, Expenses." />}>
      {(d) => (
        <div className="an2-scroll">
          <table className="an2-table">
            <caption className="mk-sr">Expenses in the last six weeks</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Note</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((e) => (
                <tr key={e.id} data-void={e.status === "void" ? "1" : undefined}>
                  <td>{dayLabel(e.spent_on)}</td>
                  <td>
                    <Tag>{e.category_name}</Tag>
                  </td>
                  <td>{e.note ?? ""}</td>
                  <td className="num">
                    {e.status === "void" ? <span className="mk-sr">Void </span> : null}
                    {formatRupees(e.amount_paise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Body>
  );
}

function Loading() {
  return (
    <div role="status" aria-label="Loading money figures">
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

