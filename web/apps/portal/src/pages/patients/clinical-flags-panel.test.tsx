import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

/** A patient of the first clinic who has an allergy in the seed. */
function allergicPatient() {
  let path = "";
  let substance = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const allergy = fixtures.allergies.find((a) => a.clinic_id === sunrise?.id && a.status === "active");
    path = `/patients/${allergy?.patient_id ?? ""}`;
    substance = allergy?.substance ?? "";
    if (allergy !== undefined) allergy.severity = "mild";
  });
  return { path, substance, backend };
}

describe("Allergy editing on Patient 360", () => {
  it("edits an allergy's severity", async () => {
    const user = userEvent.setup();
    const { path, substance, backend } = allergicPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Clinical flags" }));
    await user.click(await screen.findByRole("button", { name: `Edit allergy: ${substance}` }));
    await user.selectOptions(await screen.findByLabelText("Severity"), "severe");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Severe allergy")).toBeTruthy();
  });

  it("marks an allergy inactive so it leaves the banner", async () => {
    const user = userEvent.setup();
    const { path, substance, backend } = allergicPatient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Clinical flags" }));
    await user.click(await screen.findByRole("button", { name: `Edit allergy: ${substance}` }));
    await user.click(screen.getByRole("button", { name: "Mark inactive" }));
    await screen.findByText("Allergy marked inactive");
    expect(screen.queryByRole("button", { name: `Edit allergy: ${substance}` })).toBeNull();
  });
});
