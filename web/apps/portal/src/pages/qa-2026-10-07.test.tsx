import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Permission } from "@aarogyam/api-client";

import { joinParts } from "../lib/text.js";
import { PEOPLE, fakeApi, renderPortal } from "../test/render.js";

/** Farah with exactly these permissions. */
function farahWith(permissions: Permission[]) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions };
  });
}

describe("portal QA, 7 Oct 2026", () => {
  it("opens the roles editor for roles.manage without staff.manage", async () => {
    renderPortal("/settings?tab=team&role=front_desk", { as: PEOPLE.farah, backend: farahWith(["roles.manage", "settings.manage"]) });
    expect(await screen.findByRole("table", { name: "Roles and what they can do" })).toBeTruthy();
    expect(screen.queryByText(/Couldn't load roles/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  });

  it("shows a plain notice, not an API error, on money pages the role lacks", async () => {
    renderPortal("/billing/pending", { as: PEOPLE.farah, backend: farahWith(["billing.read"]) });
    expect(await screen.findByText("Pending payments isn't available to your role")).toBeTruthy();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    cleanup();
    renderPortal("/billing", { as: PEOPLE.farah, backend: farahWith(["patients.read"]) });
    expect(await screen.findByText("Billing isn't available to your role")).toBeTruthy();
  });

  it("refuses to record more than the balance, and keeps the bill as it was", async () => {
    const user = userEvent.setup();
    renderPortal("/billing", { as: PEOPLE.asha });
    const partial = (await screen.findAllByText("Partial"))[0];
    if (partial === undefined) throw new Error("no partial bill");
    const row = partial.closest("tr");
    if (row === null) throw new Error("no row");
    await user.click(within(row).getByRole("link"));
    await user.click(await screen.findByRole("button", { name: /Record payment/ }));
    const dialog = await screen.findByRole("dialog");
    const amount = within(dialog).getByRole("textbox", { name: /Amount/ });
    await user.clear(amount);
    await user.type(amount, "500000");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/more than the balance/);
    expect(screen.queryByText(/Receipt .* recorded/)).toBeNull();
    // The exact balance goes through.
    await user.clear(amount);
    await user.type(amount, "1");
    await user.click(within(dialog).getByRole("button", { name: "Record payment" }));
    await waitFor(() => {
      expect(screen.getByText(/Receipt .* recorded/)).toBeTruthy();
    });
  });

  it("joins a prescription line without dangling separators", () => {
    expect(joinParts(["1 tablet", "1-0-1", null, undefined])).toBe("1 tablet · 1-0-1");
    expect(joinParts(["", "1-0-1", "After food", "5 days"])).toBe("1-0-1 · After food · 5 days");
  });
});
