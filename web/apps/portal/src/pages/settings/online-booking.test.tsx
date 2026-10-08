import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

describe("Settings: online booking", () => {
  it("lets the owner switch on automatic confirmation", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=booking", { as: PEOPLE.asha, backend });
    const card = (await screen.findByRole("heading", { name: "Online booking" })).closest("section");
    if (card === null) throw new Error("expected the online booking card");
    const toggle = await within(card).findByRole("switch", { name: "Confirm bookings automatically" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(await screen.findByText("Online booking updated")).toBeTruthy();

    const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const settings = await client.getClinicSettings();
    if (!settings.ok) throw new Error("expected settings");
    expect(settings.value.online_booking.auto_confirm).toBe(true);
  });

  it("shows the front desk that only the owner changes it", async () => {
    renderPortal("/settings?tab=booking", { as: PEOPLE.farah });
    expect(await screen.findByText("Only the clinic owner can change online booking.")).toBeTruthy();
  });
});
