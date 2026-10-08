import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AnalyticsQuery, ApiClient } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

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

describe("Analytics", () => {
  it("shows the owner money, chair use, patients and busy hours", async () => {
    renderPortal("/analytics", { as: PEOPLE.asha });
    const kpis = await screen.findByRole("list", { name: "Totals for the range" });
    expect(within(kpis).getAllByText(/^₹[\d.]+L$/)).toHaveLength(3);
    expect(within(kpis).queryByText("Owner only")).toBeNull();
    for (const title of ["Income", "Expenses", "Chair use", "New and returning patients", "Busy hours", "Age", "Visit kind", "Referral source"]) {
      expect(screen.getByRole("heading", { name: title, level: 2 })).toBeTruthy();
    }
    const heat = screen.getByRole("table", { name: "Visits by weekday and hour" });
    expect(within(heat).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(screen.getByRole("list", { name: "Referral source" }).textContent).toContain("Walk-in");
    expect(screen.getAllByRole("meter").length).toBeGreaterThanOrEqual(3);
    expect(document.querySelector(".an-expenses .recharts-surface")).not.toBeNull();
  });

  it("asks again for a new range and grouping", async () => {
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
    const { router } = renderPortal("/analytics", { as: PEOPLE.asha, wrap });
    await screen.findByRole("heading", { name: "Busy hours" });
    expect(asked.at(-1)?.bucket).toBe("month");
    await user.click(screen.getByRole("button", { name: "3 months" }));
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    await waitFor(() => {
      expect(asked.at(-1)?.bucket).toBe("week");
    });
    expect(router.state.location.search).toBe("?months=3&by=week");
    expect(screen.getByRole("button", { name: "3 months" }).getAttribute("aria-pressed")).toBe("true");
    // The previous report stays on screen while the next one loads.
    expect(screen.getByRole("heading", { name: "Busy hours" })).toBeTruthy();
  });

  it("hides money from a role without finance.view", async () => {
    const user = userEvent.setup();
    renderPortal("/analytics", { as: PEOPLE.dev, backend: doctorWithAnalytics() });
    // Dr Dev works at two clinics, so the portal asks which to open.
    await user.click(await screen.findByRole("button", { name: /Sunrise Dental/ }));
    const kpis = await screen.findByRole("list", { name: "Totals for the range" });
    expect(within(kpis).getAllByText("Owner only")).toHaveLength(3);
    expect(screen.getByText(/Income and expenses are for the owner/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Income", level: 2 })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Expenses", level: 2 })).toBeNull();
    expect(screen.getByRole("heading", { name: "Chair use", level: 2 })).toBeTruthy();
  });

  it("puts Analytics in the nav for a role with analytics.view", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    expect(await screen.findByRole("link", { name: "Analytics" })).toBeTruthy();
  });

  it("keeps the nav item and page from roles without analytics.view", async () => {
    renderPortal("/analytics", { as: PEOPLE.farah });
    expect(await screen.findByText("Analytics isn't available to your role")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
  });
});
