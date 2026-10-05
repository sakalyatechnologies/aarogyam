import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";

import { PEOPLE, renderPortal } from "../test/render.js";

const KEY = "aarogyam.portal.sidebar-collapsed";

beforeEach(() => {
  localStorage.removeItem(KEY);
});
afterEach(() => {
  localStorage.removeItem(KEY);
});

describe("Sidebar", () => {
  it("collapses to an icon rail, remembers it per browser, and expands again", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    const toggle = await screen.findByRole("button", { name: "Collapse sidebar" });
    const app = document.querySelector(".mk-app");
    expect(app?.classList.contains("mk-collapsed")).toBe(false);
    await user.click(toggle);
    expect(app?.classList.contains("mk-collapsed")).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("1");
    // Links keep their names for screen readers and show them as tooltips.
    expect(screen.getByRole("link", { name: "Patients" }).getAttribute("title")).toBe("Patients");
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(app?.classList.contains("mk-collapsed")).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("0");
  });

  it("starts collapsed when the browser remembers it", async () => {
    localStorage.setItem(KEY, "1");
    renderPortal("/today", { as: PEOPLE.asha });
    await screen.findByRole("button", { name: "Expand sidebar" });
    expect(document.querySelector(".mk-app")?.classList.contains("mk-collapsed")).toBe(true);
  });

  it("opens as a drawer from the menu button (the phone layout) and closes on Escape", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    const menu = await screen.findByRole("button", { name: "Menu" });
    await user.click(menu);
    expect(document.querySelector(".mk-side")?.classList.contains("open")).toBe(true);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(document.querySelector(".mk-side")?.classList.contains("open")).toBe(false);
  });

  it("links to Staff for people who manage staff, and opens that tab", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("link", { name: "Staff" }));
    expect(await screen.findByRole("tab", { name: "Staff", selected: true }, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Staff" }).getAttribute("aria-current")).toBe("page");
  });

  it("has no Staff link for roles that cannot manage staff", async () => {
    renderPortal("/today", { as: PEOPLE.farah });
    await screen.findByRole("link", { name: "Patients" });
    expect(screen.queryByRole("link", { name: "Staff" })).toBeNull();
  });
});

describe("Clinic logo", () => {
  it("falls back to the clinic's initials when there is no logo", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    await screen.findByRole("button", { name: "Collapse sidebar" });
    const mark = document.querySelector(".mk-logo-mark");
    await waitFor(() => {
      expect(mark?.textContent).toBe("SD");
    });
    expect(mark?.querySelector("img")).toBeNull();
  });

  it("falls back to initials instead of a broken image when the logo fails to load", async () => {
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client): ApiClient => ({
        ...client,
        getLetterhead: async (options) => {
          const result = await client.getLetterhead(options);
          return result.ok ? { ...result, value: { ...result.value, logo_url: "https://files.invalid/logo.png" } } : result;
        },
      }),
    });
    await waitFor(() => {
      expect(document.querySelector(".mk-logo-mark img")).not.toBeNull();
    });
    const img = document.querySelector(".mk-logo-mark img");
    if (img === null) throw new Error("expected a logo");
    fireEvent.error(img);
    await waitFor(() => {
      expect(document.querySelector(".mk-logo-mark img")).toBeNull();
    });
    expect(document.querySelector(".mk-logo-mark")?.textContent).toBe("SD");
  });
});

describe("Search", () => {
  it("replaces the big search bar with a compact button", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    const button = await screen.findByRole("button", { name: "Search" });
    expect(button.className).toContain("mk-iconbtn");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(document.querySelector(".mk-cmdk")).toBeNull();
  });

  it("opens the command palette from the button or with Ctrl+K, and closes it on Escape", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Search" }));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(document.activeElement).toBe(within(dialog).getByRole("combobox"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeTruthy();
  });

  it("jumps to a page", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await user.type(await screen.findByRole("combobox"), "bill");
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/billing");
    });
  });

  it("finds a patient and opens the quick look", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await user.type(await screen.findByRole("combobox"), "SD-5");
    const options = await screen.findAllByRole("option", { name: /SD-5/ }, { timeout: 3000 });
    const option = options[0];
    if (option === undefined) throw new Error("expected a patient");
    await user.click(option);
    expect(await screen.findByRole("dialog", { name: /.+/, hidden: false })).toBeTruthy();
  });

  it("finds bills and prescriptions of a patient", async () => {
    const user = userEvent.setup();
    renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await user.type(await screen.findByRole("combobox"), "SD-");
    await screen.findAllByRole("option", { name: /Prescriptions for/ }, { timeout: 3000 });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
  });
});
