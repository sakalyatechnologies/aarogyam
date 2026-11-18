import { Printer } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router";

import { paymentId as paymentIdSchema } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Skeleton } from "@sakalya/ui";

import { useClinicSettings, useLetterhead } from "../../queries.js";
import { BillFooter, BillSheet, clinicFacts } from "./bill-sheet.js";
import { useInvoices, usePayment } from "./queries.js";

const METHOD_LABEL: Readonly<Record<string, string>> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank transfer" };

/** A receipt for one payment on A4, in the same style as the printed bill: clinic header, who paid, the bills it paid, a signature. */
export function ReceiptPrintPage() {
  const params = useParams();
  const parsed = paymentIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const payment = usePayment(id);
  const settings = useClinicSettings();
  const letterhead = useLetterhead();
  const bills = useInvoices({ patientId: payment.data?.patient.id }, payment.data !== undefined);
  useDocumentTitle(payment.data?.number ?? "Receipt", "Print");
  const ready = payment.data !== undefined && settings.data !== undefined && !letterhead.isPending && !bills.isLoading;

  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => {
        window.print();
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [ready]);

  if (id === undefined) {
    return <ApiErrorNotice title="That receipt address isn't valid" error={{ status: 404, code: "not_found", message: "No such receipt." }} />;
  }
  if (payment.isPending || settings.isPending || letterhead.isPending) {
    return <Skeleton shape="block" />;
  }
  if (payment.isError) {
    return <ApiErrorNotice title="Couldn't load this receipt" error={payment.error} onRetry={() => void payment.refetch()} />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load the clinic's details" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  const receipt = payment.data;
  const clinic = clinicFacts(settings.data, letterhead.data);
  const numberOf = (invoiceId: string) => bills.data?.items.find((bill) => bill.id === invoiceId)?.number ?? "Bill";

  return (
    <div className="print-area mx-auto max-w-[210mm] text-text">
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
      <BillSheet clinic={clinic} kind="Payment receipt" number={receipt.number} date={formatDate(receipt.received_at)} isVoid={receipt.status === "void"}>
        <section className="bp-parties" aria-label="Who paid">
          <div className="bp-party">
            <h3>Received from</h3>
            <p className="bp-strong">{receipt.patient.name}</p>
            <p>
              Patient no. <span className="bp-num">{receipt.patient.number}</span>
            </p>
          </div>
          <div className="bp-party">
            <h3>Paid by</h3>
            <p className="bp-strong">{METHOD_LABEL[receipt.method] ?? receipt.method}</p>
            <p>{formatDateTime(receipt.received_at)}</p>
            {receipt.reference == null ? null : <p>Reference {receipt.reference}</p>}
          </div>
        </section>

        <div className="bp-summary">
          <section className="bp-section" aria-labelledby="bp-against">
            <h3 id="bp-against">Against bills</h3>
            {receipt.allocations.length === 0 ? (
              <p className="bp-notes">Kept as an advance.</p>
            ) : (
              <table className="bp-table">
                <caption className="bp-sr">Bills this payment settles</caption>
                <thead>
                  <tr>
                    <th scope="col">Bill</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.allocations.map((allocation) => (
                    <tr key={allocation.invoice_id}>
                      <td className="bp-num">{numberOf(allocation.invoice_id)}</td>
                      <td className="num">{formatRupees(allocation.amount_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <dl className="bp-totals">
            {receipt.unallocated_paise === 0 ? null : (
              <>
                <dt>Advance</dt>
                <dd>{formatRupees(receipt.unallocated_paise)}</dd>
              </>
            )}
            <dt className="bp-total">Amount received</dt>
            <dd className="bp-total">{formatRupees(receipt.amount_paise)}</dd>
          </dl>
        </div>

        <BillFooter clinic={clinic} signer={undefined} />
      </BillSheet>
    </div>
  );
}
