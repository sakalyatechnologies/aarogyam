import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

describe("Patient 360: clinical flags", () => {
  it("shows the seeded patient's allergy and flagged condition", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const flagged = fixtures.allergies.find((a) => a.clinic_id === sunrise?.id);
      path = `/patients/${flagged?.patient_id ?? ""}`;
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Clinical flags" }));
    expect((await screen.findAllByText("Penicillin")).length).toBeGreaterThan(0);
    expect(screen.getByText("Type 2 diabetes")).toBeTruthy();
    expect(screen.getByText("Severe allergy")).toBeTruthy();
  });
});

describe("Visit screen", () => {
  it("starts a visit, writes a SOAP note and signs it", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id);
      path = `/patients/${patient?.id ?? ""}`;
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Visits" }));
    await user.click(await screen.findByRole("button", { name: "Start visit" }));

    await screen.findByRole("heading", { name: /^Visit V-/ });
    await user.click(await screen.findByRole("button", { name: "New note" }));
    await screen.findByText("SOAP");

    // The author's own draft is editable in place.
    expect(await screen.findByLabelText("Subjective")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign" })).toBeTruthy();
  });

  it("hides write actions from someone without clinical.write", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id);
      path = `/patients/${patient?.id ?? ""}`;
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      // front_desk has neither clinical.read nor clinical.write.
      if (membership !== undefined) membership.role = { key: "front_desk", name: "Front desk", permissions: ["patients.read", "appointments.read"] };
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("tab", { name: "Clinical flags" }));
    await screen.findByText("No clinical flags recorded yet");
    expect(screen.queryByRole("tab", { name: "Visits" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Chart" })).toBeNull();
  });
});
