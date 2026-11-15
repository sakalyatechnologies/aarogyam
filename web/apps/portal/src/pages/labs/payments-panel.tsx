import { useState } from "react";

import { apiErrorOf, type LabPayment } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees } from "@aarogyam/app-kit";
import { Button, DateInput, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { Skeleton, Tag } from "../../components/mk/index.js";
import { useTodayDate } from "../../lib/patients.js";
import { useLabBalance, useLabPayments, useRecordLabPayment, useVoidLabPayment } from "./queries.js";

const MAX_RUPEES = 10_000_000;

/** The methods the API takes, the same as a patient's payment; "none" records no method. */
const METHODS = [
  { value: "none", label: "Not recorded" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
] as const;
const methodLabel = (method: string): string => METHODS.find((m) => m.value === method)?.label ?? method;

/** What a lab is owed, the payments so far, and recording or voiding one. Shown only to roles with `expenses.write` and `finance.view`. */
export function PaymentsPanel({ vendorId }: { vendorId: string }) {
  const toast = useToast();
  const today = useTodayDate();
  const balance = useLabBalance(vendorId, true);
  const payments = useLabPayments(vendorId, true);
  const record = useRecordLabPayment();
  const voidPayment = useVoidLabPayment();
  const [rupees, setRupees] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<string>("none");
  const [error, setError] = useState<string>();
  const [voiding, setVoiding] = useState<string>();
  const [reason, setReason] = useState("");
  const [voidError, setVoidError] = useState<string>();

  const submit = () => {
    setError(undefined);
    const amount = Number(rupees.replaceAll(",", ""));
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_RUPEES) {
      setError("Enter more than ₹0 and at most ₹1,00,00,000.");
      return;
    }
    record.mutate(
      {
        vendor_id: vendorId,
        paid_on: paidOn === "" ? today : paidOn,
        amount_paise: Math.round(amount * 100),
        ...(ref.trim() === "" ? {} : { lab_invoice_ref: ref.trim() }),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
        ...(method === "none" ? {} : { method }),
      },
      {
        onSuccess: () => {
          toast.show({ title: `${formatRupees(Math.round(amount * 100))} recorded`, tone: "success" });
          setRupees("");
          setRef("");
          setNote("");
          setPaidOn("");
          setMethod("none");
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record this payment. Please try again.");
        },
      },
    );
  };

  const confirmVoid = (payment: LabPayment) => {
    setVoidError(undefined);
    if (reason.trim().length < 3) {
      setVoidError("Give a reason of at least 3 characters.");
      return;
    }
    voidPayment.mutate(
      { id: payment.id, reason: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.show({ title: "Payment voided", tone: "success" });
          setVoiding(undefined);
          setReason("");
        },
        onError: (thrown) => {
          setVoidError(apiErrorOf(thrown)?.message ?? "Couldn't void this payment. Please try again.");
        },
      },
    );
  };

  return (
    <section aria-labelledby="lb-pay-h" className="lb-pay">
      <h3 id="lb-pay-h" className="mk-flabel">
        Payments
      </h3>
      {balance.isPending ? (
        <Skeleton shape="line" />
      ) : balance.isError ? (
        <ApiErrorNotice title="Couldn't load the balance" error={balance.error} />
      ) : (
        <dl className="lb-balance" aria-label="Balance">
          <div>
            <dt>Billed</dt>
            <dd>{formatRupees(balance.data.billed_paise)}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>{formatRupees(balance.data.paid_paise)}</dd>
          </div>
          <div className={balance.data.due_paise > 0 ? "due" : ""}>
            <dt>Still owed</dt>
            <dd>{formatRupees(balance.data.due_paise)}</dd>
          </div>
        </dl>
      )}
      <form
        className="lb-form"
        aria-label="Record a payment"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="lb-two">
          <Field label="Amount (₹)" required>
            <TextInput inputMode="decimal" value={rupees} autoComplete="off" onChange={(event) => { setRupees(event.currentTarget.value); }} />
          </Field>
          <Field label="Paid on">
            <DateInput value={paidOn === "" ? today : paidOn} max={today} onValueChange={setPaidOn} />
          </Field>
        </div>
        <div className="lb-two">
          <Field label="Paid by">
            <Select options={METHODS} value={method} onValueChange={setMethod} />
          </Field>
          <Field label="Lab's invoice number">
            <TextInput value={ref} maxLength={60} onChange={(event) => { setRef(event.currentTarget.value); }} />
          </Field>
        </div>
        <div className="lb-two">
          <Field label="Note">
            <TextInput value={note} maxLength={300} onChange={(event) => { setNote(event.currentTarget.value); }} />
          </Field>
        </div>
        {error === undefined ? null : (
          <p role="alert" className="lb-error">
            {error}
          </p>
        )}
        <div className="lb-actions">
          <Button type="submit" disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </form>
      {payments.isPending ? (
        <Skeleton shape="line" />
      ) : payments.isError ? (
        <ApiErrorNotice title="Couldn't load the payments" error={payments.error} />
      ) : payments.data.items.length === 0 ? (
        <p className="lb-sub">No payments recorded yet.</p>
      ) : (
        <ul className="lb-pays" aria-label="Payments so far">
          {payments.data.items.map((payment) => (
            <li key={payment.id}>
              <div>
                <b>{formatRupees(payment.amount_paise)}</b> · {formatDate(payment.paid_on)}
                {payment.method == null ? "" : ` · ${methodLabel(payment.method)}`}
                {payment.lab_invoice_ref == null ? "" : ` · invoice ${payment.lab_invoice_ref}`}
                {payment.status === "void" ? (
                  <>
                    {" "}
                    <Tag tone="neutral">Void</Tag>
                    <span className="lb-sub"> {payment.void_reason}</span>
                  </>
                ) : null}
              </div>
              {payment.status === "void" ? null : voiding === payment.id ? (
                <form
                  className="lb-void"
                  aria-label="Void this payment"
                  onSubmit={(event) => {
                    event.preventDefault();
                    confirmVoid(payment);
                  }}
                >
                  <Field label="Reason for voiding" required>
                    <TextInput value={reason} maxLength={500} onChange={(event) => { setReason(event.currentTarget.value); }} />
                  </Field>
                  {voidError === undefined ? null : (
                    <p role="alert" className="lb-error">
                      {voidError}
                    </p>
                  )}
                  <div className="lb-actions">
                    <Button type="submit" variant="secondary" disabled={voidPayment.isPending}>
                      Void payment
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setVoiding(undefined);
                        setReason("");
                        setVoidError(undefined);
                      }}
                    >
                      Keep it
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="lb-btn"
                  aria-label={`Void the payment of ${formatRupees(payment.amount_paise)} on ${formatDate(payment.paid_on)}`}
                  onClick={() => {
                    setVoiding(payment.id);
                    setReason("");
                    setVoidError(undefined);
                  }}
                >
                  Void
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
