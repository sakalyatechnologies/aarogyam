import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ROLES } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** A patient of the first clinic who has a bill in the seed. */
function billedPatient() {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const invoice = fixtures.invoices.find((i) => i.clinic_id === sunrise?.id);
    path = `/patients/${invoice?.patient_id ?? ""}`;
  });
  return { path, backend };
}

describe("Patient 360 bills and prescriptions", () => {
  it("lists the patient's bills and starts a new one", async () => {
    const user = userEvent.setup();
    const { path, backend } = billedPatient();
    const { router } = renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Billing" }));
    const list = await screen.findByRole("list", { name: "Recent bills" });
    expect(within(list).getAllByRole("link").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "New bill" }));
    expect(router.state.location.pathname).toBe("/billing/invoices/new");
  });

  it("starts a prescription draft from the Prescriptions tab", async () => {
    const user = userEvent.setup();
    const { path, backend } = billedPatient();
    const { router } = renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Prescriptions" }));
    await user.click(await screen.findByRole("button", { name: "New prescription" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/prescriptions\/.+/);
    });
  });

  it("hides billing from a role without billing.read", async () => {
    const user = userEvent.setup();
    const { path } = billedPatient();
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = ROLES.assistant;
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("tab", { name: "Billing" }));
    expect(await screen.findByText("Billing is hidden for your role")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New bill" })).toBeNull();
  });
});
