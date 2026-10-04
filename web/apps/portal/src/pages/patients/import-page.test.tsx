import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ROLES } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const CSV = "full_name,sex,phone\nAsha Rane,female,9876543210\n,male,123\n";

describe("Import patients", () => {
  it("previews a pasted CSV with a per-row error, then commits the valid rows", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/import", { as: PEOPLE.farah });
    await user.type(await screen.findByLabelText("Or paste CSV text"), CSV);
    await user.selectOptions(await screen.findByLabelText(/^Full name/), "full_name");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    const table = await screen.findByRole("table", { name: "Import preview" });
    expect(within(table).getAllByText("Valid")).toHaveLength(1);
    expect(within(table).getAllByText("Invalid")).toHaveLength(1);
    expect(within(table).getByText(/full_name: must be/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Import 1 patients" }));
    expect(await screen.findByText(/Imported 1 of 2 patients/)).toBeTruthy();
    expect(await within(table).findByText(/^Imported as SD-/)).toBeTruthy();
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
