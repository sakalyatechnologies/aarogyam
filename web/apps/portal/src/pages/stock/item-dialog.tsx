import { useState } from "react";

import { apiErrorOf, type InventoryItemId, type StockBatch } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatNumber, formatRupees } from "@aarogyam/app-kit";
import { Button, DataTable, DateInput, Dialog, Field, Select, Skeleton, TextInput, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { LevelBar, StatusTag, categoryLabel, levelPercent } from "./level.js";
import { useAdjustStock, useExpireBatch, useInventoryItem, useReceiveStock, useSuppliers, useUseStock } from "./queries.js";

type Action = "receive" | "use" | "adjust";

const ACTIONS: readonly { value: Action; label: string }[] = [
  { value: "receive", label: "Receive a delivery" },
  { value: "use", label: "Use stock" },
  { value: "adjust", label: "Correct after a count" },
];

const KIND_LABEL: Readonly<Record<string, string>> = { receive: "Received", use: "Used", adjust: "Corrected", expire: "Written off" };

function wholeNumber(text: string): number | undefined {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) ? value : undefined;
}

/** One item: where it stands, its deliveries and history, and (with `inventory.manage`) receive, use and correct. */
export function ItemDialog({ itemId, onClose }: { itemId: InventoryItemId | undefined; onClose: () => void }) {
  const { can } = useClinic();
  const detail = useInventoryItem(itemId);
  const level = detail.data?.stock;
  return (
    <Dialog
      open={itemId !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={level?.item.name ?? "Stock item"}
      description={level === undefined ? undefined : `${categoryLabel(level.item.category)} · counted in ${level.item.unit}`}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {detail.isPending ? (
        <Skeleton shape="block" />
      ) : detail.isError ? (
        <ApiErrorNotice title="Couldn't load this item" error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <div className="flex flex-col gap-5">
          <section aria-label="Level">
            <div className="flex items-center justify-between gap-3">
              <p>
                <b className="text-2xl font-extrabold tabular-nums">{formatNumber(detail.data.stock.on_hand)}</b>
                <span className="text-sm text-muted"> on hand · reorder at {formatNumber(detail.data.stock.item.reorder_level)}</span>
              </p>
              <StatusTag status={detail.data.stock.status} />
            </div>
            <LevelBar name={detail.data.stock.item.name} percent={levelPercent(detail.data.stock)} />
          </section>
          {can("inventory.manage") ? <StockForm itemId={detail.data.stock.item.id} /> : null}
          <Batches itemId={detail.data.stock.item.id} batches={detail.data.batches} />
          <section aria-label="History">
            <h3 className="mb-2 text-sm font-bold text-text">Latest changes</h3>
            {detail.data.movements.length === 0 ? (
              <p className="text-sm text-muted">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {detail.data.movements.slice(0, 10).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {KIND_LABEL[m.kind] ?? m.kind}
                      {m.reason == null ? "" : ` · ${m.reason}`}
                    </span>
                    <span className="text-muted tabular-nums">
                      {m.quantity > 0 ? "+" : ""}
                      {formatNumber(m.quantity)} · {formatDateTime(m.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function Batches({ itemId, batches }: { itemId: InventoryItemId; batches: readonly StockBatch[] }) {
  const { can } = useClinic();
  const expire = useExpireBatch();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const columns: readonly DataTableColumn<StockBatch>[] = [
    { id: "batch", header: "Batch", cell: (b) => b.batch_no ?? "—" },
    { id: "expiry", header: "Expiry", cell: (b) => (b.expiry == null ? "None" : formatDate(`${b.expiry}T00:00:00+05:30`)) },
    { id: "left", header: "Left", align: "end", cell: (b) => `${formatNumber(b.quantity)} of ${formatNumber(b.received_quantity)}` },
    { id: "cost", header: "Unit cost", align: "end", cell: (b) => formatRupees(b.unit_cost_paise) },
    {
      id: "actions",
      header: "Write off",
      hideHeader: true,
      cell: (b) =>
        can("inventory.manage") && b.quantity > 0 && b.expiry != null && b.expiry < today ? (
          <Button
            variant="secondary"
            disabled={expire.isPending}
            onClick={() => {
              expire.mutate(
                { id: b.id, input: {} },
                {
                  onSuccess: () => {
                    toast.show({ title: "Expired stock written off", tone: "neutral" });
                  },
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't write this off.", tone: "danger" });
                  },
                },
              );
            }}
          >
            Write off
          </Button>
        ) : null,
    },
  ];
  return (
    <section aria-label="Deliveries" data-item={itemId}>
      <h3 className="mb-2 text-sm font-bold text-text">Deliveries</h3>
      <DataTable
        caption="Deliveries"
        columns={columns}
        rows={batches}
        rowKey={(b) => b.id}
        pageSize={Infinity}
        empty={{ title: "No deliveries yet", description: "Receive a delivery to put stock on the shelf.", icon: null }}
      />
    </section>
  );
}

function StockForm({ itemId }: { itemId: InventoryItemId }) {
  const receive = useReceiveStock();
  const use = useUseStock();
  const adjust = useAdjustStock();
  const suppliers = useSuppliers();
  const toast = useToast();
  const [action, setAction] = useState<Action>("receive");
  const [quantity, setQuantity] = useState("");
  const [expiry, setExpiry] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const pending = receive.isPending || use.isPending || adjust.isPending;

  const done = (title: string) => {
    toast.show({ title, tone: "success" });
    setQuantity("");
    setExpiry("");
    setBatchNo("");
    setCost("");
    setReason("");
  };
  const failed = (thrown: unknown) => {
    setError(apiErrorOf(thrown)?.message ?? "Couldn't save this change. Please try again.");
  };

  const submit = () => {
    setError(undefined);
    const units = wholeNumber(quantity);
    if (units === undefined || units === 0 || (action !== "adjust" && units < 0)) {
      setError(action === "adjust" ? "Enter a whole number of units, not zero; negative takes stock off." : "Enter a whole number of units, at least 1.");
      return;
    }
    if (action === "receive") {
      const rupees = cost.trim() === "" ? 0 : Number(cost);
      if (!Number.isFinite(rupees) || rupees < 0) {
        setError("Enter the cost of one unit in rupees, or leave it empty.");
        return;
      }
      receive.mutate(
        {
          item_id: itemId,
          quantity: units,
          unit_cost_paise: Math.round(rupees * 100),
          expiry: expiry === "" ? null : expiry,
          batch_no: batchNo.trim() === "" ? null : batchNo.trim(),
          supplier_id: supplier === "" ? null : supplier,
        },
        { onSuccess: () => { done("Delivery received"); }, onError: failed },
      );
    } else if (action === "use") {
      use.mutate(
        { item_id: itemId, quantity: units, reason: reason.trim() === "" ? null : reason.trim() },
        { onSuccess: () => { done("Stock used"); }, onError: failed },
      );
    } else {
      if (reason.trim() === "") {
        setError("Say why: a count correction needs a reason.");
        return;
      }
      adjust.mutate(
        { item_id: itemId, quantity: units, reason: reason.trim(), expiry: units > 0 && expiry !== "" ? expiry : null },
        { onSuccess: () => { done("Stock corrected"); }, onError: failed },
      );
    }
  };

  return (
    <form
      aria-label="Change stock"
      noValidate
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Field label="What happened">
        <Select
          options={ACTIONS}
          value={action}
          onValueChange={(next) => {
            setAction(next);
            setError(undefined);
          }}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={action === "adjust" ? "Units (negative takes off)" : "Units"} required>
          <TextInput
            inputMode="numeric"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.currentTarget.value);
            }}
          />
        </Field>
        {action === "receive" ? (
          <>
            <Field label="Batch number">
              <TextInput
                value={batchNo}
                onChange={(event) => {
                  setBatchNo(event.currentTarget.value);
                }}
              />
            </Field>
            <Field label="Expiry date" hint="Leave empty when it doesn't expire">
              <DateInput value={expiry} onValueChange={setExpiry} />
            </Field>
            <Field label="Cost of one unit (₹)">
              <TextInput
                inputMode="decimal"
                value={cost}
                onChange={(event) => {
                  setCost(event.currentTarget.value);
                }}
              />
            </Field>
            <Field label="Supplier">
              <Select
                options={[{ value: "", label: "Not recorded" }, ...(suppliers.data?.items ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))]}
                value={supplier}
                onValueChange={setSupplier}
              />
            </Field>
          </>
        ) : (
          <Field label={action === "adjust" ? "Reason" : "Reason (optional)"} required={action === "adjust"}>
            <TextInput
              value={reason}
              onChange={(event) => {
                setReason(event.currentTarget.value);
              }}
            />
          </Field>
        )}
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : action === "receive" ? "Receive" : action === "use" ? "Use" : "Correct"}
        </Button>
      </div>
    </form>
  );
}
