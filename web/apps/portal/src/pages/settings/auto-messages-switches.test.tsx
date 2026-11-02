import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

describe("Settings: automatic patient messages", () => {
  it("shows the three switches with their defaults and saves a change", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=booking", { as: PEOPLE.asha, backend });
    const welcome = await screen.findByRole("switch", { name: "Welcome message" });
    const summary = await screen.findByRole("switch", { name: "Visit summary link" });
    const followUp = await screen.findByRole("switch", { name: "Follow-up booking link" });
    await waitFor(() => {
      expect(welcome.getAttribute("aria-checked")).toBe("true");
    });
    expect(summary.getAttribute("aria-checked")).toBe("true");
    expect(followUp.getAttribute("aria-checked")).toBe("false");

    await user.click(followUp);
    expect(await screen.findByText("Notifications updated")).toBeTruthy();
    await user.click(welcome);
    await waitFor(() => {
      expect(welcome.getAttribute("aria-checked")).toBe("false");
    });

    const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
    const saved = await client.getNotificationSettings();
    if (!saved.ok) throw new Error("expected notification settings");
    expect([saved.value.welcome, saved.value.visit_summary, saved.value.follow_up_booking]).toEqual([false, true, true]);
  });

  it("leaves the switches off for staff who cannot manage settings", async () => {
    renderPortal("/settings?tab=booking", { as: PEOPLE.farah });
    const welcome = await screen.findByRole("switch", { name: "Welcome message" });
    expect(welcome.hasAttribute("disabled")).toBe(true);
  });
});
