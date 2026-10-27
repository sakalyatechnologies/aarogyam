import { describe, expect, it } from "vitest";

import { inventoryItemId, purchaseOrderId, supplierId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";
import { parseStockCsv } from "./purchasing.js";

// 11:00 in Pune.
const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

function csv(text: string): FormData {
  const form = new FormData();
  form.set("file", new File([text], "stock.csv", { type: "text/csv" }));
  return form;
}

describe("the stock list reader", () => {
  it("reads rupees, dates and units, and names each failed row and field", () => {
    const parsed = parseStockCsv("name,unit,qty,cost,expiry\nGloves,box,20,45.50,31/03/2027\n,box,1,,\nMasks,crate,1,,\nFloss,box,many,,\n");
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.rowCount).toBe(4);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ name: "Gloves", quantity: 20, unit_cost_paise: 4550, expiry: "2027-03-31" });
    expect(parsed.errors.map((e) => `${String(e.row)}:${e.field}`)).toEqual(["3:name", "4:unit", "5:quantity"]);
  });

  it("refuses a file without a name column, or without rows", () => {
    expect(parseStockCsv("sku,qty\nA,1\n")).toMatch(/name/);
    expect(parseStockCsv("name,qty\n")).toMatch(/no rows/);
  });
});

describe("stock import (fake, same contract as the API)", () => {
  it("checks a list, commits it once by its token and repeats the first result", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const preview = value(await owner.previewStockImport(csv("name,unit,reorder,max,qty,cost\nSaliva ejectors,pack,10,60,25,12.5\n,pack,1,,1,\nPolish cups,piece,40,,5,\n")));
    expect(preview).toMatchObject({ row_count: 3, valid_rows: 2, error_rows: 1, new_items: 1 });
    expect(preview.errors[0]).toMatchObject({ row: 3, field: "name" });

    const first = value(await owner.commitStockImport({ token: preview.token }));
    expect(first).toMatchObject({ items_created: 1, batches_received: 2, units_received: 30, replayed: false });
    const again = value(await owner.commitStockImport({ token: preview.token }));
    expect(again).toMatchObject({ units_received: 30, replayed: true });

    const items = value(await owner.listInventoryItems()).items;
    const ejectors = items.find((l) => l.item.name === "Saliva ejectors");
    expect(ejectors).toMatchObject({ on_hand: 25, suggested_order: 35 });
    expect(ejectors?.item.max_level).toBe(60);
  });

  it("answers 404 for another clinic's token, 400 for a bad file, 403 without inventory.manage", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const preview = value(await owner.previewStockImport(csv("name,qty\nFloss,3\n")));
    expect(errorOf(await as(BINA, LOTUS).commitStockImport({ token: preview.token }))?.status).toBe(404);
    expect(errorOf(await owner.previewStockImport(csv("sku,qty\nA,1\n")))?.status).toBe(400);
    expect(errorOf(await owner.commitStockImport({ token: " " }))?.status).toBe(400);
    expect(errorOf(await owner.commitStockImport({ token: "unknown" }))?.status).toBe(404);
    // The token still works for its own clinic.
    expect(value(await owner.commitStockImport({ token: preview.token })).items_created).toBe(1);
  });
});

describe("purchase orders (fake, same contract as the API)", () => {
  it("is drafted, sent and received into stock, partly and then the rest", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const supplier = value(await owner.listSuppliers()).items[0];
    const item = value(await owner.listInventoryItems()).items[0];
    if (supplier === undefined || item === undefined) throw new Error("fixtures changed");
    const before = item.on_hand;

    const draft = value(
      await owner.createPurchaseOrder({ supplier_id: supplier.id, lines: [{ item_id: item.item.id, quantity: 10, unit_cost_paise: 4500 }] }),
    );
    expect(draft).toMatchObject({ status: "draft", total_paise: 45_000 });
    expect(draft.number).toMatch(/^PO-\d+$/);

    const sent = value(await owner.updatePurchaseOrder(draft.id, { status: "ordered" }));
    expect(sent.status).toBe("ordered");
    expect(errorOf(await owner.updatePurchaseOrder(draft.id, { lines: [{ item_id: item.item.id, quantity: 1 }] }))?.status).toBe(409);
    expect(errorOf(await owner.deletePurchaseOrder(draft.id))?.status).toBe(409);

    const line = sent.lines[0];
    if (line === undefined) throw new Error("no line");
    expect(errorOf(await owner.receivePurchaseOrder(draft.id, { lines: [{ line_id: line.id, quantity: 11 }] }))?.status).toBe(400);
    const part = value(await owner.receivePurchaseOrder(draft.id, { lines: [{ line_id: line.id, quantity: 4, batch_no: "G-1" }] }));
    expect(part.status).toBe("ordered");
    expect(value(await owner.getInventoryItem(item.item.id)).stock.on_hand).toBe(before + 4);
    const done = value(await owner.receivePurchaseOrder(draft.id, {}));
    expect(done.status).toBe("received");
    expect(done.receipts).toHaveLength(2);
    expect(value(await owner.getInventoryItem(item.item.id)).stock.on_hand).toBe(before + 10);
    expect(errorOf(await owner.receivePurchaseOrder(draft.id, {}))?.status).toBe(409);
    expect(value(await owner.listPurchaseOrders({ status: "received" })).items).toHaveLength(1);
  });

  it("deletes a draft, refuses bad lines with 400 and hides orders from other clinics", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const supplier = value(await owner.listSuppliers()).items[0];
    const item = value(await owner.listInventoryItems()).items[0];
    if (supplier === undefined || item === undefined) throw new Error("fixtures changed");
    const made = value(await owner.createPurchaseOrder({ supplier_id: supplier.id, lines: [{ item_id: item.item.id, quantity: 2 }] }));
    expect(made.total_paise ?? null).toBeNull();

    expect(errorOf(await owner.createPurchaseOrder({ supplier_id: supplier.id, lines: [{ item_id: item.item.id, quantity: 0 }] }))?.status).toBe(400);
    expect(errorOf(await owner.createPurchaseOrder({ supplier_id: supplier.id, lines: [] }))?.status).toBe(400);
    expect(errorOf(await owner.createPurchaseOrder({ supplier_id: supplierId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405199"), lines: [{ item_id: item.item.id, quantity: 1 }] }))?.status).toBe(404);
    expect(errorOf(await owner.createPurchaseOrder({ supplier_id: supplier.id, lines: [{ item_id: inventoryItemId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405198"), quantity: 1 }] }))?.status).toBe(404);

    const other = as(BINA, LOTUS);
    expect(errorOf(await other.getPurchaseOrder(made.id))?.status).toBe(404);
    expect(errorOf(await other.updatePurchaseOrder(made.id, { notes: "x" }))?.status).toBe(404);
    expect(errorOf(await other.deletePurchaseOrder(made.id))?.status).toBe(404);
    expect(errorOf(await other.receivePurchaseOrder(made.id, {}))?.status).toBe(404);
    expect(value(await other.listPurchaseOrders()).items).toHaveLength(0);

    expect(errorOf(await owner.deletePurchaseOrder(purchaseOrderId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405197")))?.status).toBe(404);
    value(await owner.deletePurchaseOrder(made.id));
    expect(errorOf(await owner.getPurchaseOrder(made.id))?.status).toBe(404);
  });

  it("gives the item a max level, suggests the order, and refuses one below the reorder level", async () => {
    const { as } = setup();
    const owner = as(ASHA);
    const level = value(await owner.listInventoryItems()).items[0];
    if (level === undefined) throw new Error("fixtures changed");
    const changed = value(await owner.changeInventoryItem(level.item.id, { max_level: level.on_hand + 100 }));
    expect(changed.max_level).toBe(level.on_hand + 100);
    expect(value(await owner.getInventoryItem(level.item.id)).stock.suggested_order).toBe(100);
    expect(errorOf(await owner.changeInventoryItem(level.item.id, { max_level: 1 }))?.status).toBe(400);
    expect(value(await owner.changeInventoryItem(level.item.id, { max_level: 0 })).max_level ?? null).toBeNull();
  });
});
