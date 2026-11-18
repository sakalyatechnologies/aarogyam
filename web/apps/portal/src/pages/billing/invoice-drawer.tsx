import { MessageCircle, Mail, Printer, WalletCards } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { useMutation } from "@tanstack/react-query";

import { apiErrorOf, randomUuid, unwrap, type Invoice, type Payment } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, formatRupees } from "@aarogyam/app-kit";
import { Drawer, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { Skeleton, StatusChip } from "../../components/mk/index.js";
import { invoiceStatus } from "../../lib/invoice-status.js";
import { CHIP_TONE } from "./billing-v2-parts.js";
import { useBillDoctor } from "./bill-doctor.js";
import { CollectForm } from "./collect-form.js";
import { useInvoice, usePayments } from "./queries.js";

const METHOD_LABEL: Readonly<Record<string, string>> = { cash: "Cash", upi: "UPI", card: "Card", bank: "Bank" };

/** One bill in full from the Billing list: lines, payments and the balance, with Collect, Print and Share. */
export function InvoiceDrawer({ invoiceId, collect, onClose }: { invoiceId: Invoice["id"] | undefined; collect: boolean; onClose: () => void }) {
  const invoice = useInvoice(invoiceId);
  return (
    <Drawer
      open={invoiceId !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={invoice.data === undefined ? "Bill" : `${invoice.data.number ?? "Draft bill"} · ${invoice.data.patient.name}`}
      description="Lines, payments and what is left to pay"
      size="md"
    >
      {invoice.isPending ? (
        <div role="status" aria-label="Loading the bill">
          <Skeleton shape="block" />
        </div>
      ) : invoice.isError ? (
        <ApiErrorNotice
          title="Couldn't load this bill"
          error={invoice.error}
          onRetry={() => {
            void invoice.refetch();
          }}
        />
      ) : (
        <InvoiceBody invoice={invoice.data} startCollect={collect} />
      )}
    </Drawer>
  );
}

function InvoiceBody({ invoice, startCollect }: { invoice: Invoice; startCollect: boolean }) {
  const { can, access } = useClinic();
  const status = invoiceStatus(invoice);
  const { doctor } = useBillDoctor(invoice);
  const payments = usePayments();
  const receipts = (payments.data?.items ?? []).filter((p) => p.allocations.some((a) => a.invoice_id === invoice.id));
  const canCollect = can("billing.write") && invoice.status === "issued" && invoice.balance_paise > 0;
  const [collecting, setCollecting] = useState(startCollect);
  const printable = invoice.status === "issued";

  return (
    <div className="bl2-drawer">
      <div className="bl2-dhead">
        <StatusChip tone={CHIP_TONE[status.key]}>{status.label}</StatusChip>
        {invoice.issued_at == null ? null : <span className="bl2-sub">Issued {formatDateTime(invoice.issued_at)}</span>}
      </div>
      <dl className="bl2-from">
        <div>
          <dt>Clinic</dt>
          <dd>{access.name}</dd>
        </div>
        {doctor === undefined ? null : (
          <div>
            <dt>Doctor</dt>
            <dd>
              {doctor.name}
              {doctor.registration === undefined ? null : <small> · Reg. No. {doctor.registration}</small>}
            </dd>
          </div>
        )}
        <div>
          <dt>Patient</dt>
          <dd>
            {invoice.patient.name} <small className="mk-mono">{invoice.patient.number}</small>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="bl2-d-lines">
        <h3 id="bl2-d-lines" className="mk-flabel">
          Lines
        </h3>
        {invoice.items.length === 0 ? (
          <p className="bl2-sub">No lines on this bill.</p>
        ) : (
          <table className="bl2-lines">
            <caption className="mk-sr">Lines on this bill</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((line) => (
                <tr key={line.line_no}>
                  <td>{line.description}</td>
                  <td className="num">{line.quantity}</td>
                  <td className="num">{formatRupees(line.total_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <dl className="bl2-sum">
          <dt>Subtotal</dt>
          <dd>{formatRupees(invoice.subtotal_paise)}</dd>
          {invoice.discount_paise === 0 ? null : (
            <>
              <dt>Discount</dt>
              <dd>−{formatRupees(invoice.discount_paise)}</dd>
            </>
          )}
          {invoice.tax_paise === 0 ? null : (
            <>
              <dt>GST</dt>
              <dd>{formatRupees(invoice.tax_paise)}</dd>
            </>
          )}
          <dt>Total</dt>
          <dd>{formatRupees(invoice.total_paise)}</dd>
          <dt>Paid</dt>
          <dd>{formatRupees(invoice.paid_paise)}</dd>
          <dt className="bal">Balance</dt>
          <dd className="bal">{formatRupees(invoice.balance_paise)}</dd>
        </dl>
        {invoice.void_reason == null ? null : <p className="bl2-error">Voided: {invoice.void_reason}</p>}
      </section>

      <section aria-labelledby="bl2-d-pay">
        <h3 id="bl2-d-pay" className="mk-flabel">
          Payments
        </h3>
        {payments.isError ? (
          <p className="bl2-sub">Couldn't load the payments.</p>
        ) : receipts.length === 0 ? (
          <p className="bl2-sub">{payments.isPending ? "Loading payments…" : "No payments yet."}</p>
        ) : (
          <ul className="bl2-pays" aria-label="Payments on this bill">
            {receipts.map((p) => (
              <PaymentRow key={p.id} payment={p} invoiceId={invoice.id} />
            ))}
          </ul>
        )}
      </section>

      <div className="bl2-actions" role="group" aria-label="Bill actions">
        {canCollect ? (
          <button
            type="button"
            className="bl2-btn dark"
            aria-expanded={collecting}
            onClick={() => {
              setCollecting((now) => !now);
            }}
          >
            <WalletCards aria-hidden="true" /> Collect
          </button>
        ) : null}
        {printable ? (
          <Link className="bl2-btn" to={`/billing/invoices/${invoice.id}/print`}>
            <Printer aria-hidden="true" /> Print
          </Link>
        ) : null}
      </div>

      {canCollect && collecting ? <CollectForm patientId={invoice.patient.id} bills={[invoice]} /> : null}
      {printable ? <ShareBar invoice={invoice} /> : null}
    </div>
  );
}

function PaymentRow({ payment, invoiceId }: { payment: Payment; invoiceId: Invoice["id"] }) {
  const share = payment.allocations.find((a) => a.invoice_id === invoiceId)?.amount_paise ?? payment.amount_paise;
  return (
    <li className={payment.status === "void" ? "is-void" : undefined}>
      <span>
        <Link to={`/billing/payments/${payment.id}/receipt`} className="mk-mono">
          {payment.number}
        </Link>
        <span className="bl2-sub">
          {" "}
          {METHOD_LABEL[payment.method] ?? payment.method} · {formatDateTime(payment.received_at)}
        </span>
      </span>
      <strong>{payment.status === "void" ? "Void" : formatRupees(share)}</strong>
    </li>
  );
}

/** Sends the bill by email through the message queue (needs `messages.send`), or hands it to WhatsApp as text. */
function ShareBar({ invoice }: { invoice: Invoice }) {
  const { api, can, access } = useClinic();
  const toast = useToast();
  const text = `Bill ${invoice.number ?? ""} from ${access.name}: total ${formatRupees(invoice.total_paise)}, balance ${formatRupees(invoice.balance_paise)}.`;
  const batch = useRef(randomUuid());
  const email = useMutation({
    mutationFn: () =>
      unwrap(api.sendMessages({ patient_ids: [invoice.patient.id], channel: "email", template_key: "care.note", batch_id: batch.current, body: text, variables: { subject: `Your bill ${invoice.number ?? ""}`.trim() } })),
    onSuccess: (queued) => {
      batch.current = randomUuid();
      const title =
        queued.queued > 0
          ? "Bill queued to email"
          : (queued.no_consent ?? 0) > 0
            ? "Not sent: the patient has declined messages from the clinic"
            : (queued.no_address ?? 0) > 0
              ? "Not sent: the patient has no email address"
              : "The bill was already emailed";
      toast.show({ title, tone: queued.queued > 0 ? "success" : "danger" });
    },
    onError: (thrown) => {
      toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't email the bill.", tone: "danger" });
    },
  });
  return (
    <div className="bl2-actions" role="group" aria-label="Share the bill">
      <span className="bl2-sub">Share</span>
      <a className="bl2-btn" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
        <MessageCircle aria-hidden="true" /> WhatsApp
      </a>
      {can("messages.send") ? (
        <button
          type="button"
          className="bl2-btn"
          disabled={email.isPending}
          onClick={() => {
            email.mutate();
          }}
        >
          <Mail aria-hidden="true" /> {email.isPending ? "Sending…" : "Email"}
        </button>
      ) : null}
    </div>
  );
}
