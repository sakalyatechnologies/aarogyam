import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Permission } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** Farah (front desk) with exactly these permissions. */
function farahWith(permissions: Permission[]) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions };
  });
}

describe("money stays hidden without the permission", () => {
  it("Today shows no money tiles or collected total without finance.view", async () => {
    renderPortal("/today", { as: PEOPLE.farah });
    await screen.findByRole("region", { name: /Today's schedule/ });
    expect(screen.queryByRole("group", { name: "Money today" })).toBeNull();
    expect(screen.queryByText("Revenue today")).toBeNull();
    expect(screen.queryByText("Revenue mix")).toBeNull();
    expect(screen.queryByText("Pending payments")).toBeNull();
  });

  it("Today shows the money to the owner", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const money = await screen.findByRole("group", { name: "Money today" });
    expect(within(money).getByText("Revenue today")).toBeTruthy();
    expect(within(money).getByText("Outstanding")).toBeTruthy();
  });

  it("Billing shows bills but no revenue figures or reports to billing.read without finance.view", async () => {
    renderPortal("/billing", { as: PEOPLE.farah });
    await screen.findByText("Invoices");
    expect(screen.queryByText("Weekly collections")).toBeNull();
    expect(screen.queryByText("UPI share")).toBeNull();
    expect(screen.queryByRole("link", { name: /Pending payments/ })).toBeNull();
  });

  it("Billing shows revenue and reports to the owner", async () => {
    renderPortal("/billing", { as: PEOPLE.asha });
    expect(await screen.findByText("Weekly collections")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Pending payments/ })).toBeTruthy();
  });

  it("the patient list has no balance column or balance filter without billing.read", async () => {
    renderPortal("/patients", { as: PEOPLE.farah, backend: farahWith(["patients.read"]) });
    const table = await screen.findByRole("table", { name: "Patients" });
    expect(within(table).queryByRole("columnheader", { name: "Balance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "With balance" })).toBeNull();
    expect(table.textContent).not.toMatch(/₹/);
  });

  it("the price list tab needs billing.read", async () => {
    renderPortal("/settings", { as: PEOPLE.farah, backend: farahWith(["patients.read", "settings.manage"]) });
    await screen.findByRole("tab", { name: "Chairs and doctors" });
    expect(screen.queryByRole("tab", { name: "Price list" })).toBeNull();
  });
});

describe("Settings → Roles & access", () => {
  it("shows the roles editor in Team & roles only for roles.manage", async () => {
    renderPortal("/settings?tab=team", { as: PEOPLE.farah, backend: farahWith(["staff.manage", "settings.manage"]) });
    expect(await screen.findByRole("button", { name: "Invite" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Roles and what they can do" })).toBeNull();
  });

  it("hides Team & roles without staff.manage or roles.manage", async () => {
    renderPortal("/settings", { as: PEOPLE.farah, backend: farahWith(["settings.manage"]) });
    await screen.findByRole("tab", { name: "Chairs and doctors" });
    expect(screen.queryByRole("tab", { name: "Team & roles" })).toBeNull();
  });

  it("links each person's role from the staff list", async () => {
    renderPortal("/settings?tab=team", { as: PEOPLE.asha });
    const [link] = await screen.findAllByRole("link", { name: "Front desk" });
    expect(link?.getAttribute("href")).toBe("/settings?tab=team&role=front_desk");
  });

  it("edits a role with confirmation and shows who changed what", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=team&role=front_desk", { as: PEOPLE.asha });
    expect(await screen.findByRole("table", { name: "Roles and what they can do" })).toBeTruthy();
    const editor = await screen.findByRole("region", { name: "Front desk" });
    expect(within(editor).getByText(/Finance and money/)).toBeTruthy();
    expect(within(editor).getByText("Not changed since the clinic was set up.")).toBeTruthy();
    const money = within(editor).getByRole("switch", { name: "See revenue, expenses and salaries" });
    expect(money.getAttribute("aria-checked")).toBe("false");
    await user.click(within(editor).getByRole("switch", { name: "See bills and payments" }));
    await user.click(within(editor).getByRole("button", { name: "Save changes" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Take away: See bills and payments")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "Front desk" })).getByText(/Last changed by/).textContent).toMatch(/Asha Kulkarni.*Take away: See bills and payments/);
    });
    // Reset to default puts it back.
    await user.click(within(screen.getByRole("region", { name: "Front desk" })).getByRole("button", { name: "Reset to default" }));
    expect(within(screen.getByRole("region", { name: "Front desk" })).getByRole("switch", { name: "See bills and payments" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the owner role read-only", async () => {
    renderPortal("/settings?tab=team&role=owner", { as: PEOPLE.asha });
    const editor = await screen.findByRole("region", { name: "Owner" });
    expect(within(editor).getByText(/always has full access/)).toBeTruthy();
    expect(within(editor).queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});
