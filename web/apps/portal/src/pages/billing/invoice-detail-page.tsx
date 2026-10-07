import { Printer } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { apiErrorOf, randomUuid, invoiceId as invoiceIdSchema, type Invoice, type InvoiceLineInput, type PaymentMethod } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Dialog, Field, Link, Pill, Select, Skeleton, TextArea, TextInput, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useEditInvoice, useInvoice, useIssueInvoice, usePayments, usePriceItems, useRecordPayment, useVoidInvoice } from "./queries.js";
import { PageHeader } from "../../components/mk/index.js";

const STATUS_TONE: Readonly<Record<string, "neutral" | "success" | "warning" | "danger">> = {
  draft: "neutral",
  issued: "success",
  void: "danger",
  unpaid: "warning",
  partial: "warning",
  paid: "success",
};

const METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
];

export function InvoiceDetailPage() {
  const params = useParams();
  const parsed = invoiceIdSchema.safeParse(params.id);
  const id = parsed.success ? parsed.data : undefined;
  const invoice = useInvoice(id);
  const { can } = useClinic();
  useDocumentTitle(invoice.data?.number ?? "Bill", "Billing");

  if (id === undefined) {
    return <ApiErrorNotice title="That bill address isn't valid" error={{ status: 404, code: "not_found", message: "No such bill." }} />;
  }
  if (invoice.isPending) {
    return (
      <div className="p-6" role="status" aria-label="Loading the bill">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (invoice.isError) {
    return <ApiErrorNotice title="Couldn't load this bill" error={invoice.error} onRetry={() => void invoice.refetch()} />;
  }
  return <InvoiceBody invoice={invoice.data} canWrite={can("billing.write")} />;
}

function InvoiceBody({ invoice, canWrite }: { invoice: Invoice; canWrite: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const issue = useIssueInvoice(invoice.id);
  const voidInvoice = useVoidInvoice(invoice.id);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string>();
  const [payOpen, setPayOpen] = useState(false);

  const lineColumns: readonly DataTableColumn<Invoice["items"][number]>[] = [
    { id: "description", header: "Description", cell: (l) => l.description },
    { id: "qty", header: "Qty", align: "end", cell: (l) => String(l.quantity) },
    { id: "unit", header: "Unit price", align: "end", cell: (l) => formatRupees(l.unit_price_paise) },
    { id: "gst", header: "GST", align: "end", cell: (l) => (l.gst_rate > 0 ? `${String(l.gst_rate)}%` : "Exempt") },
    { id: "total", header: "Total", align: "end", cell: (l) => formatRupees(l.total_paise) },
  ];

  return (
    <>
      <PageHeader
        title={invoice.number ?? "Draft bill"}
        subtitle={`${invoice.patient.name} · ${invoice.patient.number}`}
        end={
          <div className="flex flex-wrap gap-2">
            {invoice.status === "issued" ? (
              <Button
                variant="secondary"
                icon={<Printer aria-hidden="true" className="size-4" />}
                onClick={() => {
                  void navigate(`/billing/invoices/${invoice.id}/print`);
                }}
              >
                Print
              </Button>
            ) : null}
            {!canWrite ? null : invoice.status === "draft" ? (
              <Button
                disabled={issue.isPending || invoice.items.length === 0}
                onClick={() => {
                  issue.mutate(undefined, {
                    onError: (thrown) => {
                      toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't issue this bill.", tone: "danger" });
                    },
                  });
                }}
              >
                {issue.isPending ? "Issuing…" : "Issue bill"}
              </Button>
            ) : invoice.status === "issued" ? (
              <>
                {invoice.balance_paise > 0 ? (
                  <Button
                    onClick={() => {
                      setPayOpen(true);
                    }}
                  >
                    Record payment
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  className="border-danger text-danger-text hover:bg-danger-soft"
                  onClick={() => {
                    setVoidOpen(true);
                  }}
                >
                  Void
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone={STATUS_TONE[invoice.status] ?? "neutral"}>{invoice.status}</Pill>
            {invoice.payment_state == null ? null : <Pill tone={STATUS_TONE[invoice.payment_state] ?? "neutral"}>{invoice.payment_state}</Pill>}
            {invoice.issued_at == null ? null : <span className="text-xs text-muted">Issued {formatDateTime(invoice.issued_at)}</span>}
          </div>
          {canWrite && invoice.status === "draft" ? <DraftLines invoice={invoice} /> : <DataTable caption="Lines" columns={lineColumns} rows={invoice.items} rowKey={(l) => String(l.line_no)} />}
          <dl className="mt-4 grid max-w-sm grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-right font-semibold text-text">{formatRupees(invoice.subtotal_paise)}</dd>
            {invoice.discount_paise === 0 ? null : (
              <>
                <dt className="text-muted">Discount</dt>
                <dd className="text-right font-semibold text-text">−{formatRupees(invoice.discount_paise)}</dd>
              </>
            )}
            {invoice.tax_paise === 0 ? null : (
              <>
                <dt className="text-muted">GST</dt>
                <dd className="text-right font-semibold text-text">{formatRupees(invoice.tax_paise)}</dd>
              </>
            )}
            {invoice.round_off_paise === 0 ? null : (
              <>
                <dt className="text-muted">Round-off</dt>
                <dd className="text-right font-semibold text-text">{formatRupees(invoice.round_off_paise)}</dd>
              </>
            )}
            <dt className="font-bold text-text">Total</dt>
            <dd className="text-right text-lg font-extrabold text-text">{formatRupees(invoice.total_paise)}</dd>
            {invoice.status !== "issued" ? null : (
              <>
                <dt className="text-muted">Paid</dt>
                <dd className="text-right font-semibold text-text">{formatRupees(invoice.paid_paise)}</dd>
                <dt className="text-muted">Balance</dt>
                <dd className="text-right font-semibold text-text">{formatRupees(invoice.balance_paise)}</dd>
              </>
            )}
          </dl>
          {invoice.void_reason == null ? null : <p className="mt-3 text-sm text-danger-text">Voided: {invoice.void_reason}</p>}
        </Card>
        {invoice.status === "issued" ? <ReceiptsCard invoiceId={invoice.id} /> : null}
      </div>
      <VoidDialog
        open={voidOpen}
        reason={voidReason}
        setReason={setVoidReason}
        error={voidError}
        pending={voidInvoice.isPending}
        onClose={() => {
          setVoidOpen(false);
          setVoidReason("");
          setVoidError(undefined);
        }}
        onConfirm={() => {
          setVoidError(undefined);
          voidInvoice.mutate(voidReason, {
            onSuccess: () => {
              setVoidOpen(false);
              setVoidReason("");
              toast.show({ title: "Bill voided", tone: "neutral" });
            },
            onError: (thrown) => {
              setVoidError(apiErrorOf(thrown)?.message ?? "Couldn't void this bill. Please try again.");
            },
          });
        }}
      />
      {/* Mounted only while open, so the amount starts from the balance as it is now: the
          balance changes when the bill is issued and with every payment. */}
      {payOpen ? (
        <PaymentDialog
          open
          invoice={invoice}
          onClose={() => {
            setPayOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/** A draft's lines, editable: remove an existing one, or add a new one from the price list or free text. */
function DraftLines({ invoice }: { invoice: Invoice }) {
  const edit = useEditInvoice(invoice.id);
  const priceItems = usePriceItems();
  const [priceItemId, setPriceItemId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitRupees, setUnitRupees] = useState("");
  const [error, setError] = useState<string>();

  const asInput = (l: Invoice["items"][number]): InvoiceLineInput => ({
    price_item_id: l.price_item_id ?? null,
    description: l.description,
    quantity: l.quantity,
    unit_price_paise: l.unit_price_paise,
    discount_paise: l.discount_paise,
    gst_rate: l.gst_rate,
    sac_hsn: l.sac_hsn ?? null,
  });

  const removeLine = (lineNo: number) => {
    edit.mutate({ items: invoice.items.filter((l) => l.line_no !== lineNo).map(asInput) });
  };

  const priceOptions = [
    { value: "", label: "Free text" },
    ...(priceItems.data?.items.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} · ${formatRupees(p.price_paise)}` })) ?? []),
  ];

  const addLine = () => {
    setError(undefined);
    const quantityNumber = Number.parseInt(quantity, 10);
    const unitNumber = Number.parseFloat(unitRupees);
    if (!Number.isFinite(quantityNumber) || quantityNumber < 1) {
      setError("Enter a quantity of at least 1.");
      return;
    }
    if (priceItemId === "" && (description.trim() === "" || !Number.isFinite(unitNumber) || unitNumber < 0)) {
      setError("A free-text line needs a description and a price.");
      return;
    }
    const newLine: InvoiceLineInput = {
      price_item_id: priceItemId === "" ? null : priceItemId,
      description: priceItemId === "" ? description.trim() : null,
      quantity: quantityNumber,
      unit_price_paise: priceItemId === "" ? Math.round(unitNumber * 100) : null,
    };
    edit.mutate(
      { items: [...invoice.items.map(asInput), newLine] },
      {
        onSuccess: () => {
          setPriceItemId("");
          setDescription("");
          setQuantity("1");
          setUnitRupees("");
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't add that line.");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {invoice.items.length === 0 ? (
        <p className="text-sm text-muted">No lines yet. Add the first one below.</p>
      ) : (
        <ul className="divide-y divide-border">
          {invoice.items.map((line) => (
            <li key={line.line_no} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {line.description} · {line.quantity} × {formatRupees(line.unit_price_paise)}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-semibold text-text">{formatRupees(line.total_paise)}</span>
                <Button
                  variant="ghost"
                  onClick={() => {
                    removeLine(line.line_no);
                  }}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 rounded-2xl border border-dashed border-border p-3 sm:grid-cols-[2fr_2fr_80px_120px_auto]">
        <Field label="Item" hideLabel>
          <Select
            options={priceOptions}
            value={priceItemId}
            onValueChange={(value) => {
              const chosen = priceItems.data?.items.find((p) => p.id === value);
              setPriceItemId(value);
              setDescription(chosen?.name ?? "");
              setUnitRupees(chosen === undefined ? "" : (chosen.price_paise / 100).toString());
            }}
          />
        </Field>
        <Field label="Description" hideLabel>
          <TextInput
            placeholder="Description"
            disabled={priceItemId !== ""}
            value={description}
            onChange={(event) => {
              setDescription(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Qty" hideLabel>
          <TextInput
            inputMode="numeric"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Price (₹)" hideLabel>
          <TextInput
            inputMode="decimal"
            disabled={priceItemId !== ""}
            value={unitRupees}
            onChange={(event) => {
              setUnitRupees(event.currentTarget.value);
            }}
          />
        </Field>
        <Button variant="secondary" disabled={edit.isPending} onClick={addLine}>
          Add
        </Button>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

function VoidDialog({
  open,
  reason,
  setReason,
  error,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  reason: string;
  setReason: (value: string) => void;
  error: string | undefined;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Void this bill"
      description="It is kept with its number; bill again to correct it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            className="border-danger text-danger-text hover:bg-danger-soft"
            disabled={pending || reason.trim().length < 3}
            onClick={onConfirm}
          >
            {pending ? "Voiding…" : "Void bill"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" required>
          <TextArea
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function PaymentDialog({ open, invoice, onClose }: { open: boolean; invoice: Invoice; onClose: () => void }) {
  const record = useRecordPayment();
  const toast = useToast();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [rupees, setRupees] = useState(() => (invoice.balance_paise / 100).toString());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => randomUuid());

  const close = () => {
    onClose();
    setMethod("cash");
    setRupees((invoice.balance_paise / 100).toString());
    setReference("");
    setError(undefined);
    setIdempotencyKey(randomUuid());
  };

  const submit = () => {
    setError(undefined);
    const amount = Number.parseFloat(rupees);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an amount more than zero.");
      return;
    }
    const amountPaise = Math.round(amount * 100);
    if (amountPaise > invoice.balance_paise) {
      setError(`That is more than the balance of ${formatRupees(invoice.balance_paise)}. Enter ${formatRupees(invoice.balance_paise)} or less.`);
      return;
    }
    record.mutate(
      {
        input: {
          patient_id: invoice.patient.id,
          method,
          amount_paise: amountPaise,
          allocations: [{ invoice_id: invoice.id, amount_paise: amountPaise }],
          reference: reference.trim() === "" ? null : reference.trim(),
        },
        idempotencyKey,
      },
      {
        onSuccess: (payment) => {
          toast.show({ title: `Receipt ${payment.number} recorded`, tone: "success" });
          close();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't record this payment. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Record a payment"
      description={`Balance: ${formatRupees(invoice.balance_paise)}`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={record.isPending} onClick={submit}>
            {record.isPending ? "Recording…" : "Record payment"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Amount (₹)" required>
          <TextInput
            inputMode="decimal"
            value={rupees}
            onChange={(event) => {
              setRupees(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Method" required>
          <Select options={METHODS} value={method} onValueChange={setMethod} />
        </Field>
        <Field label="Reference" hint="UPI or card reference, optional">
          <TextInput
            value={reference}
            onChange={(event) => {
              setReference(event.currentTarget.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function ReceiptsCard({ invoiceId }: { invoiceId: Invoice["id"] }) {
  const payments = usePayments();
  const receipts = (payments.data?.items ?? []).filter((p) => p.allocations.some((a) => a.invoice_id === invoiceId));
  if (receipts.length === 0) {
    return null;
  }
  return (
    <Card title="Receipts">
      <ul className="divide-y divide-border">
        {receipts.map((payment) => (
          <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span>
              <Link href={`/billing/payments/${payment.id}/receipt`} className="font-mono font-semibold text-primary-text hover:underline">
                {payment.number}
              </Link>
              <span className="ml-2 text-muted">
                {METHODS.find((m) => m.value === payment.method)?.label ?? payment.method} · {formatDateTime(payment.received_at)}
              </span>
            </span>
            <span className="font-semibold text-text">
              {payment.status === "void" ? <Pill tone="danger">Void</Pill> : formatRupees(payment.amount_paise)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
