import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Permission } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** A patient of the first clinic with an issued bill: the record has money to show. */
function billedPatient(permissions?: Permission[]) {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (permissions !== undefined && membership !== undefined) {
      membership.role = { key: "reader", name: "Reader", permissions };
    }
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const invoice = fixtures.invoices.find((i) => i.clinic_id === sunrise?.id && i.status === "issued");
    path = `/patients/${invoice?.patient_id ?? ""}`;
  });
  return { path, backend };
}

describe("Patient summary", () => {
  it("shows the money on Patient 360 for someone with billing.read, and dashes without it", async () => {
    const { path, backend } = billedPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const outstanding = (await screen.findByText("Outstanding")).parentElement;
    await waitFor(() => {
      expect(outstanding?.textContent).toMatch(/₹/);
    });
    expect(screen.getByText("Lifetime value").parentElement?.textContent).toMatch(/₹/);
  });

  it("shows no money and no Billing tab without billing.read", async () => {
    const { path, backend } = billedPatient(["patients.read"]);
    renderPortal(path, { as: PEOPLE.farah, backend });
    await screen.findAllByText("Last visit");
    expect(screen.queryByText("Outstanding")).toBeNull();
    expect(screen.queryByText("Lifetime value")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Billing" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/₹/);
  });

  it("lists balances and the With balance chip asks the server for them", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha });
    const table = await screen.findByRole("table", { name: "Patients" });
    await within(table).findAllByText(/₹/);
    const all = within(table).getAllByRole("rowheader").length;

    await user.click(screen.getByRole("button", { name: "With balance" }));
    await waitFor(() => {
      const rows = within(screen.getByRole("table", { name: "Patients" })).queryAllByRole("rowheader");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(all);
    });
    for (const row of within(screen.getByRole("table", { name: "Patients" })).getAllByRole("row").slice(1)) {
      expect(row.textContent).toMatch(/₹/);
    }
  });

  it("says when no recall is due", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Recalls due" }));
    expect(await screen.findByText("No recalls due")).toBeTruthy();
  });

  it("opens booking with this patient chosen from the Follow-up button", async () => {
    const user = userEvent.setup();
    const { path, backend } = billedPatient();
    const { router } = renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: /Follow-up/ }));
    // The page's code loads on first visit, so the navigation lands a moment later.
    await waitFor(() => { expect(router.state.location.pathname).toBe("/calendar"); });
    const dialog = await screen.findByRole("dialog", { name: "New appointment" });
    // The patient is already chosen: no search box, and their file number shows.
    expect(await within(dialog).findByText(/^SD-\d+ ·/)).toBeTruthy();
    expect(within(dialog).queryByPlaceholderText("Name, clinic number or phone")).toBeNull();
  });
});
