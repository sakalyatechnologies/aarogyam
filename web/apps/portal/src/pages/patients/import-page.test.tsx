import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ROLES } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

// Their own layout: Marathi "Naav", a contact column, sex as M/F, and one row without a name.
const CSV = "Naav,Mobile No.,Gender,DOB\nAsha Rane,9876543210,F,12/04/1990\nVijay Patil,,M,\n,9876500000,M,\n";

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
});
