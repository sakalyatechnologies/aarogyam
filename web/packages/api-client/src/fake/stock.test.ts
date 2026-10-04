import { describe, expect, it } from "vitest";

import { inventoryItemId, stockBatchId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";
import { addDays, pickFefo, stockStatus } from "./stock.js";

// 11:00 in Pune.
const NOW = new Date("2026-10-03T05:30:00Z");
const TODAY = "2026-10-03";
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient =>
    backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

describe("stock rules", () => {
  it("rank critical above low above expiring", () => {
    expect(stockStatus(4, 40, false)).toBe("critical");
    expect(stockStatus(0, 0, false)).toBe("critical");
    expect(stockStatus(9, 40, false)).toBe("low");
    expect(stockStatus(41, 40, true)).toBe("expiring");
    expect(stockStatus(9, 40, true)).toBe("low");
    expect(stockStatus(58, 50, false)).toBe("ok");
  });

  it("pick the earliest expiry first and skip expired batches", () => {
    const batch = (id: string, expiry: string | null, received_on: string, quantity: number) => ({
      id,
      clinic_id: "c",
      item_id: "i",
      expiry,
      received_on,
      quantity,
      received_quantity: quantity,
      unit_cost_paise: 0,
    });
    const batches = [batch("late", "2027-01-01", "2026-01-01", 5), batch("soon", "2026-11-01", "2026-06-01", 3), batch("none", null, "2025-01-01", 10), batch("gone", "2026-09-01", "2026-01-01", 9)];
    expect(pickFefo(batches, 4, TODAY)?.map((p) => [p.batch.id, p.take])).toEqual([["soon", 3], ["late", 1]]);
    expect(pickFefo(batches, 19, TODAY)).toBeNull();
    expect(pickFefo(batches, 27, TODAY, true)).not.toBeNull();
    expect(addDays(TODAY, 30)).toBe("2026-11-02");
  });
});

describe("fake client: stock", () => {
  it("seeds the dashboard's items, urgent first, with counts for the cards", async () => {
    const { as } = setup();
    const stock = value(await as(ASHA).getStock());
    expect(stock.items).toHaveLength(6);
    expect(stock.items[0]?.item.name).toBe("Composite A2");
    expect(stock.items[0]?.status).toBe("critical");
    expect(stock.counts).toEqual({ critical: 1, low: 2, expiring: 1, ok: 2 });
    expect(value(await as(ASHA).listLowStock()).items.map((l) => l.status)).toEqual(["critical", "low", "low"]);
    const expiring = value(await as(ASHA).listExpiring());
    expect(expiring.items.map((b) => [b.item_name, b.quantity])).toEqual([["Anesthetic cartridges", 10]]);
    expect(expiring.items[0]?.days_left).toBe(21);
  });

  it("takes stock earliest expiry first, and refuses more than the shelf holds", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const anesthetic = value(await asha.getStock()).items.find((l) => l.item.name === "Anesthetic cartridges");
    const id = inventoryItemId.parse(anesthetic?.item.id);
    const used = value(await asha.useStock({ item_id: id, quantity: 14 }));
    expect(used.movements.map((m) => m.quantity)).toEqual([-10, -4]);
    expect(used.stock.on_hand).toBe(8);
    expect(errorOf(await asha.useStock({ item_id: id, quantity: 9 }))?.status).toBe(409);
    expect(value(await asha.getInventoryItem(id)).stock.on_hand).toBe(8);
    expect(errorOf(await asha.useStock({ item_id: id, quantity: 0 }))?.status).toBe(400);
  });

  it("receives, corrects with a reason, and writes off only expired batches", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const composite = value(await asha.getStock()).items[0];
    const id = inventoryItemId.parse(composite?.item.id);
    const received = value(await asha.receiveStock({ item_id: id, quantity: 40, expiry: addDays(TODAY, -2), unit_cost_paise: 4500 }));
    expect(received.stock.on_hand).toBe(44);
    expect(received.movements[0]?.kind).toBe("receive");
    expect(errorOf(await asha.adjustStock({ item_id: id, quantity: -1, reason: " " }))?.status).toBe(400);
    const corrected = value(await asha.adjustStock({ item_id: id, quantity: 2, reason: "Found in the store room" }));
    expect(corrected.stock.on_hand).toBe(46);
    const batch = value(await asha.getInventoryItem(id)).batches.find((b) => b.received_quantity === 40);
    const batchId = stockBatchId.parse(batch?.id);
    const off = value(await asha.expireBatch(batchId, {}));
    expect(off.movements[0]).toMatchObject({ kind: "expire", quantity: -40, reason: "expired" });
    expect(off.stock.on_hand).toBe(6);
    expect(errorOf(await asha.expireBatch(batchId, {}))?.status).toBe(409);
  });

  it("checks permissions and keeps clinics apart", async () => {
    const { as } = setup();
    const id = inventoryItemId.parse(value(await as(ASHA).getStock()).items[0]?.item.id);
    // The doctor reads but cannot change; front desk manages.
    expect(value(await as(DEV).getStock()).items).toHaveLength(6);
    expect(errorOf(await as(DEV).useStock({ item_id: id, quantity: 1 }))?.status).toBe(403);
    expect(errorOf(await as(DEV).addInventoryItem({ name: "Gauze" }))?.status).toBe(403);
    expect(value(await as(FARAH).useStock({ item_id: id, quantity: 1 })).stock.on_hand).toBe(3);
    // Lotus has no stock, and cannot reach Sunrise's items.
    const lotus = as(BINA, LOTUS);
    expect(value(await lotus.getStock()).items).toEqual([]);
    expect(errorOf(await lotus.getInventoryItem(id))?.status).toBe(404);
    expect(errorOf(await lotus.useStock({ item_id: id, quantity: 1 }))?.status).toBe(404);
    expect(errorOf(await lotus.removeInventoryItem(id))?.status).toBe(404);
  });

  it("adds items and suppliers, refusing duplicate names, and only removes empty items", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const item = value(await asha.addInventoryItem({ name: "Gauze", unit: "pack", reorder_level: 10, category: "Disposables" }));
    expect(item.category).toBe("disposables");
    expect(errorOf(await asha.addInventoryItem({ name: "gauze" }))?.status).toBe(409);
    expect(errorOf(await asha.addInventoryItem({ name: "Burs", unit: "kg" }))?.status).toBe(400);
    expect(value(await asha.changeInventoryItem(item.id, { reorder_level: 20 })).reorder_level).toBe(20);
    const supplier = value(await asha.addSupplier({ name: "Depot", phone: "98200 00001" }));
    expect(supplier.phone).toBe("+919820000001");
    expect(errorOf(await asha.addSupplier({ name: "DEPOT" }))?.status).toBe(409);
    value(await asha.receiveStock({ item_id: item.id, quantity: 5, supplier_id: supplier.id }));
    expect(errorOf(await asha.removeInventoryItem(item.id))?.status).toBe(409);
    value(await asha.useStock({ item_id: item.id, quantity: 5 }));
    value(await asha.removeInventoryItem(item.id));
    value(await asha.removeSupplier(supplier.id));
    expect(value(await asha.listSuppliers()).items.map((s) => s.name)).toEqual(["MedSupply Traders", "Pune Dental Depot"]);
  });

  it("puts low stock on Today for roles that may see stock", async () => {
    const { as } = setup();
    const today = value(await as(ASHA).getToday());
    expect(today.low_stock?.map((l) => [l.name, l.status])).toEqual([
      ["Composite A2", "critical"],
      ["Implant 4.2×10", "low"],
      ["Polish cups", "low"],
    ]);
  });
});
