import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failure, type AnalyticsQuery, type ApiClient } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import { SHOW_MONEY_KEY } from "../today/v2/money.js";

// jsdom has no layout, so ResponsiveContainer would measure 0×0 and draw nothing: give charts a size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement<{ width?: number; height?: number }>(children) ? cloneElement(children, { width: 600, height: 240 }) : null,
  };
});

/** Dr Dev with analytics.view but not finance.view. */
const doctorWithAnalytics = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.dev && m.role.key === "doctor");
    if (membership !== undefined) membership.role = { ...ROLES.doctor, permissions: [...ROLES.doctor.permissions, "analytics.view"] };
  });

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Analytics (New look)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(NEW_LOOK_KEY, "1");
  });

  it("opens on Practice with patients, procedures, chair use and the shared heatmap", async () => {
    renderPortal("/analytics", { as: PEOPLE.asha });
    const kpis = await screen.findByRole("list", { name: "Practice totals for the range" });
    expect(within(kpis).getByText("Patients seen")).toBeTruthy();
    for (const title of ["Procedures", "Chair use", "New and returning patients", "Busy hours", "Age"]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeTruthy();
    }
    const heat = screen.getByRole("table", { name: "Visits by weekday and hour" });
    expect(within(heat).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(screen.getByRole("tab", { name: "Practice" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Income vs expenses" })).toBeNull();
  });

  it("keeps the range in the URL: it is read on load and written when changed", async () => {
    const user = userEvent.setup();
    const asked: AnalyticsQuery[] = [];
    const wrap = (client: ApiClient): ApiClient => {
      const original = client.getAnalytics.bind(client);
      client.getAnalytics = (query, options) => {
        asked.push(query);
        return original(query, options);
      };
      return client;
    };
    const { router } = renderPortal("/analytics?range=12m", { as: PEOPLE.asha, wrap });
    await screen.findByRole("heading", { name: "Busy hours" });
    expect(screen.getByRole("button", { name: "12 months" }).getAttribute("aria-pressed")).toBe("true");
    expect(asked.at(-1)?.bucket).toBe("month");
    const twelve = asked.at(-1)?.from ?? "";

    await user.click(screen.getByRole("button", { name: "3 months" }));
    await waitFor(() => {
      expect(router.state.location.search).toBe("?range=3m");
    });
    await waitFor(() => {
      expect(asked.at(-1)?.bucket).toBe("week");
    });
    expect((asked.at(-1)?.from ?? "") > twelve).toBe(true);
    expect(screen.getByRole("button", { name: "3 months" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to 6 months for a range the URL gets wrong", async () => {
    renderPortal("/analytics?range=99", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: "Busy hours" });
    expect(screen.getByRole("button", { name: "6 months" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("offers the Money tab to finance.view, keeps the range when switching, and the tab in the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderPortal("/analytics?range=3m", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("tab", { name: "Money" }));
    await screen.findByRole("heading", { name: "Income vs expenses", level: 2 });
    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get("tab")).toBe("money");
    });
    expect(new URLSearchParams(router.state.location.search).get("range")).toBe("3m");
    for (const title of ["Billed vs collected", "Collections by week", "Collections by method", "Expenses by category", "Expense log"]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeTruthy();
    }
  });

  it("hides the Money tab, and ignores ?tab=money, without finance.view", async () => {
    const user = userEvent.setup();
    renderPortal("/analytics?tab=money", { as: PEOPLE.dev, backend: doctorWithAnalytics() });
    // Dr Dev works at two clinics, so the portal asks which to open.
    await user.click(await screen.findByRole("button", { name: /Sunrise Dental/ }));
    await screen.findByRole("heading", { name: "Busy hours" });
    expect(screen.queryByRole("tab", { name: "Money" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Income vs expenses" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });

  it("keeps every money tile and card hidden until the eye is pressed, and remembers it", async () => {
    const user = userEvent.setup();
    renderPortal("/analytics?tab=money", { as: PEOPLE.asha });
    const kpis = await screen.findByRole("list", { name: "Money totals for the range" });
    expect(within(kpis).getAllByText("₹•••••")).toHaveLength(4);
    expect(screen.getAllByText("Hidden. Press the eye to show the amounts.")).toHaveLength(6);
    expect(screen.queryByRole("table", { name: /Expenses in the last six weeks/ })).toBeNull();
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBeNull();

    await user.click(within(kpis).getByRole("button", { name: "Show income" }));
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBe("1");
    // One setting for every money widget: all four tiles and all six cards open together.
    await waitFor(() => {
      expect(within(kpis).queryByText("₹•••••")).toBeNull();
    });
    expect(within(kpis).getAllByText(/^₹[\d.]+(L|k)?$/).length).toBeGreaterThanOrEqual(3);
    await screen.findByRole("table", { name: /Expenses in the last six weeks/ });
    expect(screen.queryByText("Hidden. Press the eye to show the amounts.")).toBeNull();

    await user.click(within(kpis).getByRole("button", { name: "Hide income" }));
    expect(localStorage.getItem(SHOW_MONEY_KEY)).toBe("0");
    expect(within(kpis).getAllByText("₹•••••")).toHaveLength(4);
  });

  it("shows nothing but a retry when the report cannot load", async () => {
    const wrap = (client: ApiClient): ApiClient => {
      client.getAnalytics = () => Promise.resolve(failure({ status: 0, code: "network_error", message: "offline" }));
      return client;
    };
    renderPortal("/analytics", { as: PEOPLE.asha, wrap });
    expect(await screen.findByText("Couldn't load analytics")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeTruthy();
  });

  it("has no axe violations on either tab", async () => {
    const user = userEvent.setup();
    renderPortal("/analytics", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: "Busy hours" });
    const check = async () => (await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } })).violations;
    expect(await check()).toEqual([]);
    await user.click(screen.getByRole("tab", { name: "Money" }));
    await user.click(await screen.findByRole("button", { name: "Show income" }));
    await screen.findByRole("table", { name: /Expenses in the last six weeks/ });
    await screen.findByText(/Collection rate/);
    expect(await check()).toEqual([]);
  }, 60_000);
});
