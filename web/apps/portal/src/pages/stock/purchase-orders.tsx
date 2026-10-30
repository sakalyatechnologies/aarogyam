import { useState } from "react";

import { apiErrorOf, purchaseOrderId, type PurchaseOrder, type PurchaseOrderStatus, type StockLevel } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber, formatRupees } from "@aarogyam/app-kit";
import { Button, DataTable, Dialog, Field, Select, TextInput, useToast, type DataTableColumn } from "@sakalya/ui";

import { EmptyState, MkCard, Skeleton } from "../../components/mk/index.js";
import { useCreatePurchaseOrder, useDeletePurchaseOrder, usePurchaseOrders, useReceivePurchaseOrder, useUpdatePurchaseOrder } from "./order-queries.js";
import { useStock, useSuppliers } from "./queries.js";

const STATUS_LABEL: Readonly<Record<PurchaseOrderStatus, string>> = { draft: "Draft", ordered: "Ordered", received: "Received", cancelled: "Cancelled" };

/** Purchase orders (New look): the list, a draft from the Reorder suggestions, then mark ordered and receive. Needs `inventory.read`; changes need `inventory.manage`. */
export function PurchaseOrdersTab({ canManage }: { canManage: boolean }) {
  const orders = usePurchaseOrders();
  const [drafting, setDrafting] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const items = orders.data?.items ?? [];
  const open = items.find((o) => o.id === openId);

  const columns: readonly DataTableColumn<PurchaseOrder>[] = [
    {
      id: "number",
      header: "Order",
      cell: (o) => (
        <button
          type="button"
          className="rounded-md text-left font-semibold text-text hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => {
            setOpenId(o.id);
          }}
        >
          {o.number}
        </button>
      ),
      sortValue: (o) => o.number,
    },
    { id: "supplier", header: "Supplier", cell: (o) => o.supplier_name, sortValue: (o) => o.supplier_name },
    { id: "lines", header: "Items", align: "end", cell: (o) => formatNumber(o.lines.length) },
    { id: "status", header: "Status", cell: (o) => STATUS_LABEL[o.status], sortValue: (o) => o.status },
    { id: "expected", header: "Expected", cell: (o) => (o.expected_on == null ? "—" : formatDate(`${o.expected_on}T00:00:00+05:30`)) },
    ...(items.some((o) => o.total_paise != null)
      ? [{ id: "total", header: "Total", align: "end" as const, cell: (o: PurchaseOrder) => (o.total_paise == null ? "—" : formatRupees(o.total_paise)) }]
      : []),
  ];

  return (
    <>
      <MkCard
        title="Purchase orders"
        action={
          canManage ? (
            <Button
              onClick={() => {
                setDrafting(true);
              }}
            >
              Draft from Reorder
            </Button>
          ) : undefined
        }
      >
        {orders.isPending ? (
          <Skeleton shape="block" />
        ) : orders.isError ? (
          <ApiErrorNotice title="Couldn't load purchase orders" error={orders.error} onRetry={() => void orders.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            art="stock"
            title="No purchase orders yet"
            description={canManage ? "Draft one from the items that need reordering, send it to the supplier, then receive it here." : "Orders the clinic places with its suppliers will show here."}
          />
        ) : (
          <DataTable caption="Purchase orders" columns={columns} rows={items} rowKey={(o) => o.id} pageSize={Infinity} empty={{ title: "No orders", description: "", icon: null }} />
        )}
      </MkCard>
      <ReorderDialog
        open={drafting}
        onClose={() => {
          setDrafting(false);
        }}
        onCreated={(id) => {
          setDrafting(false);
          setOpenId(id);
        }}
      />
      <OrderDialog
        order={open}
        canManage={canManage}
        onClose={() => {
          setOpenId(undefined);
        }}
      />
    </>
  );
}

/** The items that need ordering: each one's `suggested_order` (up to its maximum level), editable, for one supplier. */
function ReorderDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const stock = useStock(open);
  const suppliers = useSuppliers(open);
  const create = useCreatePurchaseOrder();
  const toast = useToast();
  const [supplier, setSupplier] = useState("");
  const [edited, setEdited] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<string>();

  const suggested = (stock.data?.items ?? []).filter((l: StockLevel) => l.item.active && (l.suggested_order ?? 0) > 0);
  const activeSuppliers = (suppliers.data?.items ?? []).filter((s) => s.active);
  const chosen = supplier === "" ? activeSuppliers[0]?.id : supplier;
  const quantityOf = (l: StockLevel) => {
    const text = edited[l.item.id] ?? String(l.suggested_order ?? 0);
    const n = Number(text);
    return text.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : undefined;
  };

  const close = () => {
    onClose();
    setEdited({});
    setSupplier("");
    setError(undefined);
  };

  const submit = () => {
    setError(undefined);
    if (chosen === undefined) {
      setError("Add a supplier first, then draft the order.");
      return;
    }
    const lines = suggested.map((l) => ({ item_id: l.item.id, quantity: quantityOf(l) }));
    if (lines.some((l) => l.quantity === undefined)) {
      setError("Each quantity must be a whole number.");
      return;
    }
    const filled = lines.flatMap((l) => (l.quantity === undefined || l.quantity === 0 ? [] : [{ item_id: l.item_id, quantity: l.quantity }]));
    if (filled.length === 0) {
      setError("Nothing to order.");
      return;
    }
    create.mutate(
      { supplier_id: chosen, lines: filled, order_now: false },
      {
        onSuccess: (order) => {
          toast.show({ title: `${order.number} drafted`, tone: "success" });
          onCreated(order.id);
          setEdited({});
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't draft this order. Please try again.");
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
      title="Draft a purchase order"
      description="Items below their maximum level, with the quantity that brings each back up to it."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={create.isPending || suggested.length === 0} onClick={submit}>
            {create.isPending ? "Drafting…" : "Draft order"}
          </Button>
        </>
      }
    >
      {stock.isPending || suppliers.isPending ? (
        <Skeleton shape="block" />
      ) : stock.isError ? (
        <ApiErrorNotice title="Couldn't load stock" error={stock.error} onRetry={() => void stock.refetch()} />
      ) : suppliers.isError ? (
        <ApiErrorNotice title="Couldn't load suppliers" error={suppliers.error} onRetry={() => void suppliers.refetch()} />
      ) : suggested.length === 0 ? (
        <EmptyState art="stock" title="Nothing to reorder" description="Set a maximum level on an item and it shows here once its stock falls below it." />
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Supplier" required>
            <Select
              options={activeSuppliers.map((s) => ({ value: s.id, label: s.name }))}
              value={chosen ?? ""}
              onValueChange={setSupplier}
            />
          </Field>
          <ul aria-label="Items to order" className="divide-y divide-border text-sm">
            {suggested.map((l) => (
              <li key={l.item.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <b>{l.item.name}</b>
                  <span className="text-muted">
                    {" "}
                    · {formatNumber(l.on_hand)} on hand, up to {formatNumber(l.item.max_level ?? 0)}
                  </span>
                </span>
                <TextInput
                  aria-label={`Quantity of ${l.item.name}`}
                  inputMode="numeric"
                  className="w-24"
                  value={edited[l.item.id] ?? String(l.suggested_order ?? 0)}
                  onChange={(event) => {
                    const text = event.currentTarget.value;
                    setEdited((e) => ({ ...e, [l.item.id]: text }));
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {error === undefined ? null : (
        <p role="alert" className="mt-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** One order and what can happen next: a draft is sent or deleted, a sent order is received or cancelled. */
function OrderDialog({ order, canManage, onClose }: { order: PurchaseOrder | undefined; canManage: boolean; onClose: () => void }) {
  const update = useUpdatePurchaseOrder();
  const remove = useDeletePurchaseOrder();
  const receive = useReceivePurchaseOrder();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const busy = update.isPending || remove.isPending || receive.isPending;

  const failed = (thrown: unknown) => {
    setError(apiErrorOf(thrown)?.message ?? "Couldn't save this change. Please try again.");
  };
  const close = () => {
    setError(undefined);
    onClose();
  };
  const run = (title: string, action: (id: ReturnType<typeof purchaseOrderId.parse>, done: () => void) => void) => {
    if (order === undefined) return;
    setError(undefined);
    action(purchaseOrderId.parse(order.id), () => {
      toast.show({ title, tone: "success" });
    });
  };

  return (
    <Dialog
      open={order !== undefined}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={order?.number ?? "Purchase order"}
      description={order === undefined ? undefined : `${order.supplier_name} · ${STATUS_LABEL[order.status]}`}
      size="lg"
      footer={
        <>
          {canManage && order?.status === "draft" ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  run("Draft deleted", (id, done) => {
                    remove.mutate(id, { onSuccess: () => { done(); close(); }, onError: failed });
                  });
                }}
              >
                Delete draft
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  run("Marked as ordered", (id, done) => {
                    update.mutate({ id, input: { status: "ordered" } }, { onSuccess: done, onError: failed });
                  });
                }}
              >
                Mark ordered
              </Button>
            </>
          ) : null}
          {canManage && order?.status === "ordered" ? (
            <>
              {order.receipts.length === 0 ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    run("Order cancelled", (id, done) => {
                      update.mutate({ id, input: { status: "cancelled" } }, { onSuccess: done, onError: failed });
                    });
                  }}
                >
                  Cancel order
                </Button>
              ) : null}
              <Button
                disabled={busy}
                onClick={() => {
                  run("Delivery received into stock", (id, done) => {
                    receive.mutate({ id, input: {} }, { onSuccess: done, onError: failed });
                  });
                }}
              >
                {receive.isPending ? "Receiving…" : "Receive all"}
              </Button>
            </>
          ) : null}
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        </>
      }
    >
      {order === undefined ? null : (
        <div className="flex flex-col gap-3">
          {order.expected_on == null ? null : <p className="text-sm text-muted">Expected {formatDate(`${order.expected_on}T00:00:00+05:30`)}</p>}
          <ul aria-label="Order lines" className="divide-y divide-border text-sm">
            {order.lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span>{l.item_name}</span>
                <span className="text-muted tabular-nums">
                  {formatNumber(l.received_quantity)} of {formatNumber(l.quantity)} {l.unit}
                  {l.unit_cost_paise == null ? "" : ` · ${formatRupees(l.unit_cost_paise)} each`}
                </span>
              </li>
            ))}
          </ul>
          {order.notes == null || order.notes === "" ? null : <p className="text-sm">{order.notes}</p>}
          {error === undefined ? null : (
            <p role="alert" className="text-sm font-medium text-danger-text">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
