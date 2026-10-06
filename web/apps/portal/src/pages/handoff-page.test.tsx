import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { fakeApi, NOW, PEOPLE, renderPortal } from "../test/render.js";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

/** Sunrise served at this test page's own host, so the page redeems where the code is for. */
function sunriseHere() {
  return fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    if (sunrise !== undefined) {
      sunrise.host = window.location.hostname;
    }
  });
}

describe("Central sign-in handoff", () => {
  it("signs in on this clinic's host with the one-time code and clears it from the address bar", async () => {
    const backend = sunriseHere();
    // The public site, signed in as Asha, asks for a code for this host.
    const site = backend.client({ host: "app.localtest.me", now: () => NOW, getToken: () => Promise.resolve(fakeTokenFor({ id: PEOPLE.asha })) });
    const created = await site.createHandoff({ host: window.location.hostname });
    if (!created.ok) {
      throw new Error(created.error.message);
    }
    window.history.replaceState(null, "", `/auth/handoff#code=${created.value.code}`);
    const { router } = renderPortal("/auth/handoff", { backend });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/today");
    });
    expect(window.location.hash).toBe("");
    // Used once: the same code now fails.
    const again = await backend.client({ host: window.location.hostname, now: () => NOW }).redeemHandoff({ code: created.value.code });
    expect(again.ok).toBe(false);
  });

  it("explains a used or unknown code and offers sign-in", async () => {
    window.history.replaceState(null, "", "/auth/handoff#code=not-a-real-code");
    renderPortal("/auth/handoff", { backend: sunriseHere() });
    expect((await screen.findByRole("alert")).textContent).toBe("This sign-in link has expired or was already used. Sign in again.");
    expect(screen.getByRole("button", { name: "Back to sign in" })).toBeTruthy();
  });

  it("refuses another clinic's host", async () => {
    const backend = fakeApi();
    const site = backend.client({ host: "app.localtest.me", now: () => NOW, getToken: () => Promise.resolve(fakeTokenFor({ id: PEOPLE.bina })) });
    // Bina belongs to Lotus, not Sunrise.
    const refused = await site.createHandoff({ host: "sunrise.localtest.me" });
    expect(refused.ok).toBe(false);
  });
});
