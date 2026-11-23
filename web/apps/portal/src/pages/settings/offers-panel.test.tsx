import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const saved = (backend: ReturnType<typeof fakeApi>) =>
  unwrap(backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW }).getOfferSettings());

describe("Settings → Offers", () => {
  it("is a tab for the owner only", async () => {
    renderPortal("/settings", { as: PEOPLE.farah });
    await screen.findByRole("navigation", { name: "Settings sections" });
    expect([...document.querySelectorAll(".st-nl-nav button")].map((b) => b.textContent)).not.toContain("Offers");
  });

  it("saves a changed preset", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=offers", { as: PEOPLE.asha, backend });
    const percent = (await screen.findAllByLabelText("Percent"))[0];
    if (percent === undefined) throw new Error("no percent field");
    await user.clear(percent);
    await user.type(percent, "12");
    await user.click(screen.getByRole("button", { name: "Save offer settings" }));
    await waitFor(async () => {
      expect((await saved(backend)).patient_offer.value).toBe(1200);
    });
  });

  it("rolls back and names the problem when the server refuses", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/settings?tab=offers", { as: PEOPLE.asha, backend });
    const percent = (await screen.findAllByLabelText("Percent"))[0];
    if (percent === undefined) throw new Error("no percent field");
    await user.clear(percent);
    await user.type(percent, "500");
    await user.click(screen.getByRole("button", { name: "Save offer settings" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("1 to 10000");
    });
    await waitFor(() => {
      expect(screen.getAllByLabelText("Percent")[0]).toHaveProperty("value", "10");
    });
    expect((await saved(backend)).patient_offer.value).toBe(1000);
  });

  it("has no accessibility violations", async () => {
    renderPortal("/settings?tab=offers", { as: PEOPLE.asha });
    await screen.findByRole("button", { name: "Save offer settings" });
    const result = await axe.run(document.body, AXE);
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
