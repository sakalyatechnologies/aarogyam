import { useEffect, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { apiErrorOf, randomUuid, unwrap, type Invoice, type Payment, type PaymentMethod } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Field, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { QrCode } from "../../components/qr-code.js";
import { Segments } from "../../components/mk/index.js";
import { allocateOldestFirst } from "./billing-v2-parts.js";
import { useRecordPayment } from "./queries.js";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
] as const;
type Method = Extract<PaymentMethod, "cash" | "upi" | "card">;

/** What a typed rupee amount stands for in paise, or `undefined` when it is blank, zero or not a number. */
export function paiseFromText(text: string): number | undefined {
  const rupees = Number.parseFloat(text.replaceAll(",", "").trim());
  if (!Number.isFinite(rupees) || rupees <= 0) return undefined;
  return Math.round(rupees * 100);
}

/** A `upi://pay` link for an amount across several bills, in the same shape the API builds for one bill. */
function upiUri(upiId: string, payee: string, amountPaise: number, note: string): string {
  const rupees = `${String(Math.floor(amountPaise / 100))}.${String(amountPaise % 100).padStart(2, "0")}`;
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payee)}&am=${rupees}&cu=INR&tn=${encodeURIComponent(note)}`;
}

/**
 * Collects from one patient for one or more bills (oldest first): the amount (all that is owed until typed over), the
 * method, the UPI QR, and one `POST /payments` allocated oldest bill first. One idempotency key per attempt, so a retry
 * returns the first payment instead of charging twice.
 */
export function CollectForm({ patientId, bills, onRecorded }: { patientId: Invoice["patient"]["id"]; bills: readonly [Invoice, ...Invoice[]]; onRecorded?: (payment: Payment) => void }) {
  const { api, access } = useClinic();
  const toast = useToast();
  const record = useRecordPayment();
  const oldest = bills[0];
  const several = bills.length > 1;
  const owed = bills.reduce((sum, bill) => sum + bill.balance_paise, 0);
  const [typed, setTyped] = useState<string>();
  const [method, setMethod] = useState<Method>("cash");
  const [error, setError] = useState<string>();
  const amountText = typed ?? String(owed / 100);
  const amountPaise = paiseFromText(amountText);
  const over = amountPaise !== undefined && amountPaise > owed;
  const shares = amountPaise === undefined || over ? [] : allocateOldestFirst(bills, amountPaise);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);

  const upi = useQuery({
    queryKey: ["upi-link", access.org_id, oldest.id, oldest.balance_paise],
    queryFn: () => unwrap(api.getInvoiceUpiLink(oldest.id)),
    enabled: method === "upi",
    retry: false,
  });
  // The API's link is for one bill; for several, the same payee is asked for the total owed.
  const qrOf = (link: { qr_data: string; upi_id: string; payee_name: string; amount_paise: number }) =>
    several ? { data: upiUri(link.upi_id, link.payee_name, owed, `Bills ${bills.map((b) => b.number ?? "").join(" ")}`.trim()), amount: owed } : { data: link.qr_data, amount: link.amount_paise };

  // One key per attempt: the same while retrying the same payment, a new one once it went through or its details changed.
  const attempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const submit = () => {
    setError(undefined);
    if (amountPaise === undefined) {
      setError("Enter an amount more than zero.");
      return;
    }
    if (over) {
      setError(`That is more than the ${several ? "total owed" : "balance"} of ${formatRupees(owed)}.`);
      return;
    }
    const allocations = shares.map((s) => ({ invoice_id: s.invoice_id, amount_paise: s.amount_paise }));
    const signature = `${patientId}|${method}|${String(amountPaise)}|${allocations.map((a) => `${a.invoice_id}:${String(a.amount_paise)}`).join(",")}`;
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: randomUuid() };
    record.mutate(
      { input: { patient_id: patientId, method, amount_paise: amountPaise, allocations, reference: null }, idempotencyKey: attempt.current.key },
      {
        onSuccess: (payment) => {
          attempt.current = undefined;
          setTyped(undefined);
          toast.show({ title: `Receipt ${payment.number} recorded`, tone: "success" });
          onRecorded?.(payment);
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record the payment. Try again; it won't be charged twice.");
        },
      },
    );
  };

  return (
    <form
      className="bl2-collect"
      aria-label="Collect a payment"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label="Amount (₹)" hint={several ? `Total owed ${formatRupees(owed)} on ${String(bills.length)} bills` : `Balance ${formatRupees(owed)}`}>
        <TextInput
          ref={field}
          inputMode="decimal"
          value={amountText}
          onChange={(event) => {
            setTyped(event.currentTarget.value);
          }}
        />
      </Field>
      {several ? (
        <div>
          <p className="mk-flabel" id="bl2-split">
            How it is split, oldest bill first
          </p>
          <ul className="bl2-split" aria-labelledby="bl2-split">
            {bills.map((bill) => {
              const share = shares.find((s) => s.invoice_id === bill.id)?.amount_paise ?? 0;
              return (
                <li key={bill.id}>
                  <span className="mk-mono">{bill.number ?? "Draft"}</span>
                  <span className="bl2-sub">of {formatRupees(bill.balance_paise)}</span>
                  <strong>{formatRupees(share)}</strong>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <Segments label="Payment method" options={METHODS} value={method} onChange={setMethod} />
      {method === "upi" ? (
        upi.isPending ? (
          <p className="bl2-sub" role="status">
            Making the UPI code…
          </p>
        ) : upi.isError ? (
          <p className="bl2-sub">{apiErrorOf(upi.error)?.message ?? "The UPI code isn't available."} You can still record the payment.</p>
        ) : (
          <figure className="bl2-qr">
            <QrCode value={qrOf(upi.data).data} size={160} label={`UPI QR for ${formatRupees(qrOf(upi.data).amount)} to ${upi.data.payee_name}`} />
            <figcaption className="bl2-sub">
              {upi.data.payee_name} · {upi.data.upi_id}. Scans for {several ? "the total owed" : "the full balance"}; record the payment once it arrives.
            </figcaption>
          </figure>
        )
      ) : null}
      {error === undefined ? null : (
        <p role="alert" className="bl2-error">
          {error}
        </p>
      )}
      <button type="submit" className="bl2-btn dark" disabled={record.isPending}>
        {record.isPending ? "Recording…" : amountPaise === undefined ? "Record payment" : `Record ${formatRupees(amountPaise)}`}
      </button>
    </form>
  );
}
