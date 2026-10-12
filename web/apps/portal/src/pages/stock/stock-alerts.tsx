import { CircleCheck, ShoppingCart, TriangleAlert } from "lucide-react";

import type { InventoryItemId, StockInsight } from "@aarogyam/api-client";
import { Button } from "@sakalya/ui";

import { HEALTHY, coverText, reorderText } from "./projection.js";

/**
 * The strip at the top of Stock (New look): the items that are low or will run out soon, each with how long it
 * lasts, the quantity to order and a Reorder action. When nothing is running low it says so, warmly.
 */
export function StockAlertsStrip({ items, canManage, onReorder }: { items: readonly StockInsight[]; canManage: boolean; onReorder: (id: InventoryItemId) => void }) {
  if (items.length === 0) {
    return (
      <section aria-label="Stock alerts" className="st2-strip is-calm">
        <CircleCheck aria-hidden="true" className="size-5 text-success-text" />
        <p className="st2-calm">{HEALTHY}</p>
      </section>
    );
  }
  return (
    <section aria-label="Stock alerts" className="st2-strip">
      <h2 className="flex items-center gap-2">
        <TriangleAlert aria-hidden="true" className="size-4 text-warning-text" />
        {items.length === 1 ? "1 item needs a look" : `${String(items.length)} items need a look`}
      </h2>
      <ul className="st2-list">
        {items.map((i) => {
          const suggestion = reorderText(i.suggested_reorder_qty, i.unit);
          return (
            <li key={i.item_id} className="st2-row">
              <div>
                <p className="st2-name">{i.name}</p>
                <p className="st2-sub">
                  <span className="st2-warn">{coverText(i.days_cover)}</span>
                  {suggestion === undefined ? "" : ` · ${suggestion}`}
                </p>
              </div>
              {canManage ? (
                <Button
                  variant="secondary"
                  icon={<ShoppingCart aria-hidden="true" className="size-4" />}
                  aria-label={`Reorder ${i.name}`}
                  onClick={() => {
                    onReorder(i.item_id);
                  }}
                >
                  Reorder
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
