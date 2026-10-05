import { Printer } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router";

import { invoiceId as invoiceIdSchema } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Skeleton } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { LetterheadSheet } from "../../components/letterhead/letterhead.js";
import { plainLetterhead } from "../../components/letterhead/sample.js";
import { useClinicSettings, useLetterhead } from "../../queries.js";
import { useInvoice } from "./queries.js";

/** A plain, printable layout for an issued bill: letterhead, patient, lines, GST and totals. */
export function InvoicePrintPage() {
  const params = useParams();
  const parsed = invoiceIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const invoice = useInvoice(id);
  const settings = useClinicSettings();
  const letterhead = useLetterhead();
  const { session } = useClinic();
  useDocumentTitle(invoice.data?.number ?? "Bill", "Print");
  const letterheadPending = letterhead.isPending;

  useEffect(() => {
    if (invoice.data !== undefined && settings.data !== undefined && !letterheadPending) {
      const timer = setTimeout(() => {
        window.print();
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [invoice.data, settings.data, letterheadPending]);

  if (id === undefined) {
    return <ApiErrorNotice title="That bill address isn't valid" error={{ status: 404, code: "not_found", message: "No such bill." }} />;
  }
  if (invoice.isPending || settings.isPending || letterheadPending) {
    return <Skeleton shape="block" />;
  }
  if (invoice.isError) {
    return <ApiErrorNotice title="Couldn't load this bill" error={invoice.error} onRetry={() => void invoice.refetch()} />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load the clinic's details" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  const bill = invoice.data;
  const clinic = settings.data;
  return (
    <div className="print-area mx-auto max-w-[210mm] bg-surface text-text">
      <div className="mb-4 flex justify-end p-4 print:hidden">
        <Button
          icon={<Printer aria-hidden="true" className="size-4" />}
          onClick={() => {
            window.print();
          }}
        >
          Print
        </Button>
      </div>
      <LetterheadSheet document={letterhead.data ?? plainLetterhead(clinic.legal_name ?? clinic.name)}>
        <div className="flex items-start justify-between border-b border-border pb-3">
          <p className="text-sm font-semibold text-muted">{bill.status === "void" ? "VOID" : "Tax invoice"}</p>
          <div className="text-right">
            <p className="text-lg font-bold">{bill.number ?? "Draft"}</p>
            {bill.issued_at == null ? null : <p className="text-sm text-muted">{formatDate(bill.issued_at)}</p>}
          </div>
        </div>
        <div className="mt-4">
          <p className="text-sm font-semibold text-muted">Billed to</p>
          <p className="font-semibold">{bill.patient.name}</p>
          <p className="text-sm text-muted">{bill.patient.number}</p>
        </div>

        <table className="mt-5 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted uppercase">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">GST</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {bill.items.map((line) => (
              <tr key={line.line_no}>
                <td className="py-2">{line.description}</td>
                <td className="py-2 text-right">{line.quantity}</td>
                <td className="py-2 text-right">{formatRupees(line.unit_price_paise)}</td>
                <td className="py-2 text-right">{line.gst_rate > 0 ? `${String(line.gst_rate)}%` : "Exempt"}</td>
                <td className="py-2 text-right">{formatRupees(line.total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-64 text-sm">
            <div className="flex justify-between py-0.5">
              <dt className="text-muted">Subtotal</dt>
              <dd>{formatRupees(bill.subtotal_paise)}</dd>
            </div>
            {bill.cgst_paise === 0 ? null : (
              <div className="flex justify-between py-0.5">
                <dt className="text-muted">CGST</dt>
                <dd>{formatRupees(bill.cgst_paise)}</dd>
              </div>
            )}
            {bill.sgst_paise === 0 ? null : (
              <div className="flex justify-between py-0.5">
                <dt className="text-muted">SGST</dt>
                <dd>{formatRupees(bill.sgst_paise)}</dd>
              </div>
            )}
            {bill.igst_paise === 0 ? null : (
              <div className="flex justify-between py-0.5">
                <dt className="text-muted">IGST</dt>
                <dd>{formatRupees(bill.igst_paise)}</dd>
              </div>
            )}
            {bill.round_off_paise === 0 ? null : (
              <div className="flex justify-between py-0.5">
                <dt className="text-muted">Round-off</dt>
                <dd>{formatRupees(bill.round_off_paise)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border py-1 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatRupees(bill.total_paise)}</dd>
            </div>
          </dl>
        </div>

        {clinic.upi_id == null ? null : <p className="mt-6 text-xs text-muted">Pay by UPI: {clinic.upi_id}</p>}
        <p className="mt-1 text-xs text-muted">Signed in as {session.user.display_name} · {clinic.name}</p>

      </LetterheadSheet>
    </div>
  );
}
