import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** A patient of the first clinic with a visit already open on the visit screen. */
async function openVisit(user: ReturnType<typeof userEvent.setup>, wrap?: (client: ApiClient) => ApiClient) {
  let path = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id);
    path = `/patients/${patient?.id ?? ""}`;
  });
  renderPortal(path, { as: PEOPLE.asha, backend, ...(wrap === undefined ? {} : { wrap }) });
  await user.click(await screen.findByRole("tab", { name: "Visits" }));
  await user.click(await screen.findByRole("button", { name: "Start visit" }));
  await screen.findByRole("heading", { name: /^Visit V-/ });
}

describe("Treatment plans", () => {
  it("creates a plan with items and accepts it, then marks an item done", async () => {
    const user = userEvent.setup();
    const finished: string[] = [];
    await openVisit(user, (client) => ({
      ...client,
      setPlanItemStatus: (itemId, status, opts) => {
        finished.push(status);
        return client.setPlanItemStatus(itemId, status, opts);
      },
    }));
    await user.click(await screen.findByRole("button", { name: "New plan" }));
    await user.type(await screen.findByLabelText(/^Title/), "Lower right restoration");
    await user.type(screen.getByLabelText("Procedure 1"), "Root canal");
    await user.type(screen.getByLabelText("Tooth 1"), "46");
    await user.type(screen.getByLabelText("Estimate 1 (rupees)"), "6500");
    await user.click(screen.getByRole("button", { name: "Add procedure" }));
    await user.type(screen.getByLabelText("Procedure 2"), "Crown");
    await user.type(screen.getByLabelText("Estimate 2 (rupees)"), "9000");
    await user.click(screen.getByRole("button", { name: "Save plan" }));

    const items = await screen.findByRole("list", { name: "Items of Lower right restoration" });
    expect(within(items).getAllByText("proposed")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Accept plan" }));
    await user.click(await screen.findByRole("button", { name: "Mark done: Root canal" }));
    expect(await within(items).findByText("done")).toBeTruthy();
    // The item-status call did it: no procedure was recorded.
    expect(finished).toEqual(["done"]);
    expect(within(items).getAllByText("accepted")).toHaveLength(1);
  });

  it("marks an accepted item done on a closed visit", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const note = fixtures.notes.find((n) => n.status === "signed");
      const visit = fixtures.visits.find((v) => v.id === note?.visit_id);
      expect(visit?.status).toBe("closed");
      path = `/patients/${visit?.patient_id ?? ""}/visits/${visit?.id ?? ""}`;
      fixtures.plans.push({
        id: crypto.randomUUID(),
        clinic_id: visit?.clinic_id ?? "",
        patient_id: visit?.patient_id ?? "",
        visit_id: visit?.id ?? null,
        clinician_membership_id: visit?.clinician_membership_id ?? "",
        title: "Earlier plan",
        status: "accepted",
        items: [{ id: crypto.randomUUID(), name: "Scaling", surfaces: [], phase: 1, estimate_paise: 50000, status: "accepted" }],
        created_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
      });
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Mark done: Scaling" }));
    const items = await screen.findByRole("list", { name: "Items of Earlier plan" });
    expect(await within(items).findByText("done")).toBeTruthy();
  });

  it("hides New plan from someone without clinical.write", async () => {
    let path = "";
    const backend = fakeApi((fixtures) => {
      const note = fixtures.notes.find((n) => n.status === "signed");
      const visit = fixtures.visits.find((v) => v.id === note?.visit_id);
      path = `/patients/${visit?.patient_id ?? ""}/visits/${visit?.id ?? ""}`;
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions: ["patients.read", "clinical.read"] };
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    await screen.findByText("No treatment plans yet");
    expect(screen.queryByRole("button", { name: "New plan" })).toBeNull();
  });
});
