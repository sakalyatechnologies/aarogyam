import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderConsole } from "../../test/render-console.js";

/** Waits for the clinic list to load: the table first shows placeholder rows. */
async function loaded() {
  await screen.findAllByText("Sunrise Dental");
  return screen.getByRole("table", { name: "Clinics" });
}

describe("Clinics", () => {
  it("shows counts, status chips with counts and the clinic with its address and status", async () => {
    renderConsole("/clinics");
    const table = await loaded();
    expect(within(table).getAllByText("Trial").length).toBeGreaterThan(0);
    for (const status of ["All", "Active", "Trial", "Suspended", "Churned"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${status} \\(\\d+\\)$`) })).toBeTruthy();
    }
    expect(screen.getByText(/^Showing \d+ of \d+ clinics$/)).toBeTruthy();
  });

  it("filters by status and by search, with an empty state that says why", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics");
    await loaded();
    await user.click(screen.getByRole("button", { name: /^Suspended/ }));
    const suspended = screen.getByRole("table", { name: "Clinics" });
    expect(within(suspended).queryAllByText("Active")).toHaveLength(0);
    expect(within(suspended).getAllByText("Suspended").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.queryByText("No clinics match")).toBeNull();
    await user.type(screen.getByRole("searchbox", { name: "Search clinics" }), "nothing-like-this{Enter}");
    expect(await screen.findByText("No clinics match")).toBeTruthy();
  });

  it("opens a clinic with its plan and status, addresses, staff and invitations", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics");
    const table = await loaded();
    await user.click(within(table).getByRole("link", { name: "Sunrise Dental" }));
    expect(await screen.findByRole("heading", { name: "Plan and status" })).toBeTruthy();
    expect(screen.getByText(/Trying Aarogyam/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Addresses" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Clinic addresses" })).getByText("sunrise.localtest.me")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Staff" })).toBeTruthy();
    expect(screen.getByText("No pending invitations")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite doctor or staff" })).toBeTruthy();
  });
});
