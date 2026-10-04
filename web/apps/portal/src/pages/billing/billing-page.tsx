import { FileWarning, Plus } from "lucide-react";
import { Link } from "react-router";

import type { Invoice } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { Bars, Empty, Kpi, MkCard, Tag, type TagTone } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { compactRupees } from "../../lib/money.js";
import { useTodayDate } from "../../lib/patients.js";
import { useCollections, useInvoices, usePendingReport } from "./queries.js";

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

const METHOD_LABEL: Readonly<Record<string, string>> = { upi: "UPI", cash: "Cash", card: "Card", bank_transfer: "Bank", cheque: "Cheque" };

function invoiceTag(invoice: Invoice): { label: string; tone: TagTone } {
  if (invoice.status === "void") return { label: "VOID", tone: "down" };
  if (invoice.status !== "issued") return { label: "DRAFT", tone: "neutral" };
  if (invoice.payment_state === "paid") return { label: "PAID", tone: "done" };
  if (invoice.paid_paise > 0) return { label: "PARTIAL", tone: "info" };
  return { label: "DUE", tone: "wait" };
}

const modeOf = (invoice: Invoice): string => (invoice.methods.length === 0 ? "—" : invoice.methods.map((m) => METHOD_LABEL[m] ?? m).join(", "));

/** Downloads the listed bills as a spreadsheet-ready CSV. */
function exportCsv(rows: readonly Invoice[]) {
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = [
    ["Bill", "Patient", "Amount (INR)", "Mode", "Status"].map(cell).join(","),
    ...rows.map((i) => [i.number ?? "Draft", `${i.patient.name} (${i.patient.number})`, String(i.total_paise / 100), modeOf(i), invoiceTag(i).label].map(cell).join(",")),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "bills.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/** Billing: this month's money, the weekly collections chart, and every bill. Needs `billing.read`. */
export function BillingPage() {
  const { can } = useClinic();
  useDocumentTitle("Billing", "Aarogyam");
  const today = useTodayDate();
  const month = useCollections({ from: monthStart(today), to: today });
  const week = useCollections({});
  const invoices = useInvoices();
  const pending = usePendingReport();
  const canWrite = can("billing.write");
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const upiShare = month.data?.by_method.find((m) => m.method === "upi")?.share_bps ?? 0;
  const rows = invoices.data?.items ?? [];
  const weeks = (week.data?.by_week ?? []).slice(-8);

  return (
    <div className="mk-panel">
      <h1 className="mk-sr">Billing</h1>
      <div className="mk-ptools">
        <Link to="/billing/pending" className="mk-btn mk-btn-ghost mk-spacer">
          <FileWarning aria-hidden="true" /> Pending payments
        </Link>
        {canWrite ? (
          <Link to="/billing/invoices/new" className="mk-btn mk-btn-primary">
            <Plus aria-hidden="true" /> New bill
          </Link>
        ) : null}
      </div>
      <div className="mk-kpis">
        <Kpi label={`Collected · ${monthName}`} value={month.isPending ? "—" : compactRupees(month.data?.collected_paise ?? 0)} pill={month.data === undefined ? undefined : plural(month.data.payments, "payment")} pillTone="up" />
        <Kpi
          label="Outstanding"
          value={month.isPending ? "—" : compactRupees(month.data?.outstanding_paise ?? 0)}
          pill={pending.data === undefined ? undefined : plural(pending.data.items.length, "bill")}
          pillTone="warn"
        />
        <Kpi label="Consulting payout" value="—" pill="not tracked yet" pillTone="info" />
        <Kpi label="UPI share" value={month.isPending ? "—" : `${String(Math.round(upiShare / 100))}%`} />
      </div>
      <div className="mk-grid mk-g2r">
        <MkCard title="Weekly collections" hint="Last 8 weeks · ₹ thousands">
          {week.isPending ? (
            <Skeleton shape="block" />
          ) : week.isError ? (
            <ApiErrorNotice title="Couldn't load collections" error={week.error} onRetry={() => void week.refetch()} />
          ) : weeks.every((w) => w.amount_paise === 0) ? (
            <Empty title="No collections yet">Issued bills and payments will show here.</Empty>
          ) : (
            <Bars
              data={weeks.map((w, i) => ({ label: `W${String(i + 1)}`, value: w.amount_paise / 100, tip: `${compactRupees(w.amount_paise)} · week of ${w.date}` }))}
              summary="Rupees collected each week"
            />
          )}
        </MkCard>
        <MkCard
          title="Invoices"
          action={
            <button
              type="button"
              className="mk-link"
              disabled={rows.length === 0}
              onClick={() => {
                exportCsv(rows);
              }}
            >
              ⤓ Excel
            </button>
          }
        >
          {invoices.isError ? (
            <ApiErrorNotice title="Couldn't load bills" error={invoices.error} onRetry={() => void invoices.refetch()} />
          ) : invoices.isPending ? (
            <Skeleton shape="block" />
          ) : rows.length === 0 ? (
            <Empty title="No bills yet">Issue the first bill to see it here.</Empty>
          ) : (
            <div className="mk-tablewrap">
              <table className="mk-table">
                <caption className="mk-sr">Invoices</caption>
                <thead>
                  <tr>
                    <th scope="col">Bill</th>
                    <th scope="col">Patient</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort((a, b) => (b.issued_at ?? b.created_at).localeCompare(a.issued_at ?? a.created_at))
                    .slice(0, 12)
                    .map((i) => {
                      const tag = invoiceTag(i);
                      return (
                        <tr key={i.id}>
                          <th scope="row" className="mk-mono">
                            <Link to={`/billing/invoices/${i.id}`}>{i.number ?? "Draft"}</Link>
                          </th>
                          <td>{i.patient.name}</td>
                          <td>{formatRupees(i.total_paise)}</td>
                          <td>{modeOf(i)}</td>
                          <td>
                            <Tag tone={tag.tone}>{tag.label}</Tag>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </MkCard>
      </div>
    </div>
  );
}
