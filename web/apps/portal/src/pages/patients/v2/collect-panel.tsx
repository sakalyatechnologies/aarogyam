/**
 * Collect payment, after the visit has ended: the bill for the visit (made from a fee when there is none yet, issued
 * when it is a draft), then cash, UPI with its QR, or card. Each payment is one `POST /payments` with an idempotency
 * key made once per attempt, so a retry after a dropped connection never charges twice.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { apiErrorOf, randomUuid, unwrap, type Invoice, type PaymentMethod } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Drawer, Field, TextInput } from "@sakalya/ui";

import { QrCode } from "../../../components/qr-code.js";
import { useClinic } from "../../../clinic.js";
import { useInvoices } from "../../billing/queries.js";
import { PillButton, Pills } from "./kit.js";
import { paiseOf, type FinishedVisit } from "./visit-session.js";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
] as const;
type Method = Extract<PaymentMethod, "cash" | "upi" | "card">;

export function CollectPanel({ finished, onClose, onFinish }: { finished: FinishedVisit; onClose: () => void; onFinish: () => void }) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const patientId = finished.visit.patient_id;
  const invoices = useInvoices({ patientId });
  const bill = invoices.data?.items.find((i) => i.encounter_id === finished.visit.id && i.status !== "void");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["payments", access.org_id] });
  };

  // A bill from a fee (when the visit ended without one), then issued when it is still a draft.
  const [fee, setFee] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const prepare = useMutation({
    mutationFn: async (input: { existing: Invoice | undefined; feePaise: number | undefined }): Promise<Invoice> => {
      let current = input.existing;
      if (current === undefined) {
        if (input.feePaise === undefined) throw new Error("fee");
        current = await unwrap(
          api.createInvoice({
            patient_id: patientId,
            encounter_id: finished.visit.id,
            items: [{ description: "Consultation", quantity: 1, unit_price_paise: input.feePaise, gst_rate: 0 }],
          }),
        );
      }
      return current.status === "draft" ? unwrap(api.issueInvoice(current.id)) : current;
    },
    onSuccess: refresh,
    onError: (thrown) => {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't prepare the bill.");
    },
  });
  const issuing = useRef(false);
  useEffect(() => {
    if (bill?.status === "draft" && !issuing.current) {
      issuing.current = true;
      prepare.mutate({ existing: bill, feePaise: undefined });
    }
  }, [bill, prepare]);

  const issued = bill?.status === "issued" ? bill : undefined;
  const balance = issued?.balance_paise ?? 0;

  const [method, setMethod] = useState<Method>("cash");
  const [amount, setAmount] = useState("");
  const amountPaise = amount.trim() === "" ? balance : paiseOf(amount);
  const upi = useQuery({
    queryKey: ["upi-link", access.org_id, issued?.id, balance],
    queryFn: () => (issued === undefined ? Promise.reject(new Error("no bill")) : unwrap(api.getInvoiceUpiLink(issued.id))),
    enabled: issued !== undefined && balance > 0 && method === "upi",
    retry: false,
  });

  // One key per attempt: the same while retrying the same payment, a new one once it went through or its details changed.
  const attempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const [paidNow, setPaidNow] = useState(0);
  const pay = useMutation({
    mutationFn: async () => {
      if (issued === undefined || amountPaise === undefined) throw new Error("amount");
      const signature = `${issued.id}|${method}|${String(amountPaise)}`;
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: randomUuid() };
      const payment = await unwrap(
        api.recordPayment({ patient_id: patientId, method, amount_paise: amountPaise, allocations: [{ invoice_id: issued.id, amount_paise: amountPaise }] }, attempt.current.key),
      );
      return payment;
    },
    onSuccess: (payment) => {
      attempt.current = undefined;
      setPaidNow((n) => n + payment.amount_paise);
      setAmount("");
      setError(undefined);
      refresh();
    },
    onError: (thrown) => {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't record the payment. Try again; it won't be charged twice.");
    },
  });

  const overBalance = amountPaise !== undefined && amountPaise > balance;
  const settled = issued !== undefined && balance === 0;

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Collect payment"
      size="md"
    >
      <div className="p360-drawer-body p360-collect">
        {invoices.isPending || (bill?.status === "draft" && prepare.isIdle) ? (
          <p className="mk-hint" role="status">
            Getting the bill ready…
          </p>
        ) : bill === undefined ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError(undefined);
              prepare.mutate({ existing: undefined, feePaise: paiseOf(fee) });
            }}
          >
            <p className="mk-hint" style={{ margin: 0 }}>
              This visit has no bill yet. Enter what it costs.
            </p>
            <Field label="Fee (₹)" required>
              <TextInput
                inputMode="decimal"
                value={fee}
                onChange={(event) => {
                  setFee(event.currentTarget.value);
                }}
              />
            </Field>
            <PillButton type="submit" disabled={prepare.isPending || paiseOf(fee) === undefined}>
              {prepare.isPending ? "Making the bill…" : "Make the bill"}
            </PillButton>
          </form>
        ) : issued === undefined ? (
          <p className="mk-hint" role="status">
            Getting the bill ready…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="p360-collect-due" aria-live="polite">
              <span className="mk-hint" style={{ margin: 0 }}>
                {issued.number ?? "Bill"} · {settled ? "Paid in full" : "Due"}
              </span>
              <b>{formatRupees(balance)}</b>
            </p>
            {settled ? null : (
              <>
                <Pills<Method> label="Payment method" options={METHODS} value={method} onChange={setMethod} />
                <Field label="Amount (₹)" hint={`Leave blank to take the full ${formatRupees(balance)}.`}>
                  <TextInput
                    inputMode="decimal"
                    value={amount}
                    placeholder={String(balance / 100)}
                    onChange={(event) => {
                      setAmount(event.currentTarget.value);
                    }}
                  />
                </Field>
                {method === "upi" ? (
                  upi.data === undefined ? (
                    <p className="mk-hint" role="status">
                      {upi.isError ? (apiErrorOf(upi.error)?.message ?? "No UPI QR for this bill.") : "Loading the QR…"}
                    </p>
                  ) : (
                    <figure className="p360-qr">
                      <QrCode value={upi.data.qr_data} size={168} label={`UPI QR for ${formatRupees(upi.data.amount_paise)} to ${upi.data.payee_name}`} />
                      <figcaption className="mk-hint">
                        {upi.data.payee_name} · {upi.data.upi_id}. Record the payment once it arrives.
                      </figcaption>
                    </figure>
                  )
                ) : null}
                {overBalance ? (
                  <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: 0 }}>
                    That is more than what is due.
                  </p>
                ) : null}
                <PillButton
                  disabled={pay.isPending || amountPaise === undefined || overBalance}
                  onClick={() => {
                    setError(undefined);
                    pay.mutate();
                  }}
                >
                  {pay.isPending ? "Recording…" : "Record payment"}
                </PillButton>
              </>
            )}
            {paidNow > 0 ? (
              <p role="status" className="mk-hint" style={{ margin: 0 }}>
                Recorded {formatRupees(paidNow)}.
              </p>
            ) : null}
            <PillButton variant={settled ? "primary" : "ghost"} onClick={onFinish}>
              Finish
            </PillButton>
          </div>
        )}
        {error === undefined ? null : (
          <p role="alert" className="mk-hint" style={{ color: "var(--red)", margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </Drawer>
  );
}
