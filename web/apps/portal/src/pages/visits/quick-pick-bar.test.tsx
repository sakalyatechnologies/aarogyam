import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

describe("Visit note quick picks", () => {
  it("adds a complaint line to Subjective in one tap, once", async () => {
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
    await user.click(await screen.findByRole("button", { name: "New note" }));

    const complaints = await screen.findByRole("group", { name: "Complaint" });
    await user.click(within(complaints).getByRole("button", { name: "Toothache" }));
    await user.click(within(complaints).getByRole("button", { name: "Toothache" }));
    await user.click(within(complaints).getByRole("button", { name: "Swelling" }));

    expect(screen.getByLabelText("Subjective")).toHaveProperty("value", "Complains of toothache\nComplains of swelling");
    expect(screen.getByRole("button", { name: "Save draft" })).toHaveProperty("disabled", false);
  });

  it("Complete and bill closes the visit and opens a bill for the same patient", async () => {
    const user = userEvent.setup();
    let path = "";
    let name = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id);
      path = `/patients/${patient?.id ?? ""}`;
      name = patient?.full_name ?? "";
    });
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Visits" }));
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.click(await screen.findByRole("button", { name: "Complete and bill" }));
    expect(await screen.findByText(new RegExp(`For ${name}`))).toBeTruthy();
  });
});
