/**
 * Collect at the front desk or from the bell: the bill's summary (`GET /invoices/{id}/collect-summary`, open to anyone who
 * collects payments, with or without billing access), the method, and for UPI the QR from the summary's link. Recording is
 * one `POST /payments` with an idempotency key made once per attempt, so a retry after a dropped connection never charges
 * twice; a draft bill is issued by the payment itself. From the queue, "Mark done" then closes the token.
 *
 * The bill is named by the bell's row, or found from the token: through the patient's open bills for someone who may read
 * billing, otherwise through the token's "collect payment" notice.
 */
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { apiErrorOf, invoiceId, randomUuid, unwrap, type PaymentMethod, type QueueToken } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Button, Dialog } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { QrCode } from "../../components/qr-code.js";
import { useRefreshVisitData } from "../../lib/visit-refresh.js";
import { useNotifications } from "../../lib/notifications-query.js";
import { useInvoices, useRecordPayment } from "../billing/queries.js";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
] as const;
type Method = Extract<PaymentMethod, "cash" | "upi" | "card">;

/** What to collect: a bill by id (from the bell), or a queue token whose bill is found for it. */
export interface CollectTarget {
  invoiceId?: string | undefined;
  token?: QueueToken | undefined;
  /** The patient's name, when the caller already knows it; the summary names them once it loads. */
  patientName?: string | undefined;
}

export function CollectDialog({
  target,
  onClose,
  onMarkDone,
}: {
  target: CollectTarget | undefined;
  onClose: () => void;
  onMarkDone?: (token: QueueToken) => void;
}) {
  const token = target?.token;
  const name = token?.patient.full_name ?? target?.patientName;
  return (
    <Dialog
      open={target !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Collect payment"
      description={token === undefined ? name : `${token.patient.full_name} · token #${String(token.token_number)}`}
      size="sm"
    >
      {target === undefined ? null : <CollectBody target={target} onMarkDone={onMarkDone} onClose={onClose} />}
    </Dialog>
  );
}

/** The id of the bill to collect: the one named, else the token's open bill from the patient's bills or from the bell's notice. */
function useBillToCollect(target: CollectTarget): { id: string | undefined; pending: boolean } {
  const { can } = useClinic();
  const token = target.token;
  const named = target.invoiceId;
  const viaInvoices = named === undefined && token !== undefined && can("billing.read");
  const viaNotices = named === undefined && token !== undefined && !viaInvoices;
  const invoices = useInvoices(token === undefined ? {} : { patientId: token.patient.id }, viaInvoices);
  const notices = useNotifications(viaNotices);
  if (named !== undefined) return { id: named, pending: false };
  if (viaInvoices) {
    const open = (invoices.data?.items ?? []).filter((i) => i.status !== "void");
    const found = open.find((i) => i.status === "issued" && i.balance_paise > 0) ?? open.find((i) => i.status === "draft");
    return { id: found?.id, pending: invoices.isPending };
  }
  const notice = (notices.data?.items ?? []).find((n) => n.kind === "collect_payment" && n.handled == null && n.queue_token?.id === token?.id);
  return { id: notice?.invoice?.id, pending: viaNotices && notices.isPending };
}

function CollectBody({ target, onMarkDone, onClose }: { target: CollectTarget; onMarkDone: ((token: QueueToken) => void) | undefined; onClose: () => void }) {
  const { api, access } = useClinic();
  const refresh = useRefreshVisitData();
  const token = target.token;
  const bill = useBillToCollect(target);
  const [method, setMethod] = useState<Method>("cash");
  const [error, setError] = useState<string | undefined>(undefined);
  const [paid, setPaid] = useState(0);
  const record = useRecordPayment();

  const summary = useQuery({
    queryKey: ["collect-summary", access.org_id, bill.id],
    queryFn: ({ signal }) => (bill.id === undefined ? Promise.reject(new Error("no bill")) : unwrap(api.getInvoiceCollectSummary(invoiceId.parse(bill.id), { signal }))),
    enabled: bill.id !== undefined && paid === 0,
    retry: false,
  });
  const due = summary.data;
  const justSettled = paid > 0;
  const balance = due?.balance_paise ?? 0;
  const upi = due?.upi ?? undefined;
  const nothing = !justSettled && !bill.pending && (bill.id === undefined || summary.isError);
  const loading = !justSettled && !nothing && (bill.pending || due === undefined);

  // One key per attempt: the same while retrying the same payment, a new one once it went through.
  const attempt = useRef<{ signature: string; key: string } | undefined>(undefined);
  const pay = () => {
    if (due === undefined) return;
    setError(undefined);
    const signature = `${due.invoice_id}|${method}|${String(balance)}`;
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: randomUuid() };
    record.mutate(
      {
        input: { patient_id: due.patient.id, method, amount_paise: balance, allocations: [{ invoice_id: due.invoice_id, amount_paise: balance }] },
        idempotencyKey: attempt.current.key,
      },
      {
        onSuccess: (payment) => {
          attempt.current = undefined;
          setPaid((n) => n + payment.amount_paise);
          void refresh();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record the payment. Try again; it won't be charged twice.");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <p role="status" className="text-sm text-muted">
          Getting the bill…
        </p>
      ) : justSettled ? (
        <>
          <p role="status" className="fd-due">
            <span>Paid in full</span>
            <b>{formatRupees(paid)}</b>
          </p>
          {token !== undefined && onMarkDone !== undefined ? (
            <Button
              onClick={() => {
                onMarkDone(token);
              }}
            >
              Mark done
            </Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </>
      ) : nothing || due === undefined ? (
        <>
          <p className="text-sm text-muted">
            {token === undefined ? "There is nothing left to collect on this bill." : "There is nothing to collect: no open bill for this patient. Make the bill from the visit, or mark the token done."}
          </p>
          {token !== undefined && onMarkDone !== undefined ? (
            <Button
              variant="secondary"
              onClick={() => {
                onMarkDone(token);
              }}
            >
              Mark done
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <p className="fd-due" aria-live="polite">
            <span>{due.number ?? "Bill"} · due</span>
            <b>{formatRupees(balance)}</b>
          </p>
          <p className="text-sm text-muted">{due.patient.name}</p>
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
            upi === undefined ? (
              <p role="status" className="text-sm text-muted">
                This clinic has no UPI ID set. Take cash or card, or add one in Settings.
              </p>
            ) : (
              <figure className="fd-qr">
                <QrCode value={upi.qr_data} size={176} label={`UPI QR for ${formatRupees(balance)} to ${upi.payee_name}`} />
                <figcaption className="text-xs text-muted">
                  {upi.payee_name} · {upi.upi_id}. Record the payment once it arrives.
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
