import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { ROLES } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

// Their own layout: Marathi "Naav", a contact column, sex as M/F, and one row without a name.
const CSV = "Naav,Mobile No.,Gender,DOB\nAsha Rane,9876543210,F,12/04/1990\nVijay Patil,,M,\n,9876500000,M,\n";

// Naav, phone and Baki (balance) as the balance column: a thousands separator and a currency word.
const WITH_BALANCE = 'Naav,Mobile No.,Baki\nAsha Rane,9876543210,"1,200"\nVijay Patil,9876500001,Rs 500\nMeera Kale,9876500002,0\n';

async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("Import patients", () => {
  it("uploads a file, suggests the mapping, previews, imports and lists missing details", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/import", { as: PEOPLE.farah });
    await user.upload(await screen.findByLabelText("Patient file"), new File([CSV], "register.csv", { type: "text/csv" }));

    // 2. The suggested mapping, which the clinic can change.
    expect(await screen.findByLabelText("Field for Naav")).toHaveProperty("value", "full_name");
    expect(screen.getByLabelText("Field for Mobile No.")).toHaveProperty("value", "phone");
    expect(screen.getByLabelText("Field for Gender")).toHaveProperty("value", "sex");
    expect(screen.getAllByText(/Sure \(95%\)/)).toHaveLength(4);

    // 3. Preview: one complete, one incomplete, one without a name.
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const table = await screen.findByRole("table", { name: "Import preview" });
    expect(within(table).getByText("New")).toBeTruthy();
    expect(within(table).getByText("New, incomplete")).toBeTruthy();
    expect(within(table).getByText(/Missing phone, date of birth/)).toBeTruthy();
    expect(within(table).getByText("Can't import")).toBeTruthy();
    expect(within(table).getByText(/full_name: missing/)).toBeTruthy();

    // 4. Import, then the to-do list.
    await user.click(screen.getByRole("button", { name: "4. Import 2 patients" }));
    expect(await screen.findByText(/Imported 2 patients/)).toBeTruthy();
    const result = await screen.findByRole("table", { name: "Import result" });
    expect(within(result).getAllByText(/^Imported as SD-/)).toHaveLength(2);
    await user.click(screen.getByRole("link", { name: "Finish missing details" }));
    const todo = await screen.findByRole("table", { name: "Patients missing details" });
    expect(await within(todo).findByText(/Vijay Patil/)).toBeTruthy();
    expect(within(todo).getByText("Phone")).toBeTruthy();
    expect(within(todo).getByText(/register\.csv · row 3/)).toBeTruthy();

    await user.click(within(todo).getByRole("button", { name: "Can't get these" }));
    expect(await screen.findByText("Nothing to finish")).toBeTruthy();
  });

  it("lets the clinic change a column and leave one out", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/import", { as: PEOPLE.farah });
    await user.type(await screen.findByLabelText("Or paste CSV text"), "Patient,Notes\nAsha,ok\n");
    await user.click(screen.getByRole("button", { name: "Use pasted text" }));
    expect(await screen.findByText("Choose the column with the patient's name.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveProperty("disabled", true);
    await user.selectOptions(screen.getByLabelText("Field for Patient"), "full_name");
    expect(screen.getByText("Your choice")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("table", { name: "Import preview" })).toBeTruthy();
  });

  it("asks for a CSV when the demo is given an Excel file", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/import", { as: PEOPLE.farah });
    await user.upload(await screen.findByLabelText("Patient file"), new File(["PK"], "book.xlsx"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/CSV/);
  });

  it("hides the page from someone without patients.write", async () => {
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = ROLES.assistant;
    });
    renderPortal("/patients/import", { as: PEOPLE.farah, backend });
    expect(await screen.findByText("You can't import patients")).toBeTruthy();
  });

  it("previews the balance column as opening balances, imports them as bills and says how many", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/import", { as: PEOPLE.farah });
    await user.upload(await screen.findByLabelText("Patient file"), new File([WITH_BALANCE], "register.csv", { type: "text/csv" }));
    expect(await screen.findByLabelText("Field for Baki")).toHaveProperty("value", "balance");

    await user.click(screen.getByRole("button", { name: "Preview" }));
    const table = await screen.findByRole("table", { name: "Import preview" });
    expect(within(table).getByText("Opening balance: ₹1,200 will be billed")).toBeTruthy();
    expect(within(table).getByText("Opening balance: ₹500 will be billed")).toBeTruthy();
    // A zero balance bills nothing.
    expect(within(table).getAllByText(/^Opening balance:/)).toHaveLength(2);
    expect(screen.getByText("2 opening-balance bills will be made, ₹1,700 in all.")).toBeTruthy();
    expect(await axeViolations()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "4. Import 3 patients" }));
    expect(await screen.findByText("2 opening-balance bills made, ₹1,700 in all. The front desk collects against them like any bill.")).toBeTruthy();
  });

  it("imports the patients without bills for someone who may not issue bills, and says why", async () => {
    const user = userEvent.setup();
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) {
        membership.role = { ...ROLES.frontDesk, permissions: ROLES.frontDesk.permissions.filter((p) => !p.startsWith("billing.")) };
      }
    });
    renderPortal("/patients/import", { as: PEOPLE.farah, backend });
    await user.upload(await screen.findByLabelText("Patient file"), new File([WITH_BALANCE], "register.csv", { type: "text/csv" }));
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    const table = await screen.findByRole("table", { name: "Import preview" });
    // No billing.read: no amounts at all; no billing.write: no bills, with the reason.
    expect(within(table).queryByText(/Opening balance/)).toBeNull();
    expect(screen.getByText(/no opening-balance bills will be made, because issuing bills needs billing\.write/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "4. Import 3 patients" }));
    expect(await screen.findByText(/Imported 3 patients/)).toBeTruthy();
    expect(screen.queryByText(/opening-balance bills? made/)).toBeNull();
  });

  it("keeps the original file for download and deletes it only after confirming", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderPortal("/patients/import", { as: PEOPLE.farah });
    await user.upload(await screen.findByLabelText("Patient file"), new File([CSV], "register.csv", { type: "text/csv" }));
    expect(await screen.findByText(/Original file:/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Download" }));
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledOnce();
    });
    expect(String(open.mock.calls[0]?.[0])).toMatch(/^\/api\/v1\/imports\/sessions\/.+\/file\/content\?token=/);

    // Cancelling keeps it.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/can't open it again/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Original file:/)).toBeTruthy();

    // Confirming deletes it; the session carries on.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete file" }));
    await vi.waitFor(() => {
      expect(screen.queryByText(/Original file:/)).toBeNull();
    });
    expect(screen.getByLabelText("Field for Naav")).toBeTruthy();
    open.mockRestore();
  });
});
