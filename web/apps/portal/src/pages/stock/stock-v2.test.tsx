import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inventoryItemId, success, type ApiClient, type InventoryItemAlertChanges, type StockInsight } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, renderPortal } from "../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

type Insight = StockInsight;

/** Builds one insight row on top of a real item id so the dialogs resolve. */
function insight(base: Partial<Insight> & Pick<Insight, "item_id" | "name">): Insight {
  return {
    unit: "piece",
    on_hand: 10,
    daily_usage: 2,
    usage_7d: 14,
    usage_28d: 56,
    series: Array.from({ length: 28 }, (_, i) => ({ day: new Date(Date.UTC(2026, 8, 6 + i)).toISOString().slice(0, 10), quantity: i % 5 })),
    days_cover: 5,
    runs_out_on: "2026-10-08",
    reorder_level: 20,
    lead_time_days: 7,
    alerts_enabled: true,
    suggested_reorder_qty: 40,
    needs_reorder: true,
    reorder_reason: "projected",
    ...base,
  };
}

/** Swaps the analytics for known rows, taking the real item ids from the fake stock list. */
function withAnalytics(rows: (ids: readonly { id: string; name: string }[]) => Insight[], patch?: (calls: InventoryItemAlertChanges[]) => Partial<ApiClient>) {
  const calls: InventoryItemAlertChanges[] = [];
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    getStockAnalytics: async (params, options) => {
      const stock = await client.getStock(options);
      if (!stock.ok) return stock;
      const all = rows(stock.value.items.map((l) => ({ id: l.item.id, name: l.item.name })));
      const shown = params?.itemId === undefined ? all : all.filter((r) => r.item_id === params.itemId);
      return success({ items: shown, reorder_list: shown.filter((r) => r.needs_reorder) });
    },
    ...patch?.(calls),
  });
  return { wrap, calls };
}

const pick = (ids: readonly { id: string; name: string }[], name: string): Insight["item_id"] => {
  const found = ids.find((i) => i.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return inventoryItemId.parse(found.id);
};

const rowsOf = (ids: readonly { id: string; name: string }[]): Insight[] => [
  insight({ item_id: pick(ids, "Composite A2"), name: "Composite A2", days_cover: 5, suggested_reorder_qty: 40 }),
  insight({ item_id: pick(ids, "Gloves (box)"), name: "Gloves (box)", days_cover: 20, needs_reorder: false, reorder_reason: null, suggested_reorder_qty: 0 }),
  insight({ item_id: pick(ids, "Polish cups"), name: "Polish cups", days_cover: null, runs_out_on: null, daily_usage: null, reorder_reason: "low", suggested_reorder_qty: null }),
];

describe("Stock alerts and analytics (New look)", () => {
  it("shows the alerts strip with the projection, the suggested quantity and a Reorder action", async () => {
    const user = userEvent.setup();
    const { wrap } = withAnalytics(rowsOf);
    renderPortal("/stock", { as: PEOPLE.farah, wrap });
    const strip = await screen.findByRole("region", { name: "Stock alerts" });
    await within(strip).findByText("Composite A2");
    expect(within(strip).getByText("Runs out in about 5 days")).toBeTruthy();
    expect(within(strip).getByText(/Suggested reorder: 40 piece/)).toBeTruthy();
    expect(within(strip).getByText("Below reorder level")).toBeTruthy();
    expect(within(strip).queryByText("Gloves (box)")).toBeNull();
    await user.click(within(strip).getByRole("button", { name: "Reorder Composite A2" }));
    expect(await screen.findByRole("dialog", { name: "Composite A2" })).toBeTruthy();
  });

  it("says stock looks healthy when nothing is running low", async () => {
    const { wrap } = withAnalytics((ids) => rowsOf(ids).map((r) => ({ ...r, needs_reorder: false })));
    renderPortal("/stock", { as: PEOPLE.farah, wrap });
    const strip = await screen.findByRole("region", { name: "Stock alerts" });
    expect(await within(strip).findByText("Stock looks healthy — nothing running low 🎉")).toBeTruthy();
  });

  it("sorts the days-of-cover table by its headers", async () => {
    const user = userEvent.setup();
    const { wrap } = withAnalytics(rowsOf);
    renderPortal("/stock", { as: PEOPLE.farah, wrap });
    await user.click(await screen.findByRole("tab", { name: "Analytics" }));
    const table = await screen.findByRole("table", { name: "Days of cover" });
    const names = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => within(r).getByRole("rowheader").textContent);
    // Starts by soonest to run out; items with no projection stay last.
    expect(names()).toEqual(["Composite A2", "Gloves (box)", "Polish cups"]);
    const header = within(table).getByRole("columnheader", { name: /Days of cover/ });
    await user.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["Gloves (box)", "Composite A2", "Polish cups"]);
    await user.click(within(table).getByRole("button", { name: "Item" }));
    expect(names()).toEqual(["Composite A2", "Gloves (box)", "Polish cups"]);
    await user.click(within(table).getByRole("button", { name: "Item" }));
    expect(names()).toEqual(["Polish cups", "Gloves (box)", "Composite A2"]);
    expect(screen.getByRole("img", { name: /Daily use over 28 days/ })).toBeTruthy();
    const reorder = screen.getByRole("region", { name: "Reorder list" });
    expect(within(reorder).getByText("Composite A2")).toBeTruthy();
  });

  it("saves an item's lead time and alert switch with the right PATCH body", async () => {
    const user = userEvent.setup();
    const { wrap } = withAnalytics(rowsOf, (calls) => ({
      changeInventoryItemAlerts: (id, input) => {
        calls.push(input);
        return Promise.resolve(success({ item_id: id, lead_time_days: input.lead_time_days ?? 7, alerts_enabled: input.alerts_enabled ?? true }));
      },
    }));
    const change = vi.fn();
    renderPortal("/stock", {
      as: PEOPLE.farah,
      wrap: (client) => {
        const wrapped = wrap(client);
        return {
          ...wrapped,
          changeInventoryItemAlerts: (id, input, options) => {
            change(input);
            return wrapped.changeInventoryItemAlerts(id, input, options);
          },
        };
      },
    });
    const table = await screen.findByRole("table", { name: "Inventory" });
    const [open] = await within(table).findAllByRole("button", { name: "Composite A2" });
    if (open === undefined) throw new Error("no Composite A2 row");
    await user.click(open);
    const dialog = await screen.findByRole("dialog", { name: "Composite A2" });
    const form = await within(dialog).findByRole("form", { name: "Alert settings" });
    const lead = within(form).getByLabelText(/Delivery lead time/);
    await user.clear(lead);
    await user.type(lead, "130");
    await user.click(within(form).getByRole("button", { name: "Save alert settings" }));
    expect(await within(form).findByText("Enter a whole number of days, from 0 to 120.")).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
    await user.clear(lead);
    await user.type(lead, "14");
    await user.click(within(form).getByRole("switch", { name: "Alert me about this item" }));
    await user.click(within(form).getByRole("button", { name: "Save alert settings" }));
    await waitFor(() => {
      expect(change).toHaveBeenCalledWith({ lead_time_days: 14, alerts_enabled: false });
    });
  });

  it("keeps the old Stock page when the New look is off", async () => {
    localStorage.setItem(NEW_LOOK_KEY, "0");
    renderPortal("/stock", { as: PEOPLE.farah });
    await screen.findByRole("table", { name: "Inventory" });
    expect(screen.queryByRole("region", { name: "Stock alerts" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Analytics" })).toBeNull();
  });

  it("has no axe violations on either tab or in the item dialog", async () => {
    const user = userEvent.setup();
    const { wrap } = withAnalytics(rowsOf);
    renderPortal("/stock", { as: PEOPLE.farah, wrap });
    await within(await screen.findByRole("region", { name: "Stock alerts" })).findByText("Composite A2");
    const check = async () => (await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations;
    expect(await check()).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "Analytics" }));
    await screen.findByRole("table", { name: "Days of cover" });
    expect(await check()).toEqual([]);
  });
});
