import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, renderPortal } from "../../test/render.js";

async function openTab(user: ReturnType<typeof userEvent.setup>) {
  renderPortal("/settings", { as: PEOPLE.asha });
  await user.click(await screen.findByRole("tab", { name: "Chairs and doctors" }));
}

describe("Settings: Chairs and doctors", () => {
  it("adds a chair, which appears in the table", async () => {
    const user = userEvent.setup();
    await openTab(user);
    await user.click(await screen.findByRole("button", { name: "Add chair" }));
    await user.type(await screen.findByLabelText(/^Name/), "Chair 3");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const table = await screen.findByRole("table", { name: "Chairs and rooms" });
    expect(await within(table).findByText("Chair 3")).toBeTruthy();
  });

  it("adds a doctor, then sets their working hours", async () => {
    const user = userEvent.setup();
    await openTab(user);
    await user.click(await screen.findByRole("button", { name: "Add doctor" }));
    await user.type(await screen.findByLabelText(/^Name/), "Dr Priya Nair");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const table = await screen.findByRole("table", { name: "Doctors" });
    await within(table).findByText("Dr Priya Nair");

    await user.click(within(table).getByRole("button", { name: "Actions for Dr Priya Nair" }));
    await user.click(await screen.findByRole("menuitem", { name: "Working hours" }));
    await screen.findByText("Dr Priya Nair's working hours");
    await user.click(screen.getByRole("switch", { name: "Monday" }));
    await screen.findByLabelText("Monday start time");
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    expect(await screen.findByText("Saved Dr Priya Nair's hours")).toBeTruthy();
  });

  it("hides the tab from someone without settings.manage", async () => {
    renderPortal("/settings", { as: PEOPLE.farah });
    await screen.findByRole("tab", { name: "Sessions" });
    expect(screen.queryByRole("tab", { name: "Chairs and doctors" })).toBeNull();
  });
});
