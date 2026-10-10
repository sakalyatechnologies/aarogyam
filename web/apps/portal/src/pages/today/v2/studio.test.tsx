import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient, DashboardCatalogue, DashboardLayout } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { WIDGET_KEYS } from "./registry.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const asAssistant = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = ROLES.assistant;
  });

/** The widget keys drawn in a board, in page order. */
const order = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>("[data-widget]")].map((el) => el.dataset["widget"]);
const preview = () => {
  const el = document.querySelector<HTMLElement>(".tv2-preview");
  if (el === null) throw new Error("no preview on the page");
  return el;
};
const today = () => {
  const el = [...document.querySelectorAll<HTMLElement>(".tv2")].find((board) => board.closest(".tv2-preview") === null);
  if (el === undefined) throw new Error("no Today board on the page");
  return el;
};

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const problems = (result: axe.AxeResults) => result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

describe("the widget registry", () => {
  it("draws every key the API's catalogue accepts", async () => {
    let catalogue: DashboardCatalogue | undefined;
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient): ApiClient => ({
        ...client,
        getMyDashboardLayout: async () => {
          const result = await client.getMyDashboardLayout();
          if (result.ok) catalogue = result.value.catalogue;
          return result;
        },
      }),
    });
    await screen.findByRole("heading", { level: 1, name: "Today" });
    await waitFor(() => { expect(catalogue).toBeDefined(); });
    expect(catalogue?.widgets.map((w) => w.key).sort()).toEqual([...WIDGET_KEYS].sort());
  });
});

describe("Settings, Dashboard studio tab", () => {
  it("is there with the New look and gone without it", async () => {
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    expect(await screen.findByRole("button", { name: "Dashboard studio" })).toBeTruthy();
    expect(await screen.findByRole("group", { name: "Live preview of Today" })).toBeTruthy();
    cleanup();
    localStorage.setItem(NEW_LOOK_KEY, "0");
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    await screen.findByRole("tab", { name: "Sessions" });
    expect(screen.queryByRole("tab", { name: "Dashboard studio" })).toBeNull();
  });

  it("saves the member's layout through the API and Today draws it after a reload", async () => {
    const backend = fakeApi();
    const saved: DashboardLayout[] = [];
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      saveMyDashboardLayout: (layout, options) => {
        saved.push(layout);
        return client.saveMyDashboardLayout(layout, options);
      },
    });
    const user = userEvent.setup();
    const { router } = renderPortal("/settings?tab=studio", { as: PEOPLE.asha, backend, wrap });
    await screen.findByRole("group", { name: "Live preview of Today" });
    await user.click(screen.getByRole("button", { name: /Executive/ }));
    await user.click(screen.getByRole("button", { name: "Compact" }));
    await user.click(screen.getByRole("button", { name: "Remove Busy hours" }));
    expect(order(preview())).not.toContain("busy_hours");
    expect(order(preview())).toContain("revenue_mix");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(saved).toHaveLength(1); });
    expect(saved[0]?.density).toBe("compact");
    expect(saved[0]?.tpl).toBe("executive");
    expect(saved[0]?.items.some((item) => item.key === "busy_hours")).toBe(false);
    router.dispose();
    cleanup();

    // A fresh page on the same backend: the layout comes back from the API, not from this browser.
    localStorage.clear();
    localStorage.setItem(NEW_LOOK_KEY, "1");
    renderPortal("/today", { as: PEOPLE.asha, backend });
    await screen.findByRole("list", { name: "Key numbers" });
    const board = today();
    expect(board.getAttribute("data-density")).toBe("compact");
    expect(order(board)).toContain("revenue_mix");
    expect(order(board)).not.toContain("busy_hours");
  });

  it("Customise opens Settings, where the preview matches Today and a saved template shows on Today", async () => {
    const backend = fakeApi();
    const user = userEvent.setup();
    const { router } = renderPortal("/today", { as: PEOPLE.asha, backend });
    await screen.findByRole("list", { name: "Key numbers" });
    const before = order(today());
    await user.click(screen.getByRole("button", { name: "Customise" }));
    await within(await screen.findByRole("navigation", { name: "Settings sections" })).findByRole("button", { name: "Dashboard studio" });
    await screen.findByRole("group", { name: "Live preview of Today" });
    expect(router.state.location.pathname + router.state.location.search).toBe("/settings?tab=studio");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(order(preview())).toEqual(before);
    await user.click(screen.getByRole("button", { name: /Care/ }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => { expect(preview().querySelector(".tv2")?.getAttribute("data-side")).toBe("left"); });
    cleanup();

    // Back on Today, the saved layout comes from the API: the Care template, the rail on the left.
    renderPortal("/today", { as: PEOPLE.asha, backend });
    await screen.findByRole("list", { name: "Key numbers" });
    await waitFor(() => { expect(today().getAttribute("data-side")).toBe("left"); });
    expect(order(today())).toEqual(expect.arrayContaining(["queue", "recent_patients", "timeline", "calendar"]));
    expect(order(today()).indexOf("calendar")).toBeLessThan(order(today()).indexOf("queue"));
  });

  it("reorders with the up and down buttons, and removing and adding redraws the preview", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Live preview of Today" });
    const before = order(preview()).filter((key) => ["appointments", "attention", "chairs"].includes(key ?? ""));
    expect(before[0]).toBe("appointments");
    await user.click(screen.getByRole("button", { name: "Move Appointments down" }));
    expect(order(preview()).filter((key) => ["appointments", "attention", "chairs"].includes(key ?? "")).slice(0, 2)).toEqual(["attention", "appointments"]);
    await user.click(screen.getByRole("button", { name: "Move Appointments up" }));
    expect(order(preview()).filter((key) => ["appointments", "attention", "chairs"].includes(key ?? ""))[0]).toBe("appointments");
    // The first in a zone cannot go up.
    expect(screen.getByRole("button", { name: "Move Appointments up" }).hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Remove Chairs" }));
    expect(order(preview())).not.toContain("chairs");
    await user.click(screen.getByRole("button", { name: "Add Chairs" }));
    expect(order(preview())).toContain("chairs");
  });

  it("changes a widget's size and options and shows them in the preview", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Live preview of Today" });
    await user.click(screen.getByRole("button", { name: "Settings for Appointments" }));
    await user.click(screen.getByRole("button", { name: "List" }));
    await waitFor(() => { expect(within(preview()).queryByRole("table")).toBeNull(); });
    await user.click(screen.getByRole("button", { name: "Full width" }));
    expect(preview().querySelector('[data-widget="appointments"]')?.getAttribute("data-size")).toBe("full");
    // Key numbers: between 4 and 6 numbers can be picked.
    await user.click(screen.getByRole("button", { name: "Settings for Key numbers" }));
    const boxes = screen.getAllByRole("checkbox").filter((box): box is HTMLInputElement => box instanceof HTMLInputElement && box.closest(".tv2-metrics") !== null);
    expect(boxes.filter((box) => box.checked).length).toBe(4);
    expect(boxes.filter((box) => box.checked).every((box) => box.disabled)).toBe(true);
    const spare = boxes.find((box) => !box.checked && !box.disabled);
    if (spare === undefined) throw new Error("no spare metric");
    await user.click(spare);
    expect(boxes.filter((box) => box.checked).length).toBe(5);
  });

  it("Reset to template puts the template's layout back", async () => {
    const user = userEvent.setup();
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Live preview of Today" });
    const first = order(preview());
    await user.click(screen.getByRole("button", { name: "Remove Appointments" }));
    expect(order(preview())).not.toEqual(first);
    await user.click(screen.getByRole("button", { name: "Reset to template" }));
    expect(order(preview())).toEqual(first);
  });

  it("offers Save as clinic default only with settings.manage, and the clinic's layout reaches other members", async () => {
    const backend = asAssistant();
    const user = userEvent.setup();
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha, backend });
    await screen.findByRole("group", { name: "Live preview of Today" });
    await user.click(screen.getByRole("button", { name: /Focus/ }));
    await user.click(screen.getByRole("button", { name: "Save as clinic default" }));
    await waitFor(() => { expect(screen.getByText("Saved as the clinic's default")).toBeTruthy(); });
    cleanup();

    renderPortal("/settings?tab=studio", { as: PEOPLE.farah, backend });
    await screen.findByRole("group", { name: "Live preview of Today" });
    expect(screen.queryByRole("button", { name: "Save as clinic default" })).toBeNull();
    // The assistant gets the clinic's Focus layout, and cannot add what her role may not see.
    expect(order(preview())).toContain("nextup");
    expect(screen.queryByRole("button", { name: "Add Collections" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Revenue mix" })).toBeNull();
  });

  it("an assistant's saved layout never shows money widgets, even one the clinic default holds", async () => {
    const backend = asAssistant();
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha, backend });
    await screen.findByRole("group", { name: "Live preview of Today" });
    await userEvent.setup().click(screen.getByRole("button", { name: /Executive/ }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Save as clinic default" }));
    await waitFor(() => { expect(screen.getByText("Saved as the clinic's default")).toBeTruthy(); });
    cleanup();
    renderPortal("/today", { as: PEOPLE.farah, backend });
    await screen.findByRole("list", { name: "Key numbers" });
    const drawn = order(today());
    for (const money of ["collections", "revenue_mix", "pending_payments", "labs"]) expect(drawn).not.toContain(money);
    expect(drawn).toContain("team_today");
  });
});

describe("Accessibility of the studio", () => {
  it("the Settings tab has no axe violations", async () => {
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Live preview of Today" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Settings for Appointments" }));
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("Settings in the new look has no axe violations, on My profile and on the studio", async () => {
    renderPortal("/settings", { as: PEOPLE.asha });
    await screen.findByRole("navigation", { name: "Settings sections" });
    await screen.findByText("Clinic owner. The clinic's details are under Clinic profile.");
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
    cleanup();
    renderPortal("/settings?tab=studio", { as: PEOPLE.asha });
    await screen.findByRole("group", { name: "Live preview of Today" });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });
});
