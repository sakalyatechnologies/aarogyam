import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";
import { fakeTokenFor, type FakeBackend } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const asha = (backend: FakeBackend): ApiClient => backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });

describe("Stock import (New look)", () => {
  it("previews the file with its row errors, then commits it", async () => {
    const user = userEvent.setup();
    const commits: string[] = [];
    renderPortal("/stock", {
      as: PEOPLE.asha,
      wrap: (c) => ({
        ...c,
        commitStockImport: (input, options) => {
          commits.push(input.token);
          return c.commitStockImport(input, options);
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("dialog", { name: "Import stock" });
    expect(within(dialog).getByText("Choose a file to see what would be imported.")).toBeTruthy();
    const csv = "name,unit,qty\nIrrigation tips,box,12\nFloss,box,many\n";
    await user.upload(within(dialog).getByLabelText("Stock file"), new File([csv], "stock.csv", { type: "text/csv" }));
    const preview = await within(dialog).findByRole("region", { name: "Import preview" });
    expect(within(preview).getByRole("list", { name: "Row errors" }).textContent).toMatch(/Row 3/);
    expect(within(preview).getByRole("table", { name: "Rows to import" }).textContent).toMatch(/Irrigation tips/);
    expect(commits).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Import 1 row" }));
    expect(await within(dialog).findByText("Stock imported.")).toBeTruthy();
    expect(commits).toHaveLength(1);
    expect(within(dialog).getByText(/1 new item/)).toBeTruthy();
  });

  it("shows an error when the file can't be read", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Import" }));
    const dialog = await screen.findByRole("dialog", { name: "Import stock" });
    await user.upload(within(dialog).getByLabelText("Stock file"), new File([""], "empty.csv", { type: "text/csv" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBeTruthy();
  });
});

describe("Purchase orders (New look)", () => {
  it("drafts from the Reorder suggestions, marks ordered and receives", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const stock = await asha(backend).getStock();
    if (!stock.ok) throw new Error("expected stock");
    const first = stock.value.items[0];
    if (first === undefined) throw new Error("expected an item");
    // A maximum level above what is on hand gives the item a suggested order.
    const set = await asha(backend).changeInventoryItem(first.item.id, { max_level: first.on_hand + 40 });
    if (!set.ok) throw new Error(set.error.message);

    renderPortal("/stock", { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Orders" }));
    expect(await screen.findByText("No purchase orders yet")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Draft from Reorder" }));
    const draft = await screen.findByRole("dialog", { name: "Draft a purchase order" });
    const qty = await within(draft).findByLabelText(`Quantity of ${first.item.name}`);
    expect(qty).toHaveProperty("value", "40");
    await user.click(within(draft).getByRole("button", { name: "Draft order" }));

    const order = await screen.findByRole("dialog", { name: /^PO/ });
    expect(within(order).getByText(/Draft/)).toBeTruthy();
    await user.click(within(order).getByRole("button", { name: "Mark ordered" }));
    await waitFor(() => {
      expect(within(order).getByText(/Ordered/)).toBeTruthy();
    });
    await user.click(within(order).getByRole("button", { name: "Receive all" }));
    await waitFor(() => {
      expect(within(order).getByText(/Received/)).toBeTruthy();
    });
    const after = await asha(backend).getStock();
    if (!after.ok) throw new Error("expected stock");
    expect(after.value.items.find((l) => l.item.id === first.item.id)?.on_hand).toBe(first.on_hand + 40);
  });

  it("says when there is nothing to reorder", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("tab", { name: "Orders" }));
    await user.click(await screen.findByRole("button", { name: "Draft from Reorder" }));
    expect(await screen.findByText("Nothing to reorder")).toBeTruthy();
  });

  it("shows the list error with a retry", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", {
      as: PEOPLE.asha,
      wrap: (c) => ({ ...c, listPurchaseOrders: () => Promise.resolve({ ok: false, error: { status: 500, code: "internal", message: "Server trouble" } }) }),
    });
    await user.click(await screen.findByRole("tab", { name: "Orders" }));
    expect(await screen.findByText("Couldn't load purchase orders")).toBeTruthy();
  });
});

describe("Maximum level (New look)", () => {
  it("shows the API's 400 for a maximum below the reorder level against the field", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "Inventory" });
    await user.click(await within(table).findByRole("button", { name: "Composite A2" }));
    const dialog = await screen.findByRole("dialog");
    const levels = await within(dialog).findByRole("region", { name: "Levels" });
    await user.clear(within(levels).getByLabelText(/Reorder level/));
    await user.type(within(levels).getByLabelText(/Reorder level/), "50");
    await user.type(within(levels).getByLabelText(/Maximum level/), "5");
    await user.click(within(levels).getByRole("button", { name: "Save levels" }));
    expect(await within(levels).findByText(/reorder level/i, { selector: "[role=alert], p, span" })).toBeTruthy();
    expect(within(levels).getByLabelText(/Maximum level/).getAttribute("aria-invalid")).toBe("true");
  });
});
