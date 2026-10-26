/**
 * Collect payment, after the visit has ended: the bill for the visit as editable lines (Consultation, a line per treatment done
 * today priced from the price list, more from the list or by hand, an optional discount), then cash, UPI with its QR, or card.
 * Record payment saves the lines to the visit's draft bill, issues it, then records the payment. Each payment is one
 * `POST /payments` with an idempotency key made once per attempt, so a retry after a dropped connection never charges twice.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { apiErrorOf, randomUuid, unwrap, type PaymentMethod } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Drawer, Field, TextInput } from "@sakalya/ui";

import { QrCode } from "../../../components/qr-code.js";
import { useClinic } from "../../../clinic.js";
import { BillEditor } from "./bill-editor.js";
import { PillButton, Pills } from "./kit.js";
import { paiseOf, type FinishedVisit } from "./visit-session.js";
import type { BillDraft } from "./use-bill-draft.js";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
] as const;
type Method = Extract<PaymentMethod, "cash" | "upi" | "card">;

export function CollectPanel({ finished, draft, onClose, onFinish }: { finished: FinishedVisit; draft: BillDraft; onClose: () => void; onFinish: () => void }) {
  const { api, access, can } = useClinic();
  // Without billing.write the payment itself issues the draft (payments.collect); the QR then waits for the bill to be issued.
  const deskIssues = can("billing.write");
  const queryClient = useQueryClient();
  const patientId = finished.visit.patient_id;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["invoice", access.org_id] });
    void queryClient.invalidateQueries({ queryKey: ["payments", access.org_id] });
  };
  const [error, setError] = useState<string | undefined>(undefined);

  // The bill is editable until it is issued (the first payment, or "Confirm the bill").
  const bill = draft.bill;
  const issued = bill !== undefined && bill.status !== "draft" ? bill : undefined;
  const editing = issued === undefined;
  const balance = issued?.balance_paise ?? 0;
  const payable = editing ? draft.total : balance;

  const [method, setMethod] = useState<Method>("cash");
  const [amount, setAmount] = useState("");
  const typedPaise = amount.trim() === "" ? undefined : paiseOf(amount);
  const amountPaise = amount.trim() === "" ? payable : typedPaise;
  const upi = useQuery({
    queryKey: ["upi-link", access.org_id, issued?.id, balance],
    queryFn: () => (issued === undefined ? Promise.reject(new Error("no bill")) : unwrap(api.getInvoiceUpiLink(issued.id))),
    enabled: issued !== undefined && balance > 0 && method === "upi",
    retry: false,
  });

  // The UPI QR needs the bill to exist: save the lines and issue it, then the QR shows.
  const confirm = useMutation({
    mutationFn: async () => draft.issue(await draft.save()),
    onSuccess: refresh,
    onError: (thrown) => {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't save the bill.");
    },
  });

  // One key per attempt: the same while retrying the same payment, a new one once it went through or its details changed.
  const attempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const [paidNow, setPaidNow] = useState(0);
  const pay = useMutation({
    mutationFn: async () => {
      const saved = await draft.save();
      const invoice = deskIssues ? await draft.issue(saved) : saved;
      const due = typedPaise ?? invoice.balance_paise;
      if (due <= 0 || due > invoice.balance_paise) throw new Error("amount");
      const signature = `${invoice.id}|${method}|${String(due)}`;
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: randomUuid() };
      return unwrap(api.recordPayment({ patient_id: patientId, method, amount_paise: due, allocations: [{ invoice_id: invoice.id, amount_paise: due }] }, attempt.current.key));
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

  const overBalance = amountPaise !== undefined && amountPaise > payable;
  const settled = issued !== undefined && balance === 0;
  const waiting = !draft.ready && editing;
  const blocked = editing && draft.problem !== undefined;

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
        {waiting ? (
          <p className="mk-hint" role="status">
            Getting the bill ready…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {editing ? (
              <BillEditor
                lines={draft.lines}
                onLines={draft.setLines}
                discount={draft.discount}
                onDiscount={draft.setDiscount}
                priceList={draft.priceList}
                total={draft.total}
                problem={draft.problem}
              />
            ) : (
              <ul className="p360-bill-lines" aria-label="Bill lines">
                {issued.items.map((line) => (
                  <li key={line.line_no} className="mk-hint" style={{ display: "flex", justifyContent: "space-between", margin: 0 }}>
                    <span>
                      {line.description}
                      {line.quantity > 1 ? ` × ${String(line.quantity)}` : ""}
                    </span>
                    <span>{formatRupees(line.taxable_paise)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="p360-collect-due" aria-live="polite">
              <span className="mk-hint" style={{ margin: 0 }}>
                {issued === undefined ? "To collect" : `${issued.number ?? "Bill"} · ${settled ? "Paid in full" : "Due"}`}
              </span>
              <b>{formatRupees(payable)}</b>
            </p>
            {settled ? null : (
              <>
                <Pills<Method> label="Payment method" options={METHODS} value={method} onChange={setMethod} />
                <Field label="Amount (₹)" hint={`Leave blank to take the full ${formatRupees(payable)}. Enter less for a part payment.`}>
                  <TextInput
                    inputMode="decimal"
                    value={amount}
                    placeholder={String(payable / 100)}
                    onChange={(event) => {
                      setAmount(event.currentTarget.value);
                    }}
                  />
                </Field>
                {method === "upi" ? (
                  issued === undefined && !deskIssues ? (
                    <p className="mk-hint">The QR shows once the bill is issued; record the payment when it arrives.</p>
                  ) : issued === undefined ? (
                    <PillButton
                      variant="ghost"
                      disabled={blocked || confirm.isPending}
                      onClick={() => {
                        setError(undefined);
                        confirm.mutate();
                      }}
                    >
                      {confirm.isPending ? "Saving the bill…" : "Confirm the bill and show the QR"}
                    </PillButton>
                  ) : upi.data === undefined ? (
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
                  disabled={pay.isPending || amountPaise === undefined || amountPaise <= 0 || overBalance || blocked}
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
