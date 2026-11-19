import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import type { VitalStat } from "@aarogyam/api-client";
import { createFakeBackend, createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";
import { createQueryClient } from "@aarogyam/app-kit";
import { createDevAuth } from "@aarogyam/auth";

import { Providers } from "../../app.js";
import { routes } from "../../routes.js";
import { formatVital, pageSpeedRows } from "./frontend-tab.js";
import { formatVisible } from "./pages-section.js";

function renderConsole(path: string) {
  const backend = createFakeBackend(createFixtures({ now: new Date("2026-10-03T05:30:00Z") }));
  const team = backend.platformUsers();
  const auth = createDevAuth({ people: team.map((p) => ({ id: p.id, displayName: p.display_name })), tokenFor: fakeTokenFor, storage: null });
  auth.signInAs(team[0]?.id ?? "");
  const services = { auth, api: backend.client({ getToken: auth.getAccessToken }) };
  render(
    <Providers services={services} queryClient={createQueryClient()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </Providers>,
  );
}

describe("Insights, phase 2", () => {
  it("shows page speed by page against the thresholds, the slowest pages and error kinds", async () => {
    renderConsole("/health?tab=frontend&range=7d");
    const table = await screen.findByRole("table", { name: "Page speed by page" });
    expect(within(table).getAllByText(/Good|Needs work|Poor/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText("/today").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Slowest pages" })).toBeTruthy();
    expect(screen.getAllByText("Page code failed to load").length).toBeGreaterThan(0);
    expect(screen.queryByText("Front end coming soon")).toBeNull();
  });

  it("lists durable routes by traffic, latency and errors on the API tab", async () => {
    renderConsole("/health?tab=api&range=24h");
    expect(await screen.findByRole("table", { name: "Routes by traffic, every instance" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Slowest routes by p95" })).toBeTruthy();
    const errors = screen.getByRole("table", { name: "Routes with errors" });
    expect(within(errors).getAllByText(/POST/).length).toBeGreaterThan(0);
  });

  it("adds top pages per app, roles across all clinics and clinic totals to Usage", async () => {
    renderConsole("/health?tab=usage&range=7d");
    expect(await screen.findByRole("table", { name: "Top portal pages" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Top console pages" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Time by role across all clinics" })).toBeTruthy();
    const clinics = screen.getByRole("table", { name: "Page time per clinic" });
    // A clinic with fewer than 5 views shows no time.
    expect(within(clinics).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("formats vitals and visible time", () => {
    expect(formatVital("cls", 0.123)).toBe("0.12");
    expect(formatVital("lcp", null)).toBe("—");
    expect(formatVisible(45_000)).toBe("45 s");
    expect(formatVisible(5_400_000)).toBe("1.5 h");
    expect(formatVisible(null)).toBe("—");
  });

  it("puts each page's vitals on one row", () => {
    const stat = (vital: string, p75: number | null): VitalStat => ({ app: "portal", route: "/today", vital, samples: 9, p75, rating: p75 === null ? null : "good", good: 9, needs_work: 0, poor: 0 });
    const rows = pageSpeedRows([stat("lcp", 1200), stat("inp", 80), stat("fid", 3)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vitals.lcp?.p75).toBe(1200);
    expect(Object.keys(rows[0]?.vitals ?? {})).toEqual(["lcp", "inp"]);
  });
});
