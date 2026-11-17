import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, type LabPayment } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees } from "@aarogyam/app-kit";
import { Button, Field, Select, TextInput, useToast } from "@sakalya/ui";
import { DatePicker } from "../../components/mk/date-picker.js";

import { Skeleton, Tag } from "../../components/mk/index.js";
import { useTodayDate } from "../../lib/patients.js";
import { useLabBalance, useLabPaymentProofLink, useLabPayments, useRecordLabPayment, useUploadLabPaymentProof, useVoidLabPayment } from "./queries.js";

const MAX_RUPEES = 10_000_000;

/** What a proof of payment may be, and how large: the same as a patient's file. Checked here before sending; the server checks the content. */
const PROOF_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const PROOF_ACCEPT = PROOF_TYPES.join(",");

/** Why a file can't be a proof, or `undefined` when it can. */
function proofProblem(file: File): string | undefined {
  if (!PROOF_TYPES.includes(file.type)) return "Choose a JPEG or PNG photo, or a PDF.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_PROOF_BYTES) return "Choose a file of at most 10 MB.";
  return undefined;
}

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
  const uploadProof = useUploadLabPaymentProof();
  const proofLink = useLabPaymentProofLink();
  const [rupees, setRupees] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<string>("none");
  const [error, setError] = useState<string>();
  const [voiding, setVoiding] = useState<string>();
  const [reason, setReason] = useState("");
  const [voidError, setVoidError] = useState<string>();
  const [proof, setProof] = useState<File>();
  const [proofError, setProofError] = useState<string>();
  /** A payment that was recorded but whose proof didn't upload: offered a retry. */
  const [failed, setFailed] = useState<{ payment: LabPayment; file: File; message: string }>();
  const formFile = useRef<HTMLInputElement>(null);
  const laterFile = useRef<HTMLInputElement>(null);
  const [addingTo, setAddingTo] = useState<LabPayment>();

  const choose = (file: File | undefined, input: HTMLInputElement, onChosen: (file: File) => void) => {
    setProofError(undefined);
    if (file === undefined) return;
    const problem = proofProblem(file);
    if (problem !== undefined) {
      input.value = "";
      setProofError(problem);
      return;
    }
    onChosen(file);
  };

  /** Uploads a proof for a payment; a failure keeps the payment and offers a retry. */
  const sendProof = (payment: LabPayment, file: File, recorded: string) => {
    setFailed(undefined);
    uploadProof.mutate(
      { id: payment.id, file },
      {
        onSuccess: () => {
          toast.show({ title: `${recorded} with proof`, tone: "success" });
        },
        onError: (thrown) => {
          setFailed({ payment, file, message: apiErrorOf(thrown)?.message ?? "Please try again." });
        },
      },
    );
  };

  const viewProof = (payment: LabPayment) => {
    proofLink.mutate(payment.id, {
      onSuccess: (link) => {
        window.open(link.url, "_blank", "noopener,noreferrer");
      },
      onError: (thrown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't open that proof.", tone: "danger" });
      },
    });
  };

  const submit = () => {
    setError(undefined);
    const amount = Number(rupees.replaceAll(",", ""));
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_RUPEES) {
      setError("Enter more than ₹0 and at most ₹1,00,00,000.");
      return;
    }
    const attached = proof;
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
        onSuccess: (payment) => {
          const recorded = `${formatRupees(Math.round(amount * 100))} recorded`;
          if (attached === undefined) {
            toast.show({ title: recorded, tone: "success" });
          } else {
            sendProof(payment, attached, recorded);
          }
          setProof(undefined);
          setProofError(undefined);
          if (formFile.current !== null) formFile.current.value = "";
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
          <Field label="Paid on" id="lab-paid-on">
            <DatePicker id="lab-paid-on" label="Paid on" value={paidOn === "" ? today : paidOn} max={today} today={today} onChange={setPaidOn} />
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
          <Field label="Proof (photo or PDF)">
            <input
              ref={formFile}
              type="file"
              accept={PROOF_ACCEPT}
              aria-label="Proof (photo or PDF)"
              onChange={(event) => {
                const input = event.currentTarget;
                setProof(undefined);
                choose(input.files?.[0], input, setProof);
              }}
            />
          </Field>
        </div>
        {error === undefined ? null : (
          <p role="alert" className="lb-error">
            {error}
          </p>
        )}
        {proofError === undefined ? null : (
          <p role="alert" className="lb-error">
            {proofError}
          </p>
        )}
        <div className="lb-actions">
          <Button type="submit" disabled={record.isPending || uploadProof.isPending}>
            {record.isPending ? "Recording…" : "Record payment"}
          </Button>
        </div>
      </form>
      {failed === undefined ? null : (
        <div role="alert" className="lb-error lb-retry">
          <span>
            The payment of {formatRupees(failed.payment.amount_paise)} is recorded, but its proof didn't upload. {failed.message}
          </span>
          <div className="lb-actions">
            <Button
              variant="secondary"
              disabled={uploadProof.isPending}
              onClick={() => {
                sendProof(failed.payment, failed.file, `${formatRupees(failed.payment.amount_paise)} recorded`);
              }}
            >
              Try the proof again
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFailed(undefined);
              }}
            >
              Skip it
            </Button>
          </div>
        </div>
      )}
      <input
        ref={laterFile}
        type="file"
        hidden
        accept={PROOF_ACCEPT}
        aria-label="Proof file to add"
        onChange={(event) => {
          const input = event.currentTarget;
          const target = addingTo;
          choose(input.files?.[0], input, (file) => {
            if (target !== undefined) sendProof(target, file, "Proof added");
          });
          input.value = "";
        }}
      />
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
              {payment.proof != null ? (
                <button
                  type="button"
                  className="lb-btn"
                  aria-label={`View proof for the payment of ${formatRupees(payment.amount_paise)} on ${formatDate(payment.paid_on)}`}
                  disabled={proofLink.isPending}
                  onClick={() => {
                    viewProof(payment);
                  }}
                >
                  <Paperclip aria-hidden="true" />
                  View proof
                </button>
              ) : payment.status === "void" ? null : (
                <button
                  type="button"
                  className="lb-btn"
                  aria-label={`Add proof to the payment of ${formatRupees(payment.amount_paise)} on ${formatDate(payment.paid_on)}`}
                  disabled={uploadProof.isPending}
                  onClick={() => {
                    setAddingTo(payment);
                    laterFile.current?.click();
                  }}
                >
                  <Paperclip aria-hidden="true" />
                  Add proof
                </button>
              )}
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
