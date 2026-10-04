import { PackagePlus, ShoppingCart } from "lucide-react";
import { useState } from "react";

import type { StockLevel } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, EmptyState, PageHeader, Skeleton, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ItemDialog } from "./item-dialog.js";
import { NewItemDialog } from "./new-item-dialog.js";
import { LevelBar, StatusTag, categoryLabel, levelPercent } from "./level.js";
import { useExpiring, useStock } from "./queries.js";

/**
 * Stock: the three most urgent items as cards, every item with its level and status, and the
 * purchase-order button. Needs `inventory.read`; changing stock needs `inventory.manage`.
 */
export function StockPage() {
  const { can } = useClinic();
  useDocumentTitle("Stock", "Aarogyam");
  const toast = useToast();
  const allowed = can("inventory.read");
  const canManage = can("inventory.manage");
  const stock = useStock(allowed);
  const expiring = useExpiring(allowed);
  const [openItem, setOpenItem] = useState<StockLevel["item"]["id"]>();
  const [adding, setAdding] = useState(false);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Stock" subtitle="Material and medicine stock levels" />
        <EmptyState title="Stock isn't available to your role" description="Ask the clinic owner for the inventory permission." icon={null} />
      </>
    );
  }

  const items = stock.data?.items ?? [];
  const needOrder = items.filter((l) => l.item.active && (l.status === "low" || l.status === "critical")).length;

  const columns: readonly DataTableColumn<StockLevel>[] = [
    {
      id: "item",
      header: "Item",
      cell: (l) => (
        <button
          type="button"
          className="rounded-md text-left font-semibold text-text hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={() => {
            setOpenItem(l.item.id);
          }}
        >
          {l.item.name}
        </button>
      ),
      sortValue: (l) => l.item.name,
    },
    { id: "category", header: "Category", cell: (l) => categoryLabel(l.item.category), sortValue: (l) => l.item.category },
    {
      id: "stock",
      header: "In stock",
      cell: (l) => `${formatNumber(l.on_hand)} / ${formatNumber(l.item.reorder_level)}`,
      sortValue: (l) => l.on_hand,
    },
    { id: "level", header: "Level", cell: (l) => <LevelBar name={l.item.name} percent={levelPercent(l)} />, sortValue: (l) => levelPercent(l) },
    { id: "status", header: "Status", cell: (l) => <StatusTag status={l.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="Material and medicine stock levels"
        end={
          canManage ? (
            <Button
              variant="secondary"
              icon={<PackagePlus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setAdding(true);
              }}
            >
              New item
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        {stock.isError ? <ApiErrorNotice title="Couldn't load stock" error={stock.error} onRetry={() => void stock.refetch()} /> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Most urgent items">
          {stock.isPending
            ? [0, 1, 2].map((n) => <Skeleton key={n} shape="block" />)
            : items.slice(0, 3).map((l) => (
                <Card key={l.item.id}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-bold tracking-tight text-text">{l.item.name}</h2>
                    <StatusTag status={l.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {categoryLabel(l.item.category)} · reorder at {formatNumber(l.item.reorder_level)}
                  </p>
                  <p className="mt-3">
                    <b className="text-3xl font-extrabold tracking-tight tabular-nums text-text">{formatNumber(l.on_hand)}</b>
                    <span className="text-xs text-muted"> units</span>
                  </p>
                  <LevelBar name={l.item.name} percent={levelPercent(l)} />
                </Card>
              ))}
        </div>

        <Card
          title="Inventory"
          action={
            <Button
              icon={<ShoppingCart aria-hidden="true" className="size-4" />}
              disabled={!canManage}
              onClick={() => {
                toast.show({ title: `Purchase order drafted for ${String(needOrder)} low ${needOrder === 1 ? "item" : "items"}`, tone: "success" });
              }}
            >
              Purchase order
            </Button>
          }
        >
          {expiring.data !== undefined && expiring.data.items.length > 0 ? (
            <p className="mb-3 text-sm text-muted">
              Expiring soon: {expiring.data.items.map((b) => `${b.item_name} (${formatDate(b.expiry)})`).join(", ")}
            </p>
          ) : null}
          <DataTable
            caption="Inventory"
            columns={columns}
            rows={items}
            rowKey={(l) => l.item.id}
            loading={stock.isPending}
            pageSize={Infinity}
            empty={{ title: "No items yet", description: "Add the materials the clinic stocks to track them here.", icon: null }}
          />
        </Card>
      </div>
      <ItemDialog
        itemId={openItem}
        onClose={() => {
          setOpenItem(undefined);
        }}
      />
      <NewItemDialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
      />
    </>
  );
}
