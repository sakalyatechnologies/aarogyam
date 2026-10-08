import { Boxes, CalendarClock, CircleCheck, PackagePlus, ShoppingCart } from "lucide-react";
import { useState } from "react";

import type { StockLevel } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatNumber, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, DataTable, useToast, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ItemDialog } from "./item-dialog.js";
import { NewItemDialog } from "./new-item-dialog.js";
import { LevelBar, StatusTag, categoryLabel, levelPercent } from "./level.js";
import { useExpiring, useStock } from "./queries.js";
import { AlertBanner, EmptyState, MkCard, PageHeader, Skeleton, StatTile } from "../../components/mk/index.js";

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
        <PageHeader eyebrow="Inventory" title="Stock" subtitle="Material and medicine stock levels" />
        <MkCard>
          <EmptyState art="stock" title="Stock isn't available to your role" description="Ask the clinic owner for the inventory permission." />
        </MkCard>
      </>
    );
  }

  const items = stock.data?.items ?? [];
  const empty = !stock.isPending && !stock.isError && items.length === 0;
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
        eyebrow="Inventory"
        title="Stock"
        subtitle={stock.isPending ? "Material and medicine stock levels" : `${String(items.length)} items tracked · ${String(needOrder)} to reorder`}
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
        {empty ? (
          <MkCard>
            <EmptyState
              art="stock"
              title="Start tracking your stock"
              description={
                canManage
                  ? "Add the materials and medicines the clinic keeps, with a reorder level for each. Low levels and expiry dates then show up here and on Today."
                  : "Nothing is tracked yet. Someone with the inventory permission can add the materials and medicines the clinic keeps."
              }
              action={
                canManage ? (
                  <button
                    type="button"
                    className="mk-btn mk-btn-primary"
                    onClick={() => {
                      setAdding(true);
                    }}
                  >
                    <PackagePlus aria-hidden="true" /> Add the first item
                  </button>
                ) : undefined
              }
            />
          </MkCard>
        ) : (
          <>
            <div className="mk-stats" style={{ marginBottom: 0 }}>
              {stock.isPending ? (
                [0, 1, 2, 3].map((n) => <Skeleton key={n} shape="stat" />)
              ) : (
                <>
                  <StatTile label="Items tracked" value={items.filter((l) => l.item.active).length} icon={<Boxes />} />
                  <StatTile label="To reorder" value={needOrder} tone="warn" icon={<ShoppingCart />} trend={needOrder > 0 ? { direction: "up", text: "Below reorder level", good: false } : { direction: "flat", text: "All stocked" }} />
                  <StatTile label="Expiring soon" value={expiring.data?.items.length ?? "—"} icon={<CalendarClock />} />
                  <StatTile label="Healthy" value={items.filter((l) => l.status === "ok").length} icon={<CircleCheck />} />
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Most urgent items">
              {stock.isPending
                ? [0, 1, 2].map((n) => <Skeleton key={n} shape="block" />)
                : items.slice(0, 3).map((l) => (
                    <section key={l.item.id} className="mk-card">
                      <div className="mk-card-h">
                        <h2>{l.item.name}</h2>
                        <StatusTag status={l.status} />
                      </div>
                      <p className="mk-hint" style={{ marginBottom: 10 }}>
                        {categoryLabel(l.item.category)} · reorder at {formatNumber(l.item.reorder_level)}
                      </p>
                      <p style={{ margin: "0 0 4px" }}>
                        <b className="mk-stat-v">{formatNumber(l.on_hand)}</b>
                        <span className="mk-hint"> units</span>
                      </p>
                      <LevelBar name={l.item.name} percent={levelPercent(l)} />
                    </section>
                  ))}
            </div>
          </>
        )}
        {expiring.data !== undefined && expiring.data.items.length > 0 ? (
          <AlertBanner tone="info">
            <b>Expiring soon:</b> {expiring.data.items.map((b) => `${b.item_name} (${formatDate(b.expiry)})`).join(", ")}
          </AlertBanner>
        ) : null}

        {empty ? null : (
        <MkCard
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
          <DataTable
            caption="Inventory"
            columns={columns}
            rows={items}
            rowKey={(l) => l.item.id}
            loading={stock.isPending}
            pageSize={Infinity}
            empty={{ title: "No items yet", description: "Add the materials the clinic stocks to track them here.", icon: null }}
          />
        </MkCard>
        )}
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
