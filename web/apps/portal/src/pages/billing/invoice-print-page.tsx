import { Printer } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router";

import { invoiceId as invoiceIdSchema } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Skeleton } from "@sakalya/ui";

import { ageSex } from "../../lib/patients.js";
import { useClinicSettings, useLetterhead, usePatient } from "../../queries.js";
import { BillFooter, BillSheet, clinicFacts } from "./bill-sheet.js";
import { useBillDoctor } from "./bill-doctor.js";
import { METHOD_LABEL } from "./billing-v2-parts.js";
import { useInvoice, usePayments } from "./queries.js";

/** An issued bill on A4: clinic header, the patient and treating doctor, the treatment done, totals, payments and a signature. */
export function InvoicePrintPage() {
  const params = useParams();
  const parsed = invoiceIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const invoice = useInvoice(id);
  const settings = useClinicSettings();
  const letterhead = useLetterhead();
  const patient = usePatient(invoice.data?.patient.id);
  const payments = usePayments();
  const { doctor, toothOf, settled } = useBillDoctor(invoice.data, letterhead.data?.doctors);
  useDocumentTitle(invoice.data?.number ?? "Bill", "Print");
  const ready = invoice.data !== undefined && settings.data !== undefined && !letterhead.isPending && settled && !patient.isLoading && !payments.isLoading;

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
    return <ApiErrorNotice title="That bill address isn't valid" error={{ status: 404, code: "not_found", message: "No such bill." }} />;
  }
  if (invoice.isPending || settings.isPending || letterhead.isPending) {
    return <Skeleton shape="block" />;
  }
  if (invoice.isError) {
    return <ApiErrorNotice title="Couldn't load this bill" error={invoice.error} onRetry={() => void invoice.refetch()} />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load the clinic's details" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  const bill = invoice.data;
  const clinic = clinicFacts(settings.data, letterhead.data);
  const person = patient.data;
  const received = (payments.data?.items ?? []).filter((p) => p.status !== "void" && p.allocations.some((a) => a.invoice_id === bill.id));
  const teeth = bill.items.map((line) => toothOf(line));
  const hasTooth = teeth.some((tooth) => tooth !== undefined);
  const hasDiscount = bill.items.some((line) => line.discount_paise > 0);
  const hasGst = bill.items.some((line) => line.gst_rate > 0);
  const doctorLine = doctor === undefined ? undefined : [doctor.qualifications, doctor.registration === undefined ? undefined : `Reg. No. ${doctor.registration}`].filter((part) => part !== undefined).join(" · ");

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
      <BillSheet clinic={clinic} kind={bill.doc_type === "bill_of_supply" ? "Bill of supply" : "Tax invoice"} number={bill.number ?? "Draft"} date={bill.issued_at == null ? undefined : formatDate(bill.issued_at)} isVoid={bill.status === "void"}>
        <section className="bp-parties" aria-label="Patient and doctor">
          <div className="bp-party">
            <h3>Billed to</h3>
            <p className="bp-strong">{bill.patient.name}</p>
            <p>
              Patient no. <span className="bp-num">{bill.patient.number}</span>
              {person === undefined ? null : ` · ${ageSex(person.age_years, person.sex, person.birth_date_estimated)}`}
            </p>
            {person?.phone == null ? null : <p>Phone {person.phone}</p>}
          </div>
          {doctor === undefined ? null : (
            <div className="bp-party">
              <h3>Treating doctor</h3>
              <p className="bp-strong">{doctor.name}</p>
              {doctorLine === undefined || doctorLine === "" ? null : <p>{doctorLine}</p>}
            </div>
          )}
        </section>

        <section className="bp-section" aria-labelledby="bp-treatment">
          <h3 id="bp-treatment">Treatment done</h3>
          <table className="bp-table">
            <caption className="bp-sr">Treatment and charges</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Treatment</th>
                {hasTooth ? <th scope="col">Tooth</th> : null}
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Rate
                </th>
                {hasDiscount ? (
                  <th scope="col" className="num">
                    Discount
                  </th>
                ) : null}
                {hasGst ? (
                  <th scope="col" className="num">
                    GST
                  </th>
                ) : null}
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((line, index) => (
                <tr key={line.line_no}>
                  <td>{index + 1}</td>
                  <td className="bp-strong">{line.description}</td>
                  {hasTooth ? <td>{teeth[index] ?? "—"}</td> : null}
                  <td className="num">{line.quantity}</td>
                  <td className="num">{formatRupees(line.unit_price_paise)}</td>
                  {hasDiscount ? <td className="num">{line.discount_paise > 0 ? `−${formatRupees(line.discount_paise)}` : "—"}</td> : null}
                  {hasGst ? <td className="num">{line.gst_rate > 0 ? `${String(line.gst_rate)}%` : "Exempt"}</td> : null}
                  <td className="num">{formatRupees(line.total_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="bp-summary">
          <section className="bp-section" aria-labelledby="bp-payments">
            <h3 id="bp-payments">Payments received</h3>
            {received.length === 0 ? (
              <p className="bp-notes">No payments yet.</p>
            ) : (
              <table className="bp-table">
                <caption className="bp-sr">Payments received</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Receipt</th>
                    <th scope="col">Method</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {received.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.received_at)}</td>
                      <td className="bp-num">{p.number}</td>
                      <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="num">{formatRupees(p.allocations.find((a) => a.invoice_id === bill.id)?.amount_paise ?? p.amount_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {bill.notes == null || bill.notes === "" ? null : <p className="bp-notes mt-3">{bill.notes}</p>}
          </section>

          <dl className="bp-totals">
            <dt>Subtotal</dt>
            <dd>{formatRupees(bill.subtotal_paise)}</dd>
            {bill.discount_paise === 0 ? null : (
              <>
                <dt>Discount</dt>
                <dd>−{formatRupees(bill.discount_paise)}</dd>
              </>
            )}
            {bill.cgst_paise === 0 ? null : (
              <>
                <dt>CGST</dt>
                <dd>{formatRupees(bill.cgst_paise)}</dd>
              </>
            )}
            {bill.sgst_paise === 0 ? null : (
              <>
                <dt>SGST</dt>
                <dd>{formatRupees(bill.sgst_paise)}</dd>
              </>
            )}
            {bill.igst_paise === 0 ? null : (
              <>
                <dt>IGST</dt>
                <dd>{formatRupees(bill.igst_paise)}</dd>
              </>
            )}
            {bill.round_off_paise === 0 ? null : (
              <>
                <dt>Round-off</dt>
                <dd>{formatRupees(bill.round_off_paise)}</dd>
              </>
            )}
            <dt className="bp-total">Total</dt>
            <dd className="bp-total">{formatRupees(bill.total_paise)}</dd>
            <dt>Paid</dt>
            <dd>{formatRupees(bill.paid_paise)}</dd>
            <dt className="bp-due">Balance due</dt>
            <dd className="bp-due">{formatRupees(bill.balance_paise)}</dd>
          </dl>
        </div>

        <BillFooter clinic={clinic} signer={doctor === undefined ? undefined : { name: doctor.name, line: doctorLine === "" ? undefined : doctorLine }} />
      </BillSheet>
    </div>
  );
}
