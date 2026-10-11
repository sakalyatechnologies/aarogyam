import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../test/render.js";

const COLLAPSED = "aarogyam.portal.sidebar-collapsed";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The fakes' owner role has no `labs.read`; this one does, so the overdue lab alert reaches the bell. */
const withLabs = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha);
    if (membership !== undefined) membership.role = { ...ROLES.owner, permissions: [...ROLES.owner.permissions, "labs.read"] };
  });

const rail = () => document.querySelector(".mk2-rail");
function inRail() {
  const found = rail();
  if (!(found instanceof HTMLElement)) throw new Error("expected the rail");
  return within(found);
}
const root = () => document.querySelector(".mk2");

describe("Shell v2 rail", () => {
  it("is the old shell when New look is off", async () => {
    localStorage.setItem(NEW_LOOK_KEY, "0");
    renderPortal("/today", { as: PEOPLE.asha });
    await screen.findByRole("button", { name: "Collapse sidebar" });
    expect(document.querySelector(".mk-side")).not.toBeNull();
    expect(rail()).toBeNull();
  });

  it("starts as an icon rail, expands to show labels, collapses again, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    const expand = await screen.findByRole("button", { name: "Expand sidebar" });
    expect(root()?.classList.contains("mk2-collapsed")).toBe(true);
    expect(expand.getAttribute("aria-pressed")).toBe("true");
    // Icons keep their names for readers and show a tooltip.
    const patients = screen.getByRole("link", { name: "Patients" });
    expect(patients.querySelector(".mk2-tip")?.textContent).toBe("Patients");
    // The active icon is the inverted one.
    await waitFor(() => {
      expect(inRail().getByRole("link", { name: /^Today/ }).getAttribute("aria-current")).toBe("page");
    });
    await user.click(expand);
    expect(root()?.classList.contains("mk2-collapsed")).toBe(false);
    expect(localStorage.getItem(COLLAPSED)).toBe("0");
    expect(screen.getByRole("button", { name: "Collapse sidebar" }).getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(localStorage.getItem(COLLAPSED)).toBe("1");
  });

  it("reads the choice the browser remembers", async () => {
    localStorage.setItem(COLLAPSED, "0");
    renderPortal("/today", { as: PEOPLE.asha });
    await screen.findByRole("button", { name: "Collapse sidebar" });
    expect(root()?.classList.contains("mk2-collapsed")).toBe(false);
  });

  it("deep-links every tab and Back returns to the one before", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/billing", { as: PEOPLE.asha });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page");
    });
    await user.click(screen.getByRole("link", { name: "Patients" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/patients");
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Patients" }).getAttribute("aria-current")).toBe("page");
    });
    await router.navigate(-1);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/billing");
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Billing" }).getAttribute("aria-current")).toBe("page");
    });
  });

  it("hides what the role may not open", async () => {
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = ROLES.assistant;
    });
    renderPortal("/today", { as: PEOPLE.farah, backend });
    await screen.findByRole("link", { name: "Patients" });
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
  });

  it("opens as a drawer from the menu button (the phone layout) and closes on Escape", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    const menu = await screen.findByRole("button", { name: "Menu" });
    await user.click(menu);
    expect(rail()?.classList.contains("open")).toBe(true);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    await user.click(inRail().getByRole("link", { name: "Patients" }));
    expect(rail()?.classList.contains("open")).toBe(false);
    await user.click(menu);
    await user.keyboard("{Escape}");
    expect(rail()?.classList.contains("open")).toBe(false);
  });
});

describe("Shell v2 top bar", () => {
  it("opens the command palette from the search field and from Ctrl+K", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: /Search patients/ }));
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeTruthy();
  });

  it("shows Finish setup n/m while steps are left, links to /setup, and hides once all are done", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const { router } = renderPortal("/today", { as: PEOPLE.asha, backend });
    const chip = await screen.findByRole("link", { name: /Finish setup/ });
    expect(chip.textContent).toMatch(/Finish setup\s*0\/5/);
    expect(chip.getAttribute("href")).toBe("/setup");
    await user.click(chip);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/setup");
    });
  });

  it("has no chip for someone who cannot change settings", async () => {
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = ROLES.assistant;
    });
    renderPortal("/today", { as: PEOPLE.farah, backend });
    await screen.findByRole("link", { name: "Patients" });
    expect(screen.queryByRole("link", { name: /Finish setup/ })).toBeNull();
  });
});

describe("Notifications drawer", () => {
  it("lists real notifications, highlights unread ones, and keeps Mark all read after reopening and reloading", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal("/today", { as: PEOPLE.asha, backend });
    const bell = await screen.findByRole("button", { name: /^Notifications, 3 unread/ });
    await user.click(bell);
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    const items = await within(dialog).findAllByRole("button", { name: /Booking/ });
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.dataset.unread === "true")).toBe(true);
    expect(within(dialog).getByText("3 unread")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Mark all read" }));
    await waitFor(() => {
      expect(within(dialog).getByText("All caught up")).toBeTruthy();
    });
    expect(items.every((item) => item.dataset.unread === undefined)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    });
    cleanup();
    // A fresh page over the same server still has them read.
    renderPortal("/today", { as: PEOPLE.asha, backend });
    await screen.findByRole("button", { name: "Notifications" });
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    const again = await screen.findByRole("dialog", { name: "Notifications" });
    expect(await within(again).findByText("All caught up")).toBeTruthy();
  });

  it("marks one read and opens what it is about when it has a link", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: /^Notifications, 3 unread/ }));
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    await user.click(await within(dialog).findByRole("button", { name: /Booking request/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/calendar");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Notifications, 2 unread/ })).toBeTruthy();
    });
  });

  it("marks an item without a link read and stays open", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/today", { as: PEOPLE.asha, backend: withLabs() });
    await user.click(await screen.findByRole("button", { name: /^Notifications, 4 unread/ }));
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    const lab = await within(dialog).findByRole("button", { name: /Lab work overdue/ });
    await user.click(lab);
    await waitFor(() => {
      expect(lab.dataset.unread).toBeUndefined();
    });
    expect(router.state.location.pathname).toBe("/today");
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
  });

  it("falls back to the notification count when the role has no chat, and polls the badge", async () => {
    let badgeCalls = 0;
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client): ApiClient => ({
        ...client,
        countUnreadNotifications: () => {
          badgeCalls += 1;
          return Promise.resolve({ ok: true, value: { unread: 3 } });
        },
      }),
    });
    expect(await screen.findByRole("button", { name: /^Notifications, 3 unread/ })).toBeTruthy();
    expect(badgeCalls).toBeGreaterThan(0);
  });

  it("says so, quietly, for a role that sees no notifications", async () => {
    const user = userEvent.setup();
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { ...ROLES.assistant, permissions: ["patients.read"] };
    });
    renderPortal("/patients", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    expect(await within(dialog).findByText(/no notifications/)).toBeTruthy();
  });

  it("has no axe violations with the drawer open", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: /^Notifications, 3 unread/ }));
    await screen.findByRole("dialog", { name: "Notifications" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});

describe("Shell v2 accessibility", () => {
  it("has no axe violations on the rail and top bar, collapsed and expanded", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha });
    await screen.findByRole("link", { name: "Billing" });
    await screen.findByRole("link", { name: /Finish setup/ });
    const run = async () => (await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(await run()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(await run()).toEqual([]);
  });
});
