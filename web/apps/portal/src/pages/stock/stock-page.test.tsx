import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** Opens an item's panel from the table (the table also renders as cards on small screens, so the first match). */
async function openItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  const table = await screen.findByRole("table", { name: "Inventory" });
  const [button] = await within(table).findAllByRole("button", { name });
  if (button === undefined) throw new Error(`no ${name} row`);
  await user.click(button);
}

/** Farah (front desk) with the role changed. */
function asRole(role: (typeof ROLES)[keyof typeof ROLES]) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = role;
  });
}

describe("Stock", () => {
  it("shows the three most urgent items as cards, then every item with its level and status", async () => {
    renderPortal("/stock", { as: PEOPLE.farah });
    const cards = await screen.findByLabelText("Most urgent items");
    await waitFor(() => {
      expect(within(cards).getAllByRole("heading", { level: 2 })).toHaveLength(3);
    });
    expect(within(cards).getByText("Composite A2")).toBeTruthy();
    expect(within(cards).getByText("Critical")).toBeTruthy();
    expect(within(cards).getByText(/Restorative · reorder at 40/)).toBeTruthy();

    const table = await screen.findByRole("table", { name: "Inventory" });
    const rows = within(table).getAllByRole("row");
    // The header and six items.
    expect(rows).toHaveLength(7);
    const composite = rows.find((row) => within(row).queryByText("Composite A2") !== null);
    expect(composite).toBeDefined();
    if (composite === undefined) return;
    expect(within(composite).getByText("4 / 40")).toBeTruthy();
    expect(within(composite).getByRole("progressbar", { name: "Composite A2 stock level" }).getAttribute("aria-valuenow")).toBe("10");
    for (const status of ["Critical", "Low", "OK", "Expiring"]) {
      expect(within(table).getAllByText(status).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: "Purchase order" })).toBeTruthy();
  });

  it("drafts a purchase order for the low items", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", { as: PEOPLE.farah });
    await screen.findByRole("table", { name: "Inventory" });
    await user.click(screen.getByRole("button", { name: "Purchase order" }));
    expect(await screen.findByText("Purchase order drafted for 3 low items")).toBeTruthy();
  });

  it("uses stock from an item's panel and shows the new level", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", { as: PEOPLE.farah });
    await openItem(user, "Gloves (box)");
    const dialog = await screen.findByRole("dialog", { name: "Gloves (box)" });
    expect(await within(dialog).findByText("58")).toBeTruthy();
    await user.selectOptions(within(dialog).getByLabelText("What happened"), "use");
    await user.type(within(dialog).getByLabelText(/^Units/), "10");
    await user.click(within(dialog).getByRole("button", { name: "Use" }));
    expect(await within(dialog).findByText("48")).toBeTruthy();
    expect(within(dialog).getByText(/Used/)).toBeTruthy();
  });

  it("says why when the API refuses, and checks the units first", async () => {
    const user = userEvent.setup();
    const useStock = vi.fn();
    renderPortal("/stock", {
      as: PEOPLE.farah,
      wrap: (client): ApiClient => ({
        ...client,
        useStock: (input, options) => {
          useStock(input);
          return client.useStock(input, options);
        },
      }),
    });
    await openItem(user, "Polish cups");
    const dialog = await screen.findByRole("dialog", { name: "Polish cups" });
    await user.selectOptions(await within(dialog).findByLabelText("What happened"), "use");
    await user.click(within(dialog).getByRole("button", { name: "Use" }));
    expect(await within(dialog).findByText("Enter a whole number of units, at least 1.")).toBeTruthy();
    expect(useStock).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/^Units/), "99");
    await user.click(within(dialog).getByRole("button", { name: "Use" }));
    expect(await within(dialog).findByText(/not enough stock/i)).toBeTruthy();
    expect(useStock).toHaveBeenCalledTimes(1);
  });

  it("adds an item", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", { as: PEOPLE.farah });
    await user.click(await screen.findByRole("button", { name: "New item" }));
    const dialog = await screen.findByRole("dialog", { name: "New item" });
    await user.type(within(dialog).getByLabelText(/^Name/), "Gauze");
    await user.type(within(dialog).getByLabelText(/^Category/), "disposables");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));
    const table = await screen.findByRole("table", { name: "Inventory" });
    expect(await within(table).findByText("Gauze")).toBeTruthy();
  });

  it("lets a reader look but not change anything", async () => {
    const user = userEvent.setup();
    renderPortal("/stock", { as: PEOPLE.farah, backend: asRole(ROLES.assistant) });
    await screen.findByRole("table", { name: "Inventory" });
    expect(screen.queryByRole("button", { name: "New item" })).toBeNull();
    expect(screen.getByRole("button", { name: "Purchase order" })).toHaveProperty("disabled", true);
    await openItem(user, "Composite A2");
    const dialog = await screen.findByRole("dialog", { name: "Composite A2" });
    expect(await within(dialog).findByRole("heading", { name: "Deliveries" })).toBeTruthy();
    expect(within(dialog).queryByRole("form", { name: "Change stock" })).toBeNull();
  });

  it("explains itself to a role without the permission", async () => {
    renderPortal("/stock", { as: PEOPLE.farah, backend: asRole(ROLES.consultant) });
    expect(await screen.findByText("Stock isn't available to your role")).toBeTruthy();
  });

  it("shows one guided card, not a second empty table, when nothing is tracked", async () => {
    const backend = fakeApi((fixtures) => {
      fixtures.inventoryItems.length = 0;
      fixtures.stockBatches.length = 0;
      fixtures.stockMovements.length = 0;
    });
    renderPortal("/stock", { as: PEOPLE.farah, backend });
    expect(await screen.findByText("Start tracking your stock")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add the first item/ })).toBeTruthy();
    expect(screen.queryByText("No items yet")).toBeNull();
    expect(screen.queryByRole("table", { name: "Inventory" })).toBeNull();
  });
});
