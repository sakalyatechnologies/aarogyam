import { screen, waitFor, within } from "@testing-library/react";
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

  it("saves the automatic no-show switch and the grace minutes", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=booking", { as: PEOPLE.asha, backend });
    const toggle = await screen.findByRole("switch", { name: "Mark no-shows automatically" });
    const initial = toggle.getAttribute("aria-checked");
    await user.click(toggle);
    expect(await screen.findByText("Online booking updated")).toBeTruthy();
    const grace = await screen.findByLabelText("Grace after the slot (minutes)");
    await user.clear(grace);
    await user.type(grace, "45");
    await user.tab();
    const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    await waitFor(async () => {
      const settings = await client.getClinicSettings();
      if (!settings.ok) throw new Error("expected settings");
      expect(settings.value.online_booking.no_show_grace_minutes).toBe(45);
      expect(settings.value.online_booking.no_show_auto).toBe(initial === "false");
    });
  });

  it("shows the front desk that only the owner changes it", async () => {
    renderPortal("/settings?tab=booking", { as: PEOPLE.farah });
    expect(await screen.findByText("Only the clinic owner can change online booking.")).toBeTruthy();
  });

  it("saves the clinic policy and a doctor's own", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=booking", { as: PEOPLE.asha, backend });
    const clinic = await screen.findByLabelText("When a time is already booked");
    await user.selectOptions(clinic, "Don't allow");
    expect(await screen.findByText("Online booking updated")).toBeTruthy();
    const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const settings = await client.getClinicSettings();
    if (!settings.ok) throw new Error("expected settings");
    expect(settings.value.online_booking.conflict_policy).toBe("strict");

    const rows = await screen.findByRole("group", { name: /Each doctor's answer/ });
    const selects = await within(rows).findAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(1);
    const own = selects[0];
    if (own === undefined) throw new Error("expected a doctor row");
    await user.selectOptions(own, "Ask the desk");
    expect(await screen.findByText(/: saved/)).toBeTruthy();
  });

  it("lets a doctor edit only their own row", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=booking", { as: PEOPLE.dev, backend });
    await user.click(await screen.findByRole("button", { name: /Sunrise Dental/ }));
    const rows = await screen.findByRole("group", { name: /Each doctor's answer/ });
    const selects = await within(rows).findAllByRole("combobox");
    expect(selects).toHaveLength(1);
    expect(screen.queryByLabelText("When a time is already booked")).toBeNull();
    const own = selects[0];
    if (own === undefined) throw new Error("expected a doctor row");
    await user.selectOptions(own, "Don't allow");
    expect(await screen.findByText(/: saved/)).toBeTruthy();
  });
});
