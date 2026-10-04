import { Printer } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router";

import { paymentId as paymentIdSchema } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Skeleton } from "@sakalya/ui";

import { useClinicSettings } from "../../queries.js";
import { usePayment } from "./queries.js";

const METHOD_LABEL: Readonly<Record<string, string>> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank transfer" };

/** A plain, printable receipt for one payment. */
export function ReceiptPrintPage() {
  const params = useParams();
  const parsed = paymentIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const payment = usePayment(id);
  const settings = useClinicSettings();
  useDocumentTitle(payment.data?.number ?? "Receipt", "Print");

  useEffect(() => {
    if (payment.data !== undefined && settings.data !== undefined) {
      const timer = setTimeout(() => {
        window.print();
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [payment.data, settings.data]);

  if (id === undefined) {
    return <ApiErrorNotice title="That receipt address isn't valid" error={{ status: 404, code: "not_found", message: "No such receipt." }} />;
  }
  if (payment.isPending || settings.isPending) {
    return <Skeleton shape="block" />;
  }
  if (payment.isError) {
    return <ApiErrorNotice title="Couldn't load this receipt" error={payment.error} onRetry={() => void payment.refetch()} />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load the clinic's details" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  const receipt = payment.data;
  const clinic = settings.data;

  return (
    <div className="print-area mx-auto max-w-md bg-surface p-6 text-text">
      <div className="mb-4 flex justify-end print:hidden">
        <Button
          icon={<Printer aria-hidden="true" className="size-4" />}
          onClick={() => {
            window.print();
          }}
        >
          Print
        </Button>
      </div>
      <header className="border-b border-border pb-4 text-center">
        <p className="text-lg font-extrabold tracking-tight">{clinic.legal_name ?? clinic.name}</p>
        <p className="mt-1 text-sm font-semibold text-muted">Payment receipt</p>
      </header>
      <dl className="mt-4 flex flex-col gap-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Receipt no.</dt>
          <dd className="font-mono font-semibold">{receipt.number}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Date</dt>
          <dd>{formatDateTime(receipt.received_at)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Received from</dt>
          <dd>
            {receipt.patient.name} ({receipt.patient.number})
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Method</dt>
          <dd>{METHOD_LABEL[receipt.method] ?? receipt.method}</dd>
        </div>
        {receipt.reference == null ? null : (
          <div className="flex justify-between">
            <dt className="text-muted">Reference</dt>
            <dd>{receipt.reference}</dd>
          </div>
        )}
        {receipt.allocations.map((allocation) => (
          <div key={allocation.invoice_id} className="flex justify-between text-xs text-muted">
            <dt>Against bill</dt>
            <dd>{formatRupees(allocation.amount_paise)}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
          <dt>Amount</dt>
          <dd>{formatRupees(receipt.amount_paise)}</dd>
        </div>
        {receipt.status === "void" ? <p className="text-center font-bold text-danger-text">VOID</p> : null}
      </dl>
    </div>
  );
}
