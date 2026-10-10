import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Permission } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import css from "../../mockup.css?raw";
import settingsCss from "./settings.css?raw";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function farahWith(permissions: Permission[]) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions };
  });
}

async function sections() {
  const nav = await screen.findByRole("navigation", { name: "Settings sections" });
  return [...nav.querySelectorAll("button")].map((b) => b.textContent);
}
const current = () => document.querySelector('.st-nl-nav [aria-current="page"]')?.textContent;

describe("Settings in the new look", () => {
  it("lists every section in a left nav, with the heading and subtitle from the design", async () => {
    renderPortal("/settings", { as: PEOPLE.asha });
    expect(await sections()).toEqual([
      "My profile",
      "Dashboard studio",
      "Clinic profile",
      "Letterhead",
      "Theme",
      "Chairs & doctors",
      "Price list",
      "Team & roles",
      "Booking & notifications",
      "Website",
      "Sessions",
    ]);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Clinic-wide setup · changes apply to everyone")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(current()).toBe("My profile");
  });

  it("keeps ?tab= links and the URL when a section is chosen", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/settings?tab=website", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: /Your website/ });
    expect(current()).toBe("Website");
    await user.click(screen.getByRole("button", { name: "Theme" }));
    expect(router.state.location.search).toBe("?tab=theme");
    await screen.findByRole("radiogroup", { name: "Palette" });
    expect(current()).toBe("Theme");
    await router.navigate(-1);
    await waitFor(() => { expect(current()).toBe("Website"); });
  });

  it("opens Clinic profile on ?tab=profile and Team & roles from the older staff link", async () => {
    renderPortal("/settings?tab=profile", { as: PEOPLE.asha });
    expect(await screen.findByRole("group", { name: "Identity" })).toBeTruthy();
    expect(current()).toBe("Clinic profile");
    cleanup();
    renderPortal("/staff", { as: PEOPLE.asha });
    expect(await screen.findByRole("button", { name: "Invite" })).toBeTruthy();
    expect(current()).toBe("Team & roles");
  });

  it("shows only the sections a role may open, and calls the account My profile", async () => {
    renderPortal("/settings", { as: PEOPLE.farah, backend: farahWith(["patients.read"]) });
    expect(await sections()).toEqual(["My profile", "Dashboard studio", "Booking & notifications", "Sessions"]);
    await screen.findByText("Only the clinic owner can change the clinic profile.");
    expect(screen.getByText("Your profile and look")).toBeTruthy();
  });

  it("falls back to the first section for one the role can't open", async () => {
    renderPortal("/settings?tab=website", { as: PEOPLE.farah, backend: farahWith(["patients.read"]) });
    await screen.findByText("Only the clinic owner can change the clinic profile.");
    expect(current()).toBe("My profile");
  });

  it("has no axe violations", async () => {
    renderPortal("/settings", { as: PEOPLE.asha });
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    await within(nav).findByRole("button", { name: "Sessions" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

describe("New look shape tokens and nav layout", () => {
  it("sets one card radius and pill radius under .mk-newlook, and the kits read it", () => {
    expect(css).toMatch(/\.mk-app\.mk-newlook \{[^}]*--nl-card-r: 2[4-8]px;[^}]*--nl-pill-r: 999px;/);
    expect(css).toMatch(/\.mk-newlook \.mk-btn[^{]*\{ border-radius: var\(--nl-pill-r\)/);
  });

  it("turns the left nav into a sideways row of pills under 900px", () => {
    expect(settingsCss).toMatch(/@media \(max-width: 900px\) \{[^@]*\.st-nl-nav \{[^}]*flex-direction: row;[^}]*overflow-x: auto;/);
  });
});
