/**
 * Collect at the front desk: the patient's open bill, the method, and for UPI the QR from the bill's UPI link. Recording
 * is one `POST /payments` with an idempotency key made once per attempt, so a retry after a dropped connection never
 * charges twice. Once the bill is settled, "Mark done" closes the token.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { apiErrorOf, randomUuid, unwrap, type InvoiceId, type PaymentMethod, type QueueToken } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Button, Dialog } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { QrCode } from "../../components/qr-code.js";
import { useInvoices, useRecordPayment } from "../billing/queries.js";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
] as const;
type Method = Extract<PaymentMethod, "cash" | "upi" | "card">;

export function CollectDialog({ token, onClose, onMarkDone }: { token: QueueToken | undefined; onClose: () => void; onMarkDone: (token: QueueToken) => void }) {
  return (
    <Dialog
      open={token !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Collect payment"
      description={token === undefined ? undefined : `${token.patient.full_name} · token #${String(token.token_number)}`}
      size="sm"
    >
      {token === undefined ? null : <CollectBody token={token} onMarkDone={onMarkDone} onClose={onClose} />}
    </Dialog>
  );
}

function CollectBody({ token, onMarkDone, onClose }: { token: QueueToken; onMarkDone: (token: QueueToken) => void; onClose: () => void }) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const invoices = useInvoices({ patientId: token.patient.id });
  const [method, setMethod] = useState<Method>("cash");
  const [error, setError] = useState<string | undefined>(undefined);
  const [paid, setPaid] = useState(0);
  const record = useRecordPayment();

  const candidates = (invoices.data?.items ?? []).filter((i) => i.status !== "void");
  const issued = candidates.find((i) => i.status === "issued" && i.balance_paise > 0);
  const draft = candidates.find((i) => i.status === "draft");
  const justSettled = paid > 0 && issued === undefined;
  const balance = issued?.balance_paise ?? 0;

  const issue = useMutation({
    mutationFn: (id: InvoiceId) => unwrap(api.issueInvoice(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoices", access.org_id] }),
    onError: (thrown) => {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't issue the bill.");
    },
  });

  const upi = useQuery({
    queryKey: ["upi-link", access.org_id, issued?.id, balance],
    queryFn: () => (issued === undefined ? Promise.reject(new Error("no bill")) : unwrap(api.getInvoiceUpiLink(issued.id))),
    enabled: issued !== undefined && method === "upi",
    retry: false,
  });

  // One key per attempt: the same while retrying the same payment, a new one once it went through.
  const attempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const pay = () => {
    if (issued === undefined) return;
    setError(undefined);
    const signature = `${issued.id}|${method}|${String(balance)}`;
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: randomUuid() };
    record.mutate(
      {
        input: { patient_id: token.patient.id, method, amount_paise: balance, allocations: [{ invoice_id: issued.id, amount_paise: balance }] },
        idempotencyKey: attempt.current.key,
      },
      {
        onSuccess: (payment) => {
          attempt.current = undefined;
          setPaid((n) => n + payment.amount_paise);
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record the payment. Try again; it won't be charged twice.");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {invoices.isPending ? (
        <p role="status" className="text-sm text-muted">
          Getting the bill…
        </p>
      ) : justSettled ? (
        <>
          <p role="status" className="fd-due">
            <span>Paid in full</span>
            <b>{formatRupees(paid)}</b>
          </p>
          <Button
            onClick={() => {
              onMarkDone(token);
            }}
          >
            Mark done
          </Button>
        </>
      ) : issued === undefined ? (
        draft !== undefined ? (
          <>
            <p className="text-sm text-muted">The bill is still a draft. Issue it to collect.</p>
            <Button
              disabled={issue.isPending}
              onClick={() => {
                issue.mutate(draft.id);
              }}
            >
              {issue.isPending ? "Issuing…" : "Issue the bill"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">There is nothing to collect: no open bill for this patient. Make the bill from the visit, or mark the token done.</p>
            <Button
              variant="secondary"
              onClick={() => {
                onMarkDone(token);
              }}
            >
              Mark done
            </Button>
          </>
        )
      ) : (
        <>
          <p className="fd-due" aria-live="polite">
            <span>{issued.number ?? "Bill"} · due</span>
            <b>{formatRupees(balance)}</b>
          </p>
          <div role="group" aria-label="Payment method" className="fd-methods">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                className="fd-method"
                aria-pressed={method === m.value}
                onClick={() => {
                  setMethod(m.value);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {method === "upi" ? (
            upi.data === undefined ? (
              <p role="status" className="text-sm text-muted">
                {upi.isError ? (apiErrorOf(upi.error)?.message ?? "No UPI QR for this bill.") : "Loading the QR…"}
              </p>
            ) : (
              <figure className="fd-qr">
                <QrCode value={upi.data.qr_data} size={176} label={`UPI QR for ${formatRupees(upi.data.amount_paise)} to ${upi.data.payee_name}`} />
                <figcaption className="text-xs text-muted">
                  {upi.data.payee_name} · {upi.data.upi_id}. Record the payment once it arrives.
                </figcaption>
              </figure>
            )
          ) : null}
          <Button disabled={record.isPending} onClick={pay}>
            {record.isPending ? "Recording…" : `Record ${formatRupees(balance)} ${method === "upi" ? "UPI" : method}`}
          </Button>
        </>
      )}
      {error === undefined ? null : (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
      {justSettled ? null : (
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );
}
