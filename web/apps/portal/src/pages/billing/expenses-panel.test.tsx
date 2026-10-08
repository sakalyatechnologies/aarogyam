import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ROLES } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** Farah with finance.view but not expenses.write: she sees and voids expenses, but can't add them. */
const financeReader = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = { ...ROLES.frontDesk, permissions: [...ROLES.frontDesk.permissions, "finance.view"] };
  });

describe("Billing → Expenses", () => {
  it("adds an expense to this month's list under its category", async () => {
    const user = userEvent.setup();
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.asha });
    const form = await screen.findByRole("form", { name: "Add an expense" });
    expect(await screen.findByRole("heading", { name: "Salary" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Rent" })).toBeNull();

    // The fake's clock is 3 October; the form defaults to the real today.
    fireEvent.change(within(form).getByLabelText(/day paid/i), { target: { value: "2026-10-02" } });
    await user.type(within(form).getByLabelText(/amount/i), "1,250");
    await user.type(within(form).getByLabelText(/note/i), "Parking shed");
    await user.click(within(form).getByRole("button", { name: "Add expense" }));

    const rent = await screen.findByRole("region", { name: "Rent" });
    expect(within(rent).getByText("Parking shed")).toBeTruthy();
    expect(within(rent).getAllByText("₹1,250")).toHaveLength(2);
  });

  it("checks the amount and warns that stock deliveries already count as material", async () => {
    const user = userEvent.setup();
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.asha });
    const form = await screen.findByRole("form", { name: "Add an expense" });
    expect(within(form).queryByText(/already counted as material/)).toBeNull();
    await user.selectOptions(within(form).getByLabelText(/category/i), "material");
    expect(within(form).getByText(/already counted as material/)).toBeTruthy();

    await user.type(within(form).getByLabelText(/amount/i), "abc");
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect(await within(form).findByText(/Enter an amount in rupees/)).toBeTruthy();
  });

  it("voids an expense with a reason", async () => {
    const user = userEvent.setup();
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.asha });
    const salary = await screen.findByRole("region", { name: "Salary" });
    await user.click(within(salary).getByRole("button", { name: /^Void Salary expense/ }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Void expense" });
    expect(confirm).toHaveProperty("disabled", true);
    await user.type(within(dialog).getByLabelText(/reason/i), "Entered twice");
    await user.click(confirm);
    expect(await within(salary).findByText("Void: Entered twice")).toBeTruthy();
  });

  it("shows the tab only with finance.view, and the form only with expenses.write", async () => {
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.farah });
    expect(await screen.findByText("Invoices")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Expenses" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Add an expense" })).toBeNull();
  });

  it("lets a finance reader see expenses without the add form", async () => {
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.farah, backend: financeReader() });
    expect(await screen.findByRole("tab", { name: "Expenses", selected: true })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Salary" })).toBeTruthy();
    });
    expect(screen.queryByRole("form", { name: "Add an expense" })).toBeNull();
  });
});
