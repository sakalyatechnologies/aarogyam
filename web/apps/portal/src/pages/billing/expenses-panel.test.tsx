import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { failure, parseApiError, type ApiClient, type NewExpense } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { pickDate } from "../../test/date-picker.js";
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
    await pickDate(user, "Day paid", "2026-10-02");
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

describe("Billing → Expenses: paid by and the bill", () => {
  const png = () => new File(["png"], "bill.png", { type: "image/png" });

  /** Watches the record and bill calls; `failBill` makes the first bill upload fail. */
  const watch = (calls: string[], sent: NewExpense[], failBill = false) => {
    let failNext = failBill;
    return (client: ApiClient): ApiClient => ({
      ...client,
      recordExpense: (input, opts) => {
        calls.push("record");
        sent.push(input);
        return client.recordExpense(input, opts);
      },
      uploadExpenseBill: (id, form, opts) => {
        calls.push("bill");
        if (failNext) {
          failNext = false;
          return Promise.resolve(failure(parseApiError(500, { code: "internal", message: "storage is down" }, undefined)));
        }
        return client.uploadExpenseBill(id, form, opts);
      },
    });
  };

  async function fill(user: ReturnType<typeof userEvent.setup>, rupees: string, note: string) {
    const form = await screen.findByRole("form", { name: "Add an expense" });
    // The fake's clock is 3 October; the form defaults to the real today.
    await pickDate(user, "Day paid", "2026-10-02");
    await user.type(within(form).getByLabelText(/amount/i), rupees);
    await user.type(within(form).getByLabelText(/note/i), note);
    return form;
  }
  const rowOf = async (note: string) => {
    const rent = await screen.findByRole("region", { name: "Rent" });
    const row = (await within(rent).findByText(note)).closest("li");
    if (row === null) throw new Error(`no row for ${note}`);
    return within(row);
  };

  it("sends UPI by default, or the method picked, and shows it in the list", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const sent: NewExpense[] = [];
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.asha, wrap: watch(calls, sent) });
    let form = await fill(user, "900", "Shed rent");
    expect(within(form).getByLabelText(/paid by/i)).toHaveProperty("value", "upi");
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect((await rowOf("Shed rent")).getByText("· UPI")).toBeTruthy();

    form = await fill(user, "400", "Parking");
    await user.selectOptions(within(form).getByLabelText(/paid by/i), "cash");
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    expect((await rowOf("Parking")).getByText("· Cash")).toBeTruthy();
    expect(sent.map((s) => s.method)).toEqual(["upi", "cash"]);
    expect(calls).toEqual(["record", "record"]);
  });

  it("uploads the bill photo right after the expense, and opens it from the list", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const calls: string[] = [];
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.asha, wrap: watch(calls, []) });
    const form = await fill(user, "1200", "October rent");
    await user.upload(within(form).getByLabelText("Bill photo"), png());
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    const bill = await (await rowOf("October rent")).findByRole("button", { name: /^View the bill/ });
    expect(calls).toEqual(["record", "bill"]);
    // The file field is empty again for the next expense.
    expect(within(form).getByLabelText("Bill photo")).toHaveProperty("value", "");
    await user.click(bill);
    await waitFor(() => {
      expect(open).toHaveBeenCalledTimes(1);
    });
    expect(open.mock.calls[0]?.[0]).toMatch(/^\/api\/v1\/expense-files\/.+\/content\?token=/);
    open.mockRestore();
  });

  it("refuses a file that isn't a photo or PDF before sending anything", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const calls: string[] = [];
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.asha, wrap: watch(calls, []) });
    const form = await fill(user, "300", "Odd file");
    await user.upload(within(form).getByLabelText("Bill photo"), new File(["x"], "bill.txt", { type: "text/plain" }));
    expect(await within(form).findByText("Choose a JPEG or PNG photo, or a PDF.")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("keeps the expense when its bill fails, and offers a retry", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    renderPortal("/billing?tab=expenses&month=2026-10", { as: PEOPLE.asha, wrap: watch(calls, [], true) });
    const form = await fill(user, "1000", "Generator rent");
    await user.upload(within(form).getByLabelText("Bill photo"), png());
    await user.click(within(form).getByRole("button", { name: "Add expense" }));
    const alert = await within(form).findByText(/is added, but its bill didn't upload/);
    expect(alert.textContent).toContain("₹1,000");
    expect((await rowOf("Generator rent")).queryByRole("button", { name: /^View the bill/ })).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Try the bill again" }));
    expect(await (await rowOf("Generator rent")).findByRole("button", { name: /^View the bill/ })).toBeTruthy();
    expect(calls).toEqual(["record", "bill", "bill"]);
    expect(within(form).queryByText(/didn't upload/)).toBeNull();
  });
});
