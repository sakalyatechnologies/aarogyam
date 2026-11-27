import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

describe("New patient: address with PIN autofill", () => {
  it("keeps the Register and Cancel bar at the bottom of the form", async () => {
    renderPortal("/patients/new", { as: PEOPLE.farah, backend: fakeApi() });
    const bar = await screen.findByTestId("register-bar");
    expect(bar.className).toContain("sticky");
    expect(within(bar).getByRole("button", { name: "Register patient" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("registers with an address, which the profile then shows", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const { router } = renderPortal("/patients/new", { as: PEOPLE.farah, backend });
    await user.type(await screen.findByLabelText(/full name/i), "Meera Joshi");
    await user.click(screen.getByLabelText("Female"));
    await user.click(screen.getByLabelText(/Age only/));
    await user.type(await screen.findByLabelText(/^Age in years/), "30");
    await user.type(screen.getByLabelText("PIN code"), "411001");
    // City and state show as text with a Change link, and the house line comes after the PIN.
    expect((await screen.findByTestId("pin-filled")).textContent).toContain("Pune, Maharashtra");
    expect(screen.queryByLabelText("State")).toBeNull();
    await user.type(screen.getByLabelText("Address"), "5 Hill Road");
    await user.click(screen.getByRole("button", { name: "Register patient" }));
    await screen.findByText(/^Registered/);
    const desk = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const list = await desk.listPatients();
    if (!list.ok) throw new Error("expected patients");
    const made = list.value.items.find((p) => p.full_name === "Meera Joshi");
    expect(made?.address).toMatchObject({ line1: "5 Hill Road", city: "Pune", pincode: "411001" });
    expect(router.state.location.pathname).toContain("/patients/");
    expect(await screen.findByText("5 Hill Road, Pune, Maharashtra, 411001")).toBeTruthy();
  });
});
