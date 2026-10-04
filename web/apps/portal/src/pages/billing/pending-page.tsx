import { FileWarning } from "lucide-react";

import type { PendingItem } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Card, DataTable, Link, PageHeader, Skeleton, StatCard, type DataTableColumn } from "@sakalya/ui";

import { usePendingReport } from "./queries.js";

const BUCKET_LABEL: Readonly<Record<string, string>> = { "0_30": "0–30 days", "31_60": "31–60 days", "61_90": "61–90 days", "90_plus": "Over 90 days" };

/** Issued bills with a balance, oldest first, with aging buckets. Needs `finance.view`. */
export function PendingPaymentsPage() {
  useDocumentTitle("Pending payments", "Billing");
  const report = usePendingReport();

  const columns: readonly DataTableColumn<PendingItem>[] = [
    {
      id: "number",
      header: "Bill",
      cell: (i) => (
        <Link href={`/billing/invoices/${i.invoice_id}`} className="font-mono text-xs font-semibold text-primary-text hover:underline">
          {i.number ?? "—"}
        </Link>
      ),
    },
    { id: "patient", header: "Patient", cell: (i) => `${i.patient.name} · ${i.patient.number}` },
    { id: "issued", header: "Issued", align: "end", cell: (i) => (i.issued_at == null ? "—" : formatDate(i.issued_at)) },
    { id: "age", header: "Age", align: "end", cell: (i) => `${String(i.age_days)} d`, sortValue: (i) => i.age_days },
    { id: "total", header: "Total", align: "end", cell: (i) => formatRupees(i.total_paise) },
    { id: "paid", header: "Paid", align: "end", cell: (i) => formatRupees(i.paid_paise) },
    { id: "balance", header: "Balance", align: "end", cell: (i) => formatRupees(i.balance_paise), sortValue: (i) => i.balance_paise },
  ];

  return (
    <>
      <PageHeader title="Pending payments" subtitle="Issued bills with something still owed" />
      {report.isPending ? (
        <Skeleton shape="block" />
      ) : report.isError ? (
        <ApiErrorNotice title="Couldn't load pending payments" error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Outstanding" value={formatRupees(report.data.outstanding_paise)} tone="warning" icon={<FileWarning className="size-7" />} />
            {(["0_30", "31_60", "61_90", "90_plus"] as const).map((bucket) => (
              <StatCard key={bucket} label={BUCKET_LABEL[bucket] ?? bucket} value={String(report.data.buckets[bucket])} icon={<FileWarning className="size-7" />} />
            ))}
          </div>
          <Card title="Bills owed">
            <DataTable
              caption="Pending bills"
              columns={columns}
              rows={report.data.items}
              rowKey={(i) => i.invoice_id}
              defaultSort={{ columnId: "age", direction: "descending" }}
              empty={{ title: "Nothing pending", description: "Every issued bill is paid in full.", icon: null }}
            />
          </Card>
        </div>
      )}
    </>
  );
}
