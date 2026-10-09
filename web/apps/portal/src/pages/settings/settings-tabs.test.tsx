import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Permission } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import css from "./settings.css?raw";

/** Farah (front desk) with exactly these permissions. */
function farahWith(permissions: Permission[]) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions };
  });
}

async function tabNames() {
  const list = await screen.findByRole("tablist", { name: "Settings" });
  return [...list.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
}

const selected = (name: string) => screen.getByRole("tab", { name }).getAttribute("aria-selected");

describe("Settings tabs", () => {
  it("gives the owner one tab per area, opening on the clinic profile", async () => {
    renderPortal("/settings", { as: PEOPLE.asha });
    expect(await tabNames()).toEqual([
      "Clinic profile",
      "Letterhead",
      "Theme",
      "Chairs and doctors",
      "Price list",
      "Team & roles",
      "Booking & notifications",
      "Website",
      "Sessions",
    ]);
    expect(selected("Clinic profile")).toBe("true");
    expect(await screen.findByRole("group", { name: "Identity" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Contact and address" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Billing and tax" })).toBeTruthy();
    // Only the open tab's content is on the page.
    expect(screen.queryByRole("radiogroup", { name: "Palette" })).toBeNull();
    expect(screen.queryByRole("figure", { name: "Letterhead preview" })).toBeNull();
  });

  it("shows only the tabs a role may open", async () => {
    renderPortal("/settings", { as: PEOPLE.farah, backend: farahWith(["patients.read"]) });
    expect(await tabNames()).toEqual(["Your account", "Booking & notifications", "Sessions"]);
  });

  it("adds Price list for billing.read and Team & roles for roles.manage alone", async () => {
    renderPortal("/settings", { as: PEOPLE.farah, backend: farahWith(["billing.read", "roles.manage"]) });
    expect(await tabNames()).toEqual(["Your account", "Price list", "Team & roles", "Booking & notifications", "Sessions"]);
  });

  it("opens the tab a link names", async () => {
    renderPortal("/settings?tab=website", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: /Your website/ });
    expect(selected("Website")).toBe("true");
  });

  it("opens Team & roles from the older staff and roles links", async () => {
    renderPortal("/staff", { as: PEOPLE.asha });
    expect(await screen.findByRole("button", { name: "Invite" })).toBeTruthy();
    expect(selected("Team & roles")).toBe("true");
  });

  it("falls back to the first tab for a tab the role can't open", async () => {
    renderPortal("/settings?tab=website", { as: PEOPLE.farah, backend: farahWith(["patients.read"]) });
    await screen.findByText("Only the clinic owner can change the clinic profile.");
    expect(selected("Your account")).toBe("true");
  });

  it("keeps the open tab in the URL, so back returns to the last one", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/settings", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("tab", { name: "Theme" }));
    expect(router.state.location.search).toBe("?tab=theme");
    await screen.findByRole("radiogroup", { name: "Palette" });
    await user.click(screen.getByRole("tab", { name: "Letterhead" }));
    expect(router.state.location.search).toBe("?tab=letterhead");
    await router.navigate(-1);
    await waitFor(() => {
      expect(selected("Theme")).toBe("true");
    });
  });
});

describe("Settings tab bar layout", () => {
  it("wraps every tab into view from tablet width up and scrolls sideways only on a phone", () => {
    const start = css.indexOf("@media (min-width: 641px) {");
    const wide = start < 0 ? "" : css.slice(start, css.indexOf("\n}\n", start) + 2);
    expect(wide).toMatch(/\[role="tablist"\] \{[^}]*flex-wrap: wrap;[^}]*overflow-x: visible;/);
    // Outside that query the shared tab list keeps its own overflow-x: auto.
    expect(css.replace(wide, "")).not.toMatch(/flex-wrap: wrap/);
  });
});
