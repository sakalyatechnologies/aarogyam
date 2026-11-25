import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

describe("Edit patient: address with PIN autofill", () => {
  it("fills city and state from the PIN and saves the address", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const desk = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const list = await desk.listPatients();
    if (!list.ok) throw new Error("expected patients");
    const patient = list.value.items[0];
    if (patient === undefined) throw new Error("expected a patient");

    renderPortal(`/patients/${patient.id}/edit`, { as: PEOPLE.farah, backend });
    await user.type(await screen.findByLabelText("Address"), "12 Lake Road");
    await user.type(screen.getByLabelText("PIN code"), "411001");
    expect(await screen.findByDisplayValue("Pune")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Saved");
    const saved = await desk.getPatient(patient.id);
    if (!saved.ok) throw new Error("expected the patient");
    expect(saved.value.address).toMatchObject({ line1: "12 Lake Road", pincode: "411001", city: "Pune", state: "Maharashtra" });
  });
});
