import { CircleDollarSign, FileWarning, Plus, ReceiptText, Wallet } from "lucide-react";
import { useNavigate } from "react-router";

import type { Invoice } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatPercent, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { BarChart, Button, Card, DataTable, DonutChart, EmptyState, Link, PageHeader, Pill, Skeleton, StatCard, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useTodayDate } from "../../lib/patients.js";
import { useCollections, useInvoices } from "./queries.js";

function statusTone(status: string): "neutral" | "success" | "danger" {
  return status === "issued" ? "success" : status === "void" ? "danger" : "neutral";
}

function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  consultation: "Consultation",
  preventive: "Preventive",
  restorative: "Restorative",
  endodontics: "Endodontics",
  oral_surgery: "Oral surgery",
  orthodontics: "Orthodontics",
  medicines: "Medicines",
  other: "Other",
};

/** Billing: this month's money, the weekly collections chart, and every bill. Needs `billing.read`. */
export function BillingPage() {
  const { can } = useClinic();
  useDocumentTitle("Billing", "Aarogyam");
  const navigate = useNavigate();
  const today = useTodayDate();
  const month = useCollections({ from: monthStart(today), to: today });
  const week = useCollections({});
  const invoices = useInvoices();
  const canWrite = can("billing.write");

  const upiShare = month.data?.by_method.find((m) => m.method === "upi")?.share_bps ?? 0;

  const columns: readonly DataTableColumn<Invoice>[] = [
    {
      id: "number",
      header: "Number",
      cell: (i) => (
        <Link href={`/billing/invoices/${i.id}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
          {i.number ?? "Draft"}
        </Link>
      ),
      sortValue: (i) => i.number ?? i.created_at,
    },
    { id: "patient", header: "Patient", cell: (i) => `${i.patient.name} · ${i.patient.number}` },
    { id: "amount", header: "Amount", align: "end", cell: (i) => formatRupees(i.total_paise), sortValue: (i) => i.total_paise },
    {
      id: "status",
      header: "Status",
      cell: (i) => (
        <span className="flex flex-wrap gap-1.5">
          <Pill tone={statusTone(i.status)}>{i.status}</Pill>
          {i.payment_state == null ? null : <Pill tone={i.payment_state === "paid" ? "success" : "warning"}>{i.payment_state}</Pill>}
        </span>
      ),
    },
    { id: "date", header: "Date", align: "end", cell: (i) => formatDate(i.issued_at ?? i.created_at), sortValue: (i) => i.issued_at ?? i.created_at },
  ];

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="This clinic's bills, payments and collections"
        end={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={<FileWarning aria-hidden="true" className="size-4" />}
              onClick={() => {
                void navigate("/billing/pending");
              }}
            >
              Pending payments
            </Button>
            {canWrite ? (
              <Button
                icon={<Plus aria-hidden="true" className="size-4" />}
                onClick={() => {
                  void navigate("/billing/invoices/new");
                }}
              >
                New bill
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Collected this month"
            value={month.isPending ? "—" : formatRupees(month.data?.collected_paise ?? 0)}
            icon={<CircleDollarSign className="size-7" />}
          />
          <StatCard
            label="Outstanding"
            value={month.isPending ? "—" : formatRupees(month.data?.outstanding_paise ?? 0)}
            tone="warning"
            icon={<Wallet className="size-7" />}
          />
          <StatCard
            label="UPI share"
            value={month.isPending ? "—" : formatPercent(upiShare / 10_000)}
            icon={<ReceiptText className="size-7" />}
          />
          <StatCard
            label="Bills issued this month"
            value={month.isPending ? "—" : String(month.data?.invoices ?? 0)}
            icon={<FileWarning className="size-7" />}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
          <Card title="Weekly collections">
            {week.isPending ? (
              <Skeleton shape="block" />
            ) : week.isError ? (
              <ApiErrorNotice title="Couldn't load collections" error={week.error} onRetry={() => void week.refetch()} />
            ) : week.data.by_week.every((w) => w.amount_paise === 0) ? (
              <EmptyState title="No collections yet" description="Issued bills and payments will show here." icon={null} />
            ) : (
              <BarChart
                data={week.data.by_week.map((w) => ({ label: formatDate(w.date), total: w.amount_paise / 100, part: w.amount_paise / 100 }))}
                totalLabel="Collected"
                partLabel="Collected"
                categoryLabel="Week of"
                summary="Rupees collected each week"
              />
            )}
          </Card>
          <Card title="Revenue mix this month">
            {month.isPending ? (
              <Skeleton shape="block" />
            ) : month.isError ? (
              <ApiErrorNotice title="Couldn't load the revenue mix" error={month.error} onRetry={() => void month.refetch()} />
            ) : month.data.revenue_mix.length === 0 ? (
              <EmptyState title="No bills issued this month" description="The mix appears once bills are issued." icon={null} />
            ) : (
              <DonutChart
                data={month.data.revenue_mix.map((m) => ({ label: CATEGORY_LABEL[m.category] ?? m.category, value: m.amount_paise }))}
                summary="This month's billed amount by category"
                categoryLabel="Category"
                valueLabel="Amount"
                centerValue={formatRupees(month.data.invoiced_paise)}
                centerLabel="billed"
              />
            )}
          </Card>
        </div>

        <Card title="Bills">
          {invoices.isError ? (
            <ApiErrorNotice title="Couldn't load bills" error={invoices.error} onRetry={() => void invoices.refetch()} />
          ) : (
            <DataTable
              caption="Bills"
              columns={columns}
              rows={invoices.data?.items ?? []}
              rowKey={(i) => i.id}
              loading={invoices.isPending}
              defaultSort={{ columnId: "date", direction: "descending" }}
              empty={{ title: "No bills yet", description: "Issue the first bill to see it here.", icon: <ReceiptText className="size-7" /> }}
            />
          )}
        </Card>
      </div>
    </>
  );
}
