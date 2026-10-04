import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi, PEOPLE, renderPortal } from "../../test/render.js";

describe("Prescriptions", () => {
  it("issues a prescription, blocking on an allergy alert until an override reason is given", async () => {
    const user = userEvent.setup();
    let patientPath = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const allergy = fixtures.allergies.find((a) => a.clinic_id === sunrise?.id);
      patientPath = `/patients/${allergy?.patient_id ?? ""}/prescriptions`;
    });

    renderPortal(patientPath, { as: PEOPLE.asha, backend });

    await user.click(await screen.findByRole("button", { name: "New prescription" }));
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("link", { name: /draft/i }));

    await user.click(await screen.findByRole("button", { name: "Add free-text medicine" }));
    const medicineInput = screen.getByPlaceholderText("Medicine name");
    await user.type(medicineInput, "PENICILLIN V");

    await user.click(screen.getByRole("button", { name: "Issue prescription" }));

    expect(await screen.findByRole("heading", { name: "Allergy alert" })).toBeTruthy();
    expect(screen.getByText(/penicillin/i)).toBeTruthy();

    const confirm = screen.getByRole<HTMLButtonElement>("button", { name: /issue anyway/i });
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/reason to override/i), "Patient confirmed no reaction on last course");
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    expect(await screen.findByText("issued")).toBeTruthy();
  });

  it("starts Quick Rx from the last issued prescription", async () => {
    const user = userEvent.setup();
    let patientPath = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const rx = fixtures.prescriptions.find((p) => p.clinic_id === sunrise?.id && p.status === "issued");
      patientPath = `/patients/${rx?.patient_id ?? ""}/prescriptions`;
    });
    renderPortal(patientPath, { as: PEOPLE.asha, backend });

    await user.click(await screen.findByRole("button", { name: "Quick Rx" }));
    expect(await screen.findByText("draft")).toBeTruthy();
    expect(screen.getByDisplayValue(/amoxicillin/i)).toBeTruthy();
  });
});
